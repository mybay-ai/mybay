import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import os from "os";
import multer from "multer";
import { hasZipMagic } from "../../utils/uploadSecurity";
import AdmZip from "adm-zip";
import * as archiver from "archiver";
import { resolveArchiverFactory } from "../../utils/resolveArchiverFactory";
import { executeDeployment, buildDeploymentContext, rebuildProxyConfig } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { isAdvancedResourceConfigEnabled } from "../../utils/advancedResourceConfigFeature";
import { supportsFeishu } from "../../utils/hermesCapabilities";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { sanitizeChannelConfigForChannel } from "../../utils/channelConfigSanitizer";
import { assertCanExportBackup, assertCanUseChannel, getInstanceLimit, sendEntitlementError } from "../../services/entitlements";
import { RouterDependencies } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt } from "../../crypto";
import { isMaskedSecretPlaceholder, redactSecretsDeep, sanitizeConfig, sanitizeErrorMessage } from "../../utils/sanitizer";
import bcrypt from "bcryptjs";
import { providerRegistry as registry } from "../../../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../../../shared/providerRegistryUtils";
import { checkSSRFSafe } from "../../utils/ssrfValidator";
import { skillPolicyRegistry } from "../../../shared/skillPolicyRegistry";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";
import { ensureEncryptedDashboardAuthSecret } from "../../utils/dashboardAuthSecret";
import { applySavedProviderCredential, SavedProviderCredentialError } from "../../utils/savedProviderCredential";
import { validateConfigArchiveEntries } from "../../utils/configArchiveSecurity";
import { isPrivilegedUser, parseInstanceConfigJson } from "../../services/instanceConfig/instanceConfigRoutePolicy";

export function createConfigRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  const importMemoryStorage = multer.memoryStorage();
  const importUpload = multer({
    storage: importMemoryStorage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const mime = String(file.mimetype || "").toLowerCase();
      if (ext !== ".zip" || !["application/zip", "application/x-zip-compressed", "application/octet-stream"].includes(mime)) {
        return cb(new Error("安全机制拦截：仅支持上传 .zip 格式的脱敏备份包。") as any, false);
      }
      cb(null, true);
    }
  }).single("file");

  function checkManifestConsistency(
    manifestData: any,
    hasManifest: boolean,
    hasConfigRedacted: boolean,
    hasBusinessConfig: boolean,
    hasTemplateInputs: boolean,
    hasUploads: boolean,
    hasOutputs: boolean
  ): string | null {
    if (!manifestData) return null;
    const declaredSections = manifestData.included_sections || [];
    if (!Array.isArray(declaredSections)) {
      return "安全拦截：manifest.included_sections 不是有效的数组";
    }
    if (!declaredSections.includes("config")) {
      return "安全拦截：备份包清单损坏，缺少核心区块(config)声明";
    }

    // 1. Manifest declarations -> Zip existence
    if (declaredSections.includes("manifest") && !hasManifest) {
      return "无效的备份包：manifest 声明包含 manifest，但未检测到对应内容";
    }
    if (declaredSections.includes("config") && !hasConfigRedacted) {
      return "无效的备份包：manifest 声明包含 config，但缺少 config.redacted.json";
    }
    if (declaredSections.includes("business-config") && !hasBusinessConfig) {
      return "无效的备份包：manifest 声明包含 business-config，但缺少 business-config.json";
    }
    if (declaredSections.includes("template-inputs") && !hasTemplateInputs) {
      return "无效的备份包：manifest 声明包含 template-inputs，但缺少 template-inputs.json";
    }
    if (declaredSections.includes("uploads") && !hasUploads) {
      return "无效的备份包：manifest 声明包含 uploads，但未检测到任何实际的上传文件";
    }
    if (declaredSections.includes("outputs") && !hasOutputs) {
      return "无效的备份包：manifest 声明包含 outputs，但未检测到任何实际的输出文件";
    }

    // 2. Zip existence -> Manifest declarations
    if (hasManifest && !declaredSections.includes("manifest")) {
      return "无效的备份包：zip 中存在 manifest.json，但 manifest 未声明 manifest 区块";
    }
    if (hasConfigRedacted && !declaredSections.includes("config")) {
      return "无效的备份包：zip 中存在 config.redacted.json，但 manifest 未声明 config 区块";
    }
    if (hasBusinessConfig && !declaredSections.includes("business-config")) {
      return "无效的备份包：zip 中存在 business-config.json，但 manifest 未声明 business-config 区块";
    }
    if (hasTemplateInputs && !declaredSections.includes("template-inputs")) {
      return "无效的备份包：zip 中存在 template-inputs.json，但 manifest 未声明 template-inputs 区块";
    }
    if (hasUploads && !declaredSections.includes("uploads")) {
      return "无效的备份包：zip 中存在 uploads 类文件，但 manifest 未声明 uploads 区块";
    }
    if (hasOutputs && !declaredSections.includes("outputs")) {
      return "无效的备份包：zip 中存在 outputs 类文件，但 manifest 未声明 outputs 区块";
    }

    return null;
  }

  router.post("/import-archive/preview", authenticateToken, (req, res, next) => {
    importUpload(req, res, (err) => {
      if (err) {
        return res.status(400).json({ valid: false, error: err.message || "文件上传错误" });
      }
      next();
    });
  }, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ valid: false, error: "请选择需要上传并校验的备份包文件" });
      }

      let zip: AdmZip;
      if (!hasZipMagic(req.file.buffer)) {
        return res.status(400).json({ error: "Invalid or forged ZIP archive." });
      }
      try {
        zip = new AdmZip(req.file.buffer);
      } catch (e) {
        return res.status(400).json({ valid: false, error: "备份包损坏或不是有效的 zip 压缩文件" });
      }

      const entries = zip.getEntries();
      const archiveValidation = validateConfigArchiveEntries(entries);
      if (archiveValidation.ok === false) return res.status(400).json({ valid: false, error: archiveValidation.error, code: archiveValidation.code });

      let hasUploads = false;
      let hasOutputs = false;
      let manifestData: any = null;
      let configRedactedData: any = null;
      let businessConfigData: any = null;
      let templateInputsData: any = null;

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.replace(/\\/g, "/");

        // Safety checks for paths inside the zip
        if (name.startsWith("/") || name.startsWith("\\")) {
          return res.status(400).json({ valid: false, error: "安全拦截：备份包中包含绝对路径的文件" });
        }
        const parts = name.split("/");
        if (parts.some(p => p === ".." || p === ".")) {
          return res.status(400).json({ valid: false, error: "安全拦截：备份包中包含路径穿越字符" });
        }

        // Symlink detection (Unix external file attribute)
        const mode = ((entry.header as any)?.externalFileAttr || 0) >>> 16;
        const isSymlink = (mode & 0xf000) === 0xa000;
        if (isSymlink) {
          continue; // Skip symlinks
        }

        // Detect uploads/outputs presence
        const lowerName = name.toLowerCase();
        if (
          lowerName.startsWith("uploads/") ||
          lowerName.startsWith("input/") ||
          lowerName.startsWith("inputs/") ||
          lowerName.startsWith("documents/") ||
          lowerName.startsWith("files/")
        ) {
          hasUploads = true;
        }
        if (
          lowerName.startsWith("outputs/") ||
          lowerName.startsWith("output/") ||
          lowerName.startsWith("results/") ||
          lowerName.startsWith("artifacts/")
        ) {
          hasOutputs = true;
        }

        // Parsing files with size limit of 2MB
        if (name === "manifest.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ valid: false, error: "manifest.json 大小超过了 2MB 限制" });
          }
          try {
            manifestData = JSON.parse(entry.getData().toString("utf8"));
          } catch (e) {
            return res.status(400).json({ valid: false, error: "manifest.json 解析失败，不是合法的 JSON 格式" });
          }
        } else if (name === "config.redacted.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ valid: false, error: "config.redacted.json 大小超过了 2MB 限制" });
          }
          try {
            configRedactedData = JSON.parse(entry.getData().toString("utf8"));
          } catch (e) {
            return res.status(400).json({ valid: false, error: "config.redacted.json 解析失败，不是合法的 JSON 格式" });
          }
        } else if (name === "business-config.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ valid: false, error: "business-config.json 大小超过了 2MB 限制" });
          }
          try {
            businessConfigData = JSON.parse(entry.getData().toString("utf8"));
          } catch (e) {
            return res.status(400).json({ valid: false, error: "business-config.json 解析失败，不是合法的 JSON 格式" });
          }
        } else if (name === "template-inputs.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ valid: false, error: "template-inputs.json 大小超过了 2MB 限制" });
          }
          try {
            templateInputsData = JSON.parse(entry.getData().toString("utf8"));
          } catch (e) {
            return res.status(400).json({ valid: false, error: "template-inputs.json 解析失败，不是合法的 JSON 格式" });
          }
        }
      }

      if (!manifestData) {
        return res.status(400).json({ valid: false, error: "无效的备份包：缺少 manifest.json 描述文件" });
      }
      if (!configRedactedData) {
        return res.status(400).json({ valid: false, error: "无效的备份包：缺少 config.redacted.json 脱敏配置文件" });
      }

      const consistencyError = checkManifestConsistency(
        manifestData,
        true, // hasManifest
        !!configRedactedData,
        !!businessConfigData,
        !!templateInputsData,
        hasUploads,
        hasOutputs
      );

      if (consistencyError) {
        return res.status(400).json({ valid: false, error: consistencyError });
      }

      const includedSections = manifestData.included_sections || [];

      // Config preview
      const configPreview = {
        provider: configRedactedData.provider || configRedactedData.llm_provider || "",
        model: configRedactedData.model || configRedactedData.llm_model || "",
        templateId: configRedactedData.templateId || configRedactedData.template_id || "",
        templateSlug: configRedactedData.templateSlug || configRedactedData.template_slug || "",
        channel: configRedactedData.channel || "",
        enableDashboard: configRedactedData.enableDashboard !== false
      };

      // Business config preview
      const businessConfigPreview = {
        hasBusinessConfig: !!businessConfigData && Object.keys(businessConfigData).length > 0,
        sections: businessConfigData ? Object.keys(businessConfigData) : []
      };

      // Template inputs preview
      const templateInputsPreview = {
        hasTemplateInputs: !!templateInputsData && Object.keys(templateInputsData).length > 0,
        keys: templateInputsData ? Object.keys(templateInputsData) : []
      };

      // Record Audit Log
      await dbAdapter.insertAuditLog({
        instance_id: manifestData.instance_id || null,
        action: "preview_import_archive",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: `Previewed backup package of instance: ${manifestData.instance_name || "Unknown"}`
      }).catch(() => {});

      return res.json({
        valid: true,
        archiveVersion: manifestData.archive_version || 1,
        redacted: manifestData.redacted !== false,
        sourceInstanceId: manifestData.instance_id || "",
        sourceInstanceName: manifestData.instance_name || "",
        exportedAt: manifestData.exported_at || "",
        includedSections,
        hasUploads,
        hasOutputs,
        configPreview,
        businessConfigPreview,
        templateInputsPreview,
        warnings: [
          "API Key、密码、会话和凭证不会包含在备份包中，克隆前需要重新配置。"
        ]
      });

    } catch (err: any) {
      console.error("[Config API] Import Archive Preview error:", err);
      return res.status(500).json({ valid: false, error: "解析备份包失败，服务器内部异常" });
    }
  });

  router.post("/import-archive/create", authenticateToken, (req, res, next) => {
    importUpload(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, error: err.message || "文件上传错误" });
      }
      next();
    });
  }, async (req: AuthenticatedRequest, res: Response) => {
    let generatedId = require("crypto").randomUUID();
    let instanceDirCreated = false;
    let instanceDBCreated = false;
    const instanceDir = path.join(process.cwd(), "data", "instances", generatedId);

    try {
      if (!req.file) {
        return res.status(400).json({ error: "请选择需要上传并克隆的备份包文件" });
      }

      const name = req.body.name;
      const pathSlug = req.body.path;

      if (!name || typeof name !== "string" || name.trim() === "") {
        return res.status(400).json({ error: "新实例名称不能为空" });
      }
      if (!pathSlug || typeof pathSlug !== "string" || pathSlug.trim() === "") {
        return res.status(400).json({ error: "新实例访问路径不能为空" });
      }

      // Check path format (slug constraints)
      if (!/^[a-z0-9-]+$/.test(pathSlug)) {
        return res.status(400).json({ error: "访问路径（Slug）格式不正确：仅允许使用小写字母、数字和连字符(-)" });
      }

      // 1. Backend Quota Check
      const instances = await dbAdapter.getInstances(req.user.id, req.user.role);
      const activeInstancesCount = instances.filter((inst: any) => {
        if (inst.archived) return false;
        return isQuotaConsumingStatus(inst.status);
      }).length;

      const limit = await getInstanceLimit(req.user, resolveInstanceLimit(req.user));
      const isUnlimited = limit === null;

      if (!isUnlimited && activeInstancesCount >= limit) {
        return res.status(409).json({
          code: "INSTANCE_LIMIT_REACHED",
          message: `\u5b9e\u4f8b\u989d\u5ea6\u5df2\u7528\u5b8c\uff1a\u5f53\u524d\u5957\u9910\u6700\u591a\u53ef\u521b\u5efa ${limit} \u4e2a\u6d3b\u8dc3\u5b9e\u4f8b\uff0c\u5df2\u4f7f\u7528 ${activeInstancesCount} \u4e2a\u3002`,
          limit: limit,
          used: activeInstancesCount
        });
      }

      // 2. Check path slug uniqueness in DB
      const existingByPath = await dbAdapter.getInstanceByPath(pathSlug);
      if (existingByPath) {
        return res.status(400).json({ error: "该访问路径（Slug）已经被占用，请换用其他路径" });
      }

      // 3. Extract and parse ZIP
      let zip: AdmZip;
      if (!hasZipMagic(req.file.buffer)) {
        return res.status(400).json({ error: "Invalid or forged ZIP archive." });
      }
      try {
        zip = new AdmZip(req.file.buffer);
      } catch (e) {
        return res.status(400).json({ error: "备份包损坏或不是有效的 zip 压缩文件" });
      }

      const entries = zip.getEntries();
      const archiveValidation = validateConfigArchiveEntries(entries);
      if (archiveValidation.ok === false) return res.status(400).json({ error: archiveValidation.error, code: archiveValidation.code });

      let manifestData: any = null;
      let configRedactedData: any = null;
      let businessConfigData: any = null;
      let templateInputsData: any = null;
      let hasUploads = false;
      let hasOutputs = false;

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName.replace(/\\/g, "/");

        // Path traversal validation
        if (entryName.startsWith("/") || entryName.startsWith("\\")) {
          return res.status(400).json({ error: "安全拦截：备份包中包含绝对路径的文件" });
        }
        const parts = entryName.split("/");
        if (parts.some(p => p === ".." || p === ".")) {
          return res.status(400).json({ error: "安全拦截：备份包中包含路径穿越字符" });
        }

        // Symlink detection
        const mode = ((entry.header as any)?.externalFileAttr || 0) >>> 16;
        const isSymlink = (mode & 0xf000) === 0xa000;
        if (isSymlink) {
          continue; // Skip symlink
        }

        const lowerName = entryName.toLowerCase();
        if (
          lowerName.startsWith("uploads/") ||
          lowerName.startsWith("input/") ||
          lowerName.startsWith("inputs/") ||
          lowerName.startsWith("documents/") ||
          lowerName.startsWith("files/")
        ) {
          hasUploads = true;
        }
        if (
          lowerName.startsWith("outputs/") ||
          lowerName.startsWith("output/") ||
          lowerName.startsWith("results/") ||
          lowerName.startsWith("artifacts/")
        ) {
          hasOutputs = true;
        }

        if (entryName === "manifest.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ error: "manifest.json 大小超限" });
          }
          manifestData = JSON.parse(entry.getData().toString("utf8"));
        } else if (entryName === "config.redacted.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ error: "config.redacted.json 大小超限" });
          }
          configRedactedData = JSON.parse(entry.getData().toString("utf8"));
        } else if (entryName === "business-config.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ error: "business-config.json 大小超限" });
          }
          businessConfigData = JSON.parse(entry.getData().toString("utf8"));
        } else if (entryName === "template-inputs.json") {
          if (entry.header.size > 2 * 1024 * 1024) {
            return res.status(400).json({ error: "template-inputs.json 大小超限" });
          }
          templateInputsData = JSON.parse(entry.getData().toString("utf8"));
        }
      }

      if (!manifestData) {
        return res.status(400).json({ error: "无效的备份包：缺少 manifest.json" });
      }

      if (manifestData.platform !== "MyBay") {
        return res.status(400).json({ error: "安全拦截：无效的备份包，Platform 必须是 MyBay" });
      }
      if (manifestData.redacted !== true) {
        return res.status(400).json({ error: "安全拦截：无效的备份包，只能导入安全的脱敏备份（redacted: true）" });
      }
      if (manifestData.archive_version !== 1) {
        return res.status(400).json({ error: `安全拦截：不支持的备份包版本 (v${manifestData.archive_version || '未知'})` });
      }
      
      const consistencyError = checkManifestConsistency(
        manifestData,
        true, // hasManifest
        !!configRedactedData,
        !!businessConfigData,
        !!templateInputsData,
        hasUploads,
        hasOutputs
      );

      if (consistencyError) {
        return res.status(400).json({ error: consistencyError });
      }

      if (!configRedactedData) {
        return res.status(400).json({ error: "无效的备份包：缺少 config.redacted.json" });
      }

      // 4. Clean configuration of sensitive keys and [REDACTED] flags
      const configData = { ...configRedactedData };
      
      // Merge restored optional configs
      if (businessConfigData && Object.keys(businessConfigData).length > 0) {
        configData.businessConfig = businessConfigData;
      }
      if (templateInputsData && Object.keys(templateInputsData).length > 0) {
        configData.template_inputs = templateInputsData;
      }

      // Strict cleansing of any potentially masked keys or sensitive strings
      scrubSensitiveAndRedacted(configData);

      // Preserve UI selected name and path
      configData.name = name;
      configData.path = pathSlug;

      // Force resource limit compliance
      const resolvedLimits = await resolveResourceLimitsForInstance(
        req.user,
        configData.limitsCpu,
        configData.limitsMem,
        req.user.id
      );
      configData.limitsCpu = resolvedLimits.limitsCpu;
      configData.limitsMem = resolvedLimits.limitsMem;

      // 5. Generate secure crypt-keys
      const generatedKey = `mb_hermes_${require("crypto").randomBytes(32).toString("hex")}`;
      configData.hermesApiKey = encrypt(generatedKey);

      const generatedDashSecret = `mb_dash_${require("crypto").randomBytes(32).toString("hex")}`;
      configData.hermesDashboardAuthSecret = encrypt(generatedDashSecret);
      configData.dashboardAuthSecret = encrypt(generatedDashSecret);

      // Build context (to resolve public URL and paths)
      const ctx = buildDeploymentContext({ id: generatedId, path: pathSlug }, configData);

      // Determine image parameters
      let { agent_image, agent_image_tag } = parseImageRef(configData.image || "");
      if (configData.imageTag) {
        agent_image_tag = configData.imageTag;
      }
      let agent_version = agent_image_tag;
      let resolved_version: string | null = null;

      // Determine Feishu variant
      const isChannelFeishu = 
        configData.channel === "feishu" || 
        configData.channel === "lark" || 
        (Array.isArray(configData.channel) && configData.channel.some((ch: any) => ["feishu", "lark"].includes(String(ch).toLowerCase()))) ||
        (configData.configuredChannels && (
          (Array.isArray(configData.configuredChannels) && configData.configuredChannels.some((ch: any) => ["feishu", "lark"].includes(String(ch).toLowerCase()))) ||
          (typeof configData.configuredChannels === 'string' && (configData.configuredChannels.toLowerCase().includes("feishu") || configData.configuredChannels.toLowerCase().includes("lark")))
        ));

      const hasFeishuSkill = 
        Array.isArray(configData.skills) && 
        configData.skills.some((s: string) => 
          ["feishu", "lark", "feishu_adapter", "lark_adapter"].includes(String(s).toLowerCase())
        );

      const isFeishu = !!(isChannelFeishu || hasFeishuSkill);

      // Feishu-tag resolution (equivalent to create.routes.ts resolution block)
      const myBayVersions = await dbAdapter.getMyBayVersions();
      if (isFeishu) {
        const { versionsRepo } = await import("../../repositories/versionsRepo");
        const matchingVersion = agent_image_tag === "latest"
          ? await versionsRepo.getResolvedLatestFeishuVersion()
          : myBayVersions.find((version: any) => {
              const tag = version.image_tag || version.tag || version.version;
              return tag === agent_image_tag || version.version === agent_image_tag;
            });
        if (!matchingVersion || !supportsFeishu(matchingVersion)) {
          return res.status(409).json({
            code: "FEISHU_CAPABILITY_REQUIRED",
            params: { version: agent_image_tag },
            error: "The selected official Hermes version does not support Feishu/Lark."
          });
        }
        agent_image = matchingVersion.image || process.env.MY_BAY_IMAGE || "nousresearch/hermes-agent";
        agent_image_tag = matchingVersion.image_tag || matchingVersion.tag || matchingVersion.version;
        agent_version = matchingVersion.version || agent_image_tag;
        resolved_version = agent_version;
      } else {
        // Non-feishu instance
        if (agent_image_tag === 'latest') {
          try {
            const { versionsRepo } = await import("../../repositories/versionsRepo");
            const resolvedLatest = await versionsRepo.getResolvedLatestCoreVersion();
            if (resolvedLatest && resolvedLatest.image && resolvedLatest.image_tag) {
              agent_image = resolvedLatest.image;
              agent_image_tag = resolvedLatest.image_tag;
              agent_version = resolvedLatest.version || resolvedLatest.image_tag;
              resolved_version = resolvedLatest.version || resolvedLatest.image_tag;
            }
          } catch (e) {
            console.warn("[Import Create] Failed to resolve latest core version", e);
          }
        } else {
          const coreTag = agent_image_tag.endsWith("-feishu") ? agent_image_tag.replace(/-feishu$/, "") : agent_image_tag;
          const matchCore = myBayVersions.find((v: any) => (v.image_tag || v.tag || v.version) === coreTag);
          if (matchCore) {
            agent_image = matchCore.image || agent_image;
            agent_image_tag = matchCore.image_tag || matchCore.tag || matchCore.version;
            agent_version = matchCore.version;
            resolved_version = matchCore.version || matchCore.image_tag;
          } else {
            agent_image_tag = coreTag;
            agent_version = coreTag;
            resolved_version = coreTag;
          }
        }
      }

      // Update image details inside configData as well
      configData.image = `${agent_image}:${agent_image_tag}`;
      configData.imageTag = agent_image_tag;

      // 5.5 Validate restore file sizes before any disk IO
      const MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024; // 50MB
      const MAX_TOTAL_RESTORE_SIZE = 500 * 1024 * 1024; // 500MB
      let totalRestoreSize = 0;

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName.replace(/\\/g, "/");
        const lowerName = entryName.toLowerCase();

        const isRestoreFile = 
          lowerName.startsWith("uploads/") || lowerName.startsWith("input/") || lowerName.startsWith("inputs/") || lowerName.startsWith("documents/") || lowerName.startsWith("files/") ||
          lowerName.startsWith("outputs/") || lowerName.startsWith("output/") || lowerName.startsWith("results/") || lowerName.startsWith("artifacts/");

        if (isRestoreFile) {
          const fileSize = entry.header.size;
          if (fileSize > MAX_SINGLE_FILE_SIZE) {
            return res.status(400).json({ error: `安全拦截：存在超过单文件大小上限(50MB)的文件: ${entryName}` });
          }
          totalRestoreSize += fileSize;
          if (totalRestoreSize > MAX_TOTAL_RESTORE_SIZE) {
            return res.status(400).json({ error: `安全拦截：备份包内可恢复文件总大小超过上限(500MB)` });
          }
        }
      }

      // 6. Setup local folders & extract data
      fs.mkdirSync(instanceDir, { recursive: true });
      instanceDirCreated = true;

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName.replace(/\\/g, "/");

        const lowerName = entryName.toLowerCase();
        const isUpload = 
          lowerName.startsWith("uploads/") ||
          lowerName.startsWith("input/") ||
          lowerName.startsWith("inputs/") ||
          lowerName.startsWith("documents/") ||
          lowerName.startsWith("files/");

        const isOutput = 
          lowerName.startsWith("outputs/") ||
          lowerName.startsWith("output/") ||
          lowerName.startsWith("results/") ||
          lowerName.startsWith("artifacts/");

        if (isUpload || isOutput) {
          const targetPath = path.join(instanceDir, entryName);
          const relative = path.relative(instanceDir, targetPath);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            continue; // extra protection against Zip Slip
          }

          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, entry.getData());
        }
      }

      // 7. Write Database Record
      const newInstance = {
        id: generatedId,
        name: name,
        path: pathSlug,
        status: "stopped", // Marked "stopped" (un-deployed, awaiting reconfiguration)
        url: ctx.publicUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config_json: JSON.stringify(configData),
        user_id: req.user.id,
        user_role: req.user.role,
        agent_image,
        agent_image_tag,
        agent_version,
        resolved_version,
        model_provider: configData.provider || null,
        model_name: configData.model || null,
        model_base_url: configData.baseUrl || null,
        model_config_status: 'pending',
        model_config_error: null,
        template_id: configData.template_id || null,
        template_slug: configData.template_slug || null,
        limitsCpu: parseFloat(resolvedLimits.limitsCpu),
        limitsMemory: resolvedLimits.limitsMem,
        limitsMemoryMb: resolvedLimits.limitsMemoryMb
      };

      await dbAdapter.createInstance(newInstance);
      instanceDBCreated = true;

      // Audit Log Success
      await dbAdapter.insertAuditLog({
        instance_id: generatedId,
        action: "import_archive_create",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: `Imported backup package as new instance successfully: ${name} (Slug: ${pathSlug})`
      }).catch(() => {});

      return res.json({
        success: true,
        id: generatedId,
        name: name,
        path: pathSlug,
        message: "备份包成功导入为全新实例！状态设为待部署、未启动。"
      });

    } catch (err: any) {
      console.error("[Config API] Import Archive Create error:", err);

      // Rollback
      if (instanceDBCreated) {
        await dbAdapter.deleteInstance(generatedId).catch(() => {});
      }
      if (instanceDirCreated) {
        try {
          fs.rmSync(instanceDir, { recursive: true, force: true });
        } catch (_) {}
      }

      return res.status(500).json({ success: false, error: err.message || "备份包克隆创建实例失败，服务器内部异常" });
    }
  });

  function scrubSensitiveAndRedacted(obj: any) {
    if (!obj || typeof obj !== 'object') return;
    const sensitiveFields = [
      'apiKey', 'providerApiKey', 'password', 'telegramBotToken', 'discordBotToken',
      'feishuAppSecret', 'qqBotSecret', 'whatsappAccessToken', 'slackBotToken',
      'slackSigningSecret', 'slackAppToken', 'dingtalkAppSecret', 'dingtalkRobotSecret',
      'wechatAppSecret', 'wechatMpAppSecret', 'wecomAppSecret', 'weixinToken', 'webhookSecret', 'skillTavilyApiKey', 'skillSerperApiKey',
      'skillGithubToken',
      'wecomToken', 'wecomEncodingAesKey', 'wechatMpToken', 'wechatMpEncodingAesKey',
      'hermesApiKey', 'chatApiKey', 'hermesDashboardAuthSecret', 'dashboardAuthSecret'
    ];
    for (const key of Object.keys(obj)) {
      if (sensitiveFields.includes(key)) {
        delete obj[key];
        continue;
      }
      const val = obj[key];
      if (typeof val === 'string') {
        if (
          val.includes('[REDACTED]') ||
          val.includes('[MASKED]') ||
          isMaskedSecretPlaceholder(val)
        ) {
          delete obj[key];
        }
      } else if (typeof val === 'object') {
        scrubSensitiveAndRedacted(val);
      }
    }
  }

  router.get("/:id/export", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });

      const ownerId = instance.owner_id || instance.user_id;
      const isOwner = ownerId === req.user.id;
      const isPrivileged = isPrivilegedUser(req.user);
      if (!isOwner && !isPrivileged) {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }


      try {
        await assertCanExportBackup(req.user);
      } catch (entitlementErr: any) {
        if (sendEntitlementError(res, entitlementErr)) return;
        throw entitlementErr;
      }

      const config = parseInstanceConfigJson(instance.config_json);
      
      const redactedConfig = redactSecretsDeep(config);

      const exportData = {
        name: instance.name,
        path: instance.path,
        config: redactedConfig,
        exportedAt: new Date().toISOString(),
        platform: "MyBay (麦贝) Agent 控制台",
        securityNote: "API Keys and secrets are redacted for security. Please re-configure them after import."
      };

      await dbAdapter.insertAuditLog({
        instance_id: req.params.id,
        action: "export_config",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Exported instance configuration (redacted secrets)"
      });

      res.setHeader('Content-Disposition', `attachment; filename="agent-config-${instance.path || instance.id}.json"`);
      res.json(exportData);
    } catch (e: any) {
      console.error("[Config API] Export error:", e);
      res.status(500).json({ error: "应用导出失败，服务器内部异常" });
    }
  });

  router.get("/:id/export-archive", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    let instance: any = null;
    let rootDir: string | undefined = undefined;
    try {
      instance = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }

      const ownerId = instance.owner_id || instance.user_id;
      const isOwner = ownerId === req.user.id;
      const isPrivileged = isPrivilegedUser(req.user);
      if (!isOwner && !isPrivileged) {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }


      try {
        await assertCanExportBackup(req.user);
      } catch (entitlementErr: any) {
        if (sendEntitlementError(res, entitlementErr)) return;
        throw entitlementErr;
      }

      const config = parseInstanceConfigJson(instance.config_json);
      const redactedConfig = redactSecretsDeep(config);
      const businessConfig = redactSecretsDeep(config.businessConfig || {});
      const templateInputs = redactSecretsDeep(config.template_inputs || {});

      // Resolve instance root directory path
      const localDir = path.resolve(process.cwd(), "data", "instances", instance.id);
      rootDir = localDir;
      if (!fs.existsSync(rootDir) && instance.data_volume_path) {
        rootDir = instance.data_volume_path;
      }

      if (!fs.existsSync(rootDir)) {
        const containerName = instance.container_name || `mybay-agent-${instance.id}`;
        try {
          const container = docker.getContainer(containerName);
          const inspectData = await container.inspect();
          const mounts = inspectData.Mounts || [];
          const optDataMount = mounts.find((m: any) => m.Destination === "/opt/data");
          if (optDataMount && optDataMount.Source) {
            const hostPathFound = optDataMount.Source;
            let resolvedLocal = null;
            try {
              const hostname = os.hostname();
              if (hostname) {
                const selfContainer = docker.getContainer(hostname);
                const selfData = await selfContainer.inspect();
                const m = selfData.Mounts?.find((m: any) => hostPathFound.startsWith(m.Source));
                if (m) {
                  resolvedLocal = path.join(m.Destination, hostPathFound.substring(m.Source.length));
                }
              }
            } catch (me) {}
            if (resolvedLocal && fs.existsSync(resolvedLocal)) {
              rootDir = resolvedLocal;
            } else if (fs.existsSync(hostPathFound)) {
              rootDir = hostPathFound;
            } else if (fs.existsSync(localDir)) {
              rootDir = localDir;
            }
          }
        } catch (e) {}
      }

      const filesToPack: { absolutePath: string; archivePath: string; size: number }[] = [];
      let totalSize = 0;

      const uploadsDirs = ["uploads", "input", "inputs", "documents", "files"];
      const outputsDirs = ["outputs", "output", "results", "artifacts"];
      const dirExclusions = ["logs", "cache", "sessions", "tmp", "node_modules", ".venv", "venv", "__pycache__", ".git", "secrets", "keys", "certs"];

      function scanDir(currentDir: string, archivePrefix: string) {
        try {
          if (!fs.existsSync(currentDir)) return;
          const stats = fs.lstatSync(currentDir);
          if (stats.isSymbolicLink()) return;
          if (!stats.isDirectory()) return;

          const basename = path.basename(currentDir);
          if (dirExclusions.includes(basename.toLowerCase())) {
            return;
          }

          let items: string[] = [];
          try {
            items = fs.readdirSync(currentDir);
          } catch (readdirErr) {
            console.warn(`[Export Archive] Failed to read directory: ${currentDir}`, readdirErr);
            return;
          }

          for (const item of items) {
            const fullPath = path.join(currentDir, item);
            const itemArchivePath = path.join(archivePrefix, item);

            if (!rootDir) return;
            // Path traversal safeguard
            const resolvedRoot = path.resolve(rootDir);
            const resolvedPath = path.resolve(fullPath);
            const relativePath = path.relative(resolvedRoot, resolvedPath);
            if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
              continue;
            }

            try {
              const itemStats = fs.lstatSync(fullPath);
              if (itemStats.isSymbolicLink()) {
                continue;
              }

              if (itemStats.isDirectory()) {
                scanDir(fullPath, itemArchivePath);
              } else if (itemStats.isFile()) {
                const lowerName = item.toLowerCase();
                if (
                  lowerName === ".env" ||
                  lowerName === "config.yaml" ||
                  lowerName === "mybay.instance.yaml" ||
                  lowerName.endsWith(".db") ||
                  lowerName.endsWith(".sqlite") ||
                  lowerName.endsWith(".sqlite3") ||
                  lowerName.endsWith(".pem") ||
                  lowerName.endsWith(".key") ||
                  lowerName.endsWith(".crt") ||
                  lowerName.endsWith(".log")
                ) {
                  continue;
                }

                if (isSensitiveFile(item)) {
                  continue;
                }

                // Limit single file size to 100MB
                if (itemStats.size > 100 * 1024 * 1024) {
                  continue;
                }

                const safeArchivePath = itemArchivePath.split(path.sep).join("/");
                filesToPack.push({
                  absolutePath: fullPath,
                  archivePath: safeArchivePath,
                  size: itemStats.size
                });
                totalSize += itemStats.size;
              }
            } catch (err) {
              console.warn(`[Export Archive] Skip file error: ${fullPath}`, err);
            }
          }
        } catch (globalErr) {
          console.warn(`[Export Archive] scanDir global error for: ${currentDir}`, globalErr);
        }
      }

      if (rootDir && fs.existsSync(rootDir)) {
        for (const udir of uploadsDirs) {
          const target = path.join(rootDir, udir);
          if (fs.existsSync(target)) {
            scanDir(target, udir);
          }
        }
        for (const odir of outputsDirs) {
          const target = path.join(rootDir, odir);
          if (fs.existsSync(target)) {
            scanDir(target, odir);
          }
        }
      }

      const totalLimit = req.user.role === 'admin' ? 1024 * 1024 * 1024 : 500 * 1024 * 1024;
      if (totalSize > totalLimit) {
        const limitStr = req.user.role === 'admin' ? "1GB" : "500MB";
        return res.status(400).json({ error: `备份数据量超限。当前实例可导出文件总大小为 ${(totalSize / (1024 * 1024)).toFixed(1)}MB，超过了单次导出上限 (${limitStr})。` });
      }

      const manifest = {
        instance_id: instance.id,
        instance_name: instance.name,
        exported_at: new Date().toISOString(),
        platform: "MyBay",
        archive_version: 1,
        redacted: true,
        included_sections: ["manifest", "config", "business-config", "template-inputs"]
      };

      if (filesToPack.length > 0) {
        manifest.included_sections.push("uploads");
        manifest.included_sections.push("outputs");
      }

      const safeName = (instance.name || "instance").replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `mybay-agent-backup-${safeName}-${instance.id}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const archiverFactory = resolveArchiverFactory();
      const archive = archiverFactory('zip', { zlib: { level: 9 } });

      const archivePromise = new Promise<void>((resolve, reject) => {
        let settled = false;

        archive.on('warning', function(err) {
          if (err.code !== 'ENOENT') {
            console.error(`[Export Archive Warning] Instance ID: ${instance?.id || req.params.id}, Error:`, err);
          }
        });

        archive.on('error', function(err) {
          console.error(`[Export Archive Error] Instance ID: ${instance?.id || req.params.id}, Error:`, err);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });

        res.on('finish', () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        });

        res.on('close', () => {
          if (!settled) {
            settled = true;
            const err = new Error("Client disconnected before archive stream finished");
            console.warn(`[Export Archive Error] Connection closed prematurely before finish. Instance ID: ${instance?.id || req.params.id}`);
            reject(err);
          }
        });

        archive.pipe(res);
      });

      console.log(
        `[Export Archive] Starting zip compilation.\n` +
        `Instance ID: ${instance.id}\n` +
        `RootDir: ${rootDir || 'undefined'}\n` +
        `Files count to pack: ${filesToPack.length}\n` +
        `Total size: ${totalSize} bytes\n` +
        `Uploads/Outputs found: ${filesToPack.length > 0 ? "Yes" : "No"}`
      );

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      archive.append(JSON.stringify(redactedConfig, null, 2), { name: 'config.redacted.json' });
      archive.append(JSON.stringify(businessConfig, null, 2), { name: 'business-config.json' });
      archive.append(JSON.stringify(templateInputs, null, 2), { name: 'template-inputs.json' });

      const readmeContent = `MyBay Agent Backup Archive
==========================

This backup package was exported from MyBay on ${manifest.exported_at}.

Included contents:
- manifest.json: Metadata about this export
- config.redacted.json: Redacted configuration (API keys, credentials, and passwords have been removed for security)
- business-config.json: Redacted business configuration
- template-inputs.json: Redacted template inputs configuration
- uploads/: User-uploaded data documents (if any exist and within limits)
- outputs/: Generated artifacts and output files (if any exist and within limits)

Excluded contents (NOT INCLUDED):
- Sensitive credentials, system passwords, API Keys, or active login sessions (.env, database files, certs)
- Runtime dependencies and cache (node_modules, logs, tmp, cache, sessions)
- Container system environments

Note:
This backup package is designed for troubleshooting, offline data review, and safe storage. 
API keys, credentials, and passwords must be manually reconfigured upon future restore or clone.
`;
      archive.append(readmeContent, { name: 'README.txt' });

      for (const file of filesToPack) {
        try {
          if (fs.existsSync(file.absolutePath)) {
            archive.file(file.absolutePath, { name: file.archivePath });
          } else {
            console.warn(`[Export Archive] File missing dynamically, skipping: ${file.absolutePath}`);
          }
        } catch (fileErr: any) {
          console.error(`[Export Archive] Failed to append file ${file.absolutePath} (skipped):`, fileErr);
        }
      }

      console.log(`[Export Archive] Finalizing archive for instance ${instance.id}`);
      await archive.finalize();
      console.log(`[Export Archive] Archive finalize call finished for instance ${instance.id}`);

      await archivePromise;
      console.log(`[Export Archive] Zip archive output streamed completely for instance ${instance.id}`);

      await dbAdapter.insertAuditLog({
        instance_id: instance.id,
        action: "export_archive",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Exported redacted instance backup package (.zip)"
      }).catch(() => {});

    } catch (e: any) {
      console.error(
        `[Config API] Export Archive error:\n` +
        `Instance ID: ${req.params.id}\n` +
        `Typeof config_json: ${typeof (instance?.config_json)}\n` +
        `Root Directory: ${rootDir || 'undefined'}\n` +
        `Error: ${e?.message}\n` +
        `Stack: ${e?.stack}`
      );
      if (!res.headersSent) {
        res.status(500).json({ error: "应用打包导出失败，服务器内部异常" });
      }
    }
  });

  router.put("/:id/config", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rawData = req.body;

      // 1. Backend format validation
      // Check Model API Key
      if (rawData.providerApiKey && typeof rawData.providerApiKey === 'string' && !isMaskedSecretPlaceholder(rawData.providerApiKey)) {
        const keyLower = rawData.providerApiKey.toLowerCase();
        const username = req.user?.username ? req.user.username.toLowerCase() : "";
        if (username && (keyLower === username || keyLower.includes(username))) {
          return res.status(400).json({ error: "模型 API Key 格式不正确，检测到被自动填充为了您的账号邮箱，请重新输入。" });
        }
      }

      // Check Feishu
      let channel = rawData.channel || "web";
      if (channel === "none") {
        channel = "web";
      }
      rawData.channel = channel;

      const { validateInstanceConfigPolicy } = await import("../../utils/instanceConfigPolicy");
      const policyResult = await validateInstanceConfigPolicy({
        user: req.user,
        channel: channel,
        skills: rawData.skills,
        confirmed_skill_ids: rawData.confirmed_skill_ids || rawData.accepted_permissions,
        confirm_dangerous_skills: rawData.confirm_dangerous_skills,
        envAllowsDockerSocket: process.env.ENABLE_DOCKER_SOCKET_SKILL === "true",
        settingsAllowsDockerSocket: await dbAdapter.getSystemSettingBoolean("admin_docker_socket_enabled", false)
      });

      if (policyResult.status !== 200) {
        if (policyResult.auditLogDetails) {
          await dbAdapter.insertAuditLog({
            instance_id: req.params.id,
            action: "security_violation",
            user_id: req.user.id,
            timestamp: new Date().toISOString(),
            details: policyResult.auditLogDetails
          });
        }
        return res.status(policyResult.status).json({
          error: policyResult.error,
          message: policyResult.message,
          metadata: policyResult.metadata
        });
      }

      if (channel === "feishu" || channel === "lark") {
        const appId = rawData.feishuAppId;
        const appSecret = rawData.feishuAppSecret;
        if (!appId || typeof appId !== "string" || !appId.startsWith("cli_")) {
          return res.status(400).json({ error: "飞书 App ID 格式不正确，不得使用邮箱地址，必须以 cli_ 开头的 App ID。" });
        }
        if (appId.includes("@")) {
          return res.status(400).json({ error: "飞书 App ID 格式不正确，不得使用邮箱地址，必须以 cli_ 开头的 App ID。" });
        }
        if (appSecret !== undefined && !isMaskedSecretPlaceholder(appSecret)) {
          if (!appSecret || typeof appSecret !== "string" || appSecret.trim() === "") {
            return res.status(400).json({ error: "飞书 App Secret 不能为空。" });
          }
        }
      }

      const data = sanitizeChannelConfigForChannel(rawData);

      // Schema Validation: Ensure types are strings
      if (data.provider !== undefined && typeof data.provider !== 'string') {
        return res.status(400).json({ error: "配置格式验证错误：'provider' (current_provider) 必须是 string 字符串类型。" });
      }
      if (data.model !== undefined && typeof data.model !== 'string') {
        return res.status(400).json({ error: "配置格式验证错误：'model' (current_model) 必须是 string 字符串类型。" });
      }
      if (data.baseUrl !== undefined && typeof data.baseUrl !== 'string') {
        return res.status(400).json({ error: "配置格式验证错误：'baseUrl' (base_url) 必须是 string 字符串类型。" });
      }
      if (data.providerApiKey !== undefined && typeof data.providerApiKey !== 'string') {
        return res.status(400).json({ error: "配置格式验证错误：'providerApiKey' (apiKey) 必须是 string 字符串类型。" });
      }
      if (data.enableDashboard !== undefined && typeof data.enableDashboard !== 'boolean') {
        return res.status(400).json({ error: "配置格式验证错误：'enableDashboard' 必须是 boolean 布尔类型。" });
      }

      // Provider and Model Validation
      if (data.provider !== undefined) {
        data.provider = resolveProviderRegistryKey(data.provider, data.model, data.baseUrl);
        const regConf = registry[data.provider];
        if (!regConf || !regConf.enabled) {
          return res.status(400).json({ error: `配置格式验证错误：不支持的模型供应商 "${data.provider}"，或该提供商已被废弃/下线。` });
        }

        if (data.model !== undefined) {
          const isCustom = data.isCustomModel === true || data.provider === "custom-openai-compatible";
          if (!isCustom) {
            const allowedModels = regConf.models || [];
            if (allowedModels.length > 0 && !allowedModels.includes(data.model)) {
              return res.status(400).json({ error: `配置格式验证错误：模型供应商 "${regConf.label}" 不包含选中的模型 "${data.model}"。如果您欲使用其他自定义模型，请勾选“自定义模型”。` });
            }
          }
        }
      }

      // Base URL validation
      if (data.baseUrl !== undefined && data.baseUrl.trim() !== '') {
        try {
          const parsedUrl = new URL(data.baseUrl);
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return res.status(400).json({ error: "配置格式验证错误：自定义 API Base URL 必须是 http: 或 https: 协议的合法 URL。" });
          }
        } catch (err) {
          return res.status(400).json({ error: "配置格式验证错误：自定义 API Base URL 不是一个合法的 URL 格式。" });
        }

        const ssrfRes = await checkSSRFSafe(data.baseUrl);
        if (!ssrfRes.safe) {
          return res.status(400).json({ error: "安全校验拦截 (SSRF): " + (ssrfRes.error || "未知") });
        }
      }

      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const expectedName = instance.container_name || `mybay-agent-${instance.id}`;

      // Resolve saved credential if provided during update
      if (data.providerCredentialId) {
        try {
          const cred = await dbAdapter.getCredentialById(data.providerCredentialId, req.user.id);
          applySavedProviderCredential(data, cred);
        } catch (err: any) {
          console.error("Failed to resolve credential for instance update:", err);
          const code = err instanceof SavedProviderCredentialError ? err.code : "CREDENTIAL_RESOLUTION_FAILED";
          const status = err instanceof SavedProviderCredentialError ? 400 : 500;
          return res.status(status).json({
            code,
            error: code === "CREDENTIAL_NOT_FOUND"
              ? "The selected saved credential no longer exists."
              : code === "CREDENTIAL_DECRYPT_FAILED"
                ? "The selected saved credential cannot be decrypted. Save it again and retry."
                : "Failed to resolve the selected saved credential."
          });
        }
      }
      
      const config = JSON.parse(instance.config_json);
      const previousChannelConfig = { ...config };
      
      // Auto-generate hermesApiKey for legacy instances if not present
      if (!config.hermesApiKey) {
        const crypto = require("crypto");
        const generatedKey = `mb_hermes_${crypto.randomBytes(32).toString("hex")}`;
        config.hermesApiKey = encrypt(generatedKey);
      }

      if (data.hermesApiKey !== undefined && !isMaskedSecretPlaceholder(data.hermesApiKey)) {
        if (data.hermesApiKey !== "") {
          config.hermesApiKey = encrypt(data.hermesApiKey);
        }
      }
      if (data.chatApiKey !== undefined && !isMaskedSecretPlaceholder(data.chatApiKey)) {
        config.chatApiKey = data.chatApiKey === "" ? "" : encrypt(data.chatApiKey);
      }

      if (data.provider !== undefined) config.provider = data.provider;
      if (data.model !== undefined) config.model = data.model;
      if (data.baseUrl !== undefined) config.baseUrl = data.baseUrl;

      if (data.providerApiKey !== undefined && !isMaskedSecretPlaceholder(data.providerApiKey)) {
        config.providerApiKey = data.providerApiKey ? encrypt(data.providerApiKey) : config.providerApiKey;
      }
      if (data.providerCredentialId) {
        config.providerCredentialId = data.providerCredentialId;
        delete config.apiKey;
      }


      if (data.channel !== undefined) config.channel = data.channel;
      if (data.agentPrompt !== undefined) config.agentPrompt = data.agentPrompt;
      if (data.enableDashboard !== undefined) config.enableDashboard = data.enableDashboard;

      const dashboardAccessEnabled = config.enableDashboard !== false;
      if (!dashboardAccessEnabled) {
        delete config.password;
        delete config.webPasswordHash;
        delete config.dashboardAuthSecret;
        delete config.hermesDashboardAuthSecret;
      } else {
        if (data.password && data.password.trim() !== '' && !isMaskedSecretPlaceholder(data.password)) {
          config.webPasswordHash = bcrypt.hashSync(data.password, 10);
          config.password = encrypt(data.password);
          delete config.dashboardAuthSecret;
          delete config.hermesDashboardAuthSecret;
        }

        if (data.hermesDashboardAuthSecret !== undefined && data.hermesDashboardAuthSecret.trim() !== '' && !isMaskedSecretPlaceholder(data.hermesDashboardAuthSecret)) {
          config.hermesDashboardAuthSecret = encrypt(data.hermesDashboardAuthSecret);
        } else if (!config.hermesDashboardAuthSecret) {
          const crypto = require("crypto");
          config.hermesDashboardAuthSecret = encrypt("mb_dash_" + crypto.randomBytes(32).toString("hex"));
        }

        if (data.dashboardAuthSecret !== undefined && data.dashboardAuthSecret.trim() !== '' && !isMaskedSecretPlaceholder(data.dashboardAuthSecret)) {
          config.dashboardAuthSecret = encrypt(data.dashboardAuthSecret);
        } else if (!config.dashboardAuthSecret) {
          config.dashboardAuthSecret = config.hermesDashboardAuthSecret;
        }
        ensureEncryptedDashboardAuthSecret(config);
      }

      const isApiEnabled = config.channel === "api" || config.publicApiEnabled === true || config.exposeApi === true || config.publicApiEnabled === "true" || config.exposeApi === "true";
      if (isApiEnabled && !config.apiServerKey && !config.internalApiServerKey && !config.internalApiKey && !config.chatApiServerKey && !config.API_SERVER_KEY && !config.hermesApiKey && !config.chatApiKey) {
        if (process.env.NODE_ENV === "production") {
          return res.status(400).json({
            error: "API_KEY_REQUIRED",
            message: "生产环境下启用对话工作台/API模式时，必须配置内部 API Key (hermesApiKey 或 chatApiKey)"
          });
        }
      }

      if (data.telegramBotToken !== undefined && !isMaskedSecretPlaceholder(data.telegramBotToken)) {
        config.telegramBotToken = data.telegramBotToken ? encrypt(data.telegramBotToken) : config.telegramBotToken;
      }
      if (data.telegramAllowedUsers !== undefined) config.telegramAllowedUsers = data.telegramAllowedUsers;

      if (data.discordBotToken !== undefined && !isMaskedSecretPlaceholder(data.discordBotToken)) {
        config.discordBotToken = data.discordBotToken ? encrypt(data.discordBotToken) : config.discordBotToken;
      }
      if (data.discordAllowedGuilds !== undefined) config.discordAllowedGuilds = data.discordAllowedGuilds;

      if (data.feishuAppId !== undefined) {
        config.feishuAppId = typeof data.feishuAppId === 'string' ? data.feishuAppId.trim() : data.feishuAppId;
      }
      if (data.feishuAppSecret !== undefined && !isMaskedSecretPlaceholder(data.feishuAppSecret)) {
        const sec = typeof data.feishuAppSecret === 'string' ? data.feishuAppSecret.trim() : '';
        if (sec) {
          config.feishuAppSecret = encrypt(sec);
        }
      }
      if (data.feishuRegion !== undefined) {
        config.feishuRegion = data.feishuRegion;
      }

      if (data.qqBotAppId !== undefined) config.qqBotAppId = data.qqBotAppId;
      if (data.qqBotSecret !== undefined && !isMaskedSecretPlaceholder(data.qqBotSecret)) {
        config.qqBotSecret = data.qqBotSecret ? encrypt(data.qqBotSecret) : config.qqBotSecret;
      }

      if (data.whatsappPhoneNumberId !== undefined) config.whatsappPhoneNumberId = data.whatsappPhoneNumberId;
      if (data.whatsappAccessToken !== undefined && !isMaskedSecretPlaceholder(data.whatsappAccessToken)) {
        config.whatsappAccessToken = data.whatsappAccessToken ? encrypt(data.whatsappAccessToken) : config.whatsappAccessToken;
      }

      if (data.slackBotToken !== undefined && !isMaskedSecretPlaceholder(data.slackBotToken)) {
        config.slackBotToken = data.slackBotToken ? encrypt(data.slackBotToken) : config.slackBotToken;
      }
      if (data.slackSigningSecret !== undefined && !isMaskedSecretPlaceholder(data.slackSigningSecret)) {
        config.slackSigningSecret = data.slackSigningSecret ? encrypt(data.slackSigningSecret) : config.slackSigningSecret;
      }
      if (data.slackAppToken !== undefined && !isMaskedSecretPlaceholder(data.slackAppToken)) {
        config.slackAppToken = data.slackAppToken ? encrypt(data.slackAppToken) : config.slackAppToken;
      }

      if (data.dingtalkAppKey !== undefined) config.dingtalkAppKey = data.dingtalkAppKey;
      if (data.dingtalkAppSecret !== undefined && !isMaskedSecretPlaceholder(data.dingtalkAppSecret)) {
        config.dingtalkAppSecret = data.dingtalkAppSecret ? encrypt(data.dingtalkAppSecret) : config.dingtalkAppSecret;
      }
      if (data.dingtalkRobotSecret !== undefined && !isMaskedSecretPlaceholder(data.dingtalkRobotSecret)) {
        config.dingtalkRobotSecret = data.dingtalkRobotSecret ? encrypt(data.dingtalkRobotSecret) : config.dingtalkRobotSecret;
      }
      if (data.dingtalkAllowedUsers !== undefined) config.dingtalkAllowedUsers = data.dingtalkAllowedUsers;
      if (data.dingtalkAllowedChats !== undefined) config.dingtalkAllowedChats = data.dingtalkAllowedChats;

      if (data.wechatAppId !== undefined) config.wechatAppId = data.wechatAppId;
      if (data.wechatAppSecret !== undefined && !isMaskedSecretPlaceholder(data.wechatAppSecret)) {
        config.wechatAppSecret = data.wechatAppSecret ? encrypt(data.wechatAppSecret) : config.wechatAppSecret;
      }
      if (data.wechatAgentId !== undefined) config.wechatAgentId = data.wechatAgentId;

      if (data.wecomAppId !== undefined) config.wecomAppId = data.wecomAppId;
      if (data.wecomAppSecret !== undefined && !isMaskedSecretPlaceholder(data.wecomAppSecret)) {
        config.wecomAppSecret = data.wecomAppSecret ? encrypt(data.wecomAppSecret) : config.wecomAppSecret;
      }
      if (data.wecomToken !== undefined && !isMaskedSecretPlaceholder(data.wecomToken)) {
        config.wecomToken = data.wecomToken ? encrypt(data.wecomToken) : config.wecomToken;
      }
      if (data.wecomEncodingAesKey !== undefined && !isMaskedSecretPlaceholder(data.wecomEncodingAesKey)) {
        config.wecomEncodingAesKey = data.wecomEncodingAesKey ? encrypt(data.wecomEncodingAesKey) : config.wecomEncodingAesKey;
      }
      if (data.wecomAgentId !== undefined) config.wecomAgentId = data.wecomAgentId;
      if (data.wecomAllowedUsers !== undefined) config.wecomAllowedUsers = data.wecomAllowedUsers;
      if (data.wecomAllowedChats !== undefined) config.wecomAllowedChats = data.wecomAllowedChats;

      if (data.wechatMpAppId !== undefined) config.wechatMpAppId = data.wechatMpAppId;
      if (data.wechatMpAppSecret !== undefined && !isMaskedSecretPlaceholder(data.wechatMpAppSecret)) {
        config.wechatMpAppSecret = data.wechatMpAppSecret ? encrypt(data.wechatMpAppSecret) : config.wechatMpAppSecret;
      }
      if (data.wechatMpToken !== undefined && !isMaskedSecretPlaceholder(data.wechatMpToken)) {
        config.wechatMpToken = data.wechatMpToken ? encrypt(data.wechatMpToken) : config.wechatMpToken;
      }
      if (data.wechatMpEncodingAesKey !== undefined && !isMaskedSecretPlaceholder(data.wechatMpEncodingAesKey)) {
        config.wechatMpEncodingAesKey = data.wechatMpEncodingAesKey ? encrypt(data.wechatMpEncodingAesKey) : config.wechatMpEncodingAesKey;
      }
      if (data.wechatMpAllowedUsers !== undefined) config.wechatMpAllowedUsers = data.wechatMpAllowedUsers;
      if (data.wechatMpAllowedChats !== undefined) config.wechatMpAllowedChats = data.wechatMpAllowedChats;

      if (data.weixinAccountId !== undefined) config.weixinAccountId = data.weixinAccountId;
      if (data.weixinBaseUrl !== undefined) config.weixinBaseUrl = data.weixinBaseUrl;
      if (data.weixinAllowedUsers !== undefined) config.weixinAllowedUsers = data.weixinAllowedUsers;
      if (data.weixinAllowedChats !== undefined) config.weixinAllowedChats = data.weixinAllowedChats;
      if (data.weixinToken !== undefined && !isMaskedSecretPlaceholder(data.weixinToken)) {
        config.weixinToken = data.weixinToken ? encrypt(data.weixinToken) : config.weixinToken;
      }

      if (data.webhookUrl !== undefined) config.webhookUrl = data.webhookUrl;
      if (data.webhookSecret !== undefined && !isMaskedSecretPlaceholder(data.webhookSecret)) {
        config.webhookSecret = data.webhookSecret ? encrypt(data.webhookSecret) : config.webhookSecret;
        if (data.webhookSecret) {
          config.webhookAuthMode = "secret-required";
        }
      }

      if (data.pet !== undefined) config.pet = data.pet;
      if (data.learn !== undefined) config.learn = data.learn;

      if (data.skills !== undefined) {
        config.skills = data.skills;
      }
      if (data.skillTavilyApiKey !== undefined && !isMaskedSecretPlaceholder(data.skillTavilyApiKey)) {
        config.skillTavilyApiKey = data.skillTavilyApiKey ? encrypt(data.skillTavilyApiKey) : config.skillTavilyApiKey;
      }
      if (data.skillSerperApiKey !== undefined && !isMaskedSecretPlaceholder(data.skillSerperApiKey)) {
        config.skillSerperApiKey = data.skillSerperApiKey ? encrypt(data.skillSerperApiKey) : config.skillSerperApiKey;
      }
      if (data.skillGithubToken !== undefined && !isMaskedSecretPlaceholder(data.skillGithubToken)) {
        config.skillGithubToken = data.skillGithubToken ? encrypt(data.skillGithubToken) : config.skillGithubToken;
      }

      // Resolve dynamic and safe limits under user policy constraints
      const resolvedLimits = await resolveResourceLimitsForInstance(
        req.user,
        isAdvancedResourceConfigEnabled() && data.limitsCpu !== undefined ? data.limitsCpu : config.limitsCpu,
        isAdvancedResourceConfigEnabled() && data.limitsMem !== undefined ? data.limitsMem : config.limitsMem,
        instance.user_id || req.user.id,
        { preserveExisting: !isAdvancedResourceConfigEnabled() }
      );

      config.limitsCpu = resolvedLimits.limitsCpu;
      config.limitsMem = resolvedLimits.limitsMem;

      const normalizedConfig = sanitizeChannelConfigForChannel(config);
      const acceptanceSensitiveKeys = [
        "channel", "telegramBotToken", "discordBotToken", "feishuAppId", "feishuAppSecret", "feishuRegion",
        "qqBotAppId", "qqBotSecret", "whatsappPhoneNumberId", "whatsappAccessToken", "slackBotToken",
        "slackSigningSecret", "slackAppToken", "dingtalkAppKey", "dingtalkAppSecret", "dingtalkRobotSecret",
        "wechatAppId", "wechatAppSecret", "wechatAgentId", "wecomAppId", "wecomAppSecret", "wecomToken",
        "wecomEncodingAesKey", "wecomAgentId", "wechatMpAppId", "wechatMpAppSecret", "wechatMpToken",
        "wechatMpEncodingAesKey", "weixinAccountId", "weixinBaseUrl", "weixinToken", "webhookUrl", "webhookSecret",
      ];
      const acceptanceInvalidated = acceptanceSensitiveKeys.some(
        (key) => JSON.stringify(previousChannelConfig[key] ?? null) !== JSON.stringify(normalizedConfig[key] ?? null),
      );
      if (acceptanceInvalidated) {
        delete normalizedConfig.channelAcceptance;
        delete normalizedConfig.channel_acceptance;
      }

      // If Web channel instance is missing password/webPasswordHash/dashboardAuthSecret, block it!
      const isWeb = normalizedConfig.channel === "web" || !normalizedConfig.channel;
      const dashboardAccessEnabledAfterUpdate = normalizedConfig.enableDashboard !== false;
      if (dashboardAccessEnabledAfterUpdate && isWeb) {
        const { tryResolvePlainInstancePassword } = await import("../../crypto");
        const plainPass = tryResolvePlainInstancePassword(normalizedConfig);
        if (!plainPass || !normalizedConfig.webPasswordHash || !normalizedConfig.dashboardAuthSecret || !normalizedConfig.hermesDashboardAuthSecret) {
          return res.status(400).json({
            error: "PASSWORD_MISSING",
            message: "面板访问密码不可用，实例无法完成 Dashboard 登录配置。请重置访问密码后重新部署。"
          });
        }
      }

      // --- Local container locator security audit ---
      try {
        const dbContainerId = instance.container_id;
        const dbContainerName = instance.container_name;

        if (!dbContainerId && !dbContainerName) {
          return res.status(400).json({
            error: "容器定位自检判定：由于该实例在数据库中没有容器标识（container_id 与 container_name 均为空），暂无法进行配置热更新保存并重启。请确认实例已被成功初次部署上线。"
          });
        }

        const containers = await docker.listContainers({ all: true });

        // Helper function for safe, compatible container ID matching (long vs short)
        const isContainerIdMatch = (dockerId: string, savedId: string) => {
          if (!dockerId || !savedId) return false;
          const dId = dockerId.toLowerCase();
          const sId = savedId.toLowerCase();
          if (dId === sId) return true;
          if (sId.length >= 12 && dId.startsWith(sId)) return true;
          if (dId.length >= 12 && sId.startsWith(dId)) return true;
          return false;
        };

        const localExpectedName = dbContainerName || `mybay-agent-${instance.id}`;

        if (dbContainerId) {
          // 1. Try to find container by DB containerId
          const matchingContainer = containers.find((c: any) => isContainerIdMatch(c.Id, dbContainerId));
          if (matchingContainer) {
            // Validate that the matched container name matches our expectedName style
            const hasExpectedNameName = matchingContainer.Names.some((n: string) => {
              const cleanName = n.startsWith('/') ? n.substring(1) : n;
              return cleanName === localExpectedName || cleanName === `${localExpectedName}-dashboard` || cleanName === `${localExpectedName}-gateway`;
            });
            if (!hasExpectedNameName) {
              return res.status(400).json({
                error: `容器定位安全拦截：数据库指向的 container_id (${dbContainerId.substring(0, 12)}) 与其宿主中的物理容器名称不相符，这可能是属于其他实体的残留，为防范越权或配置误覆盖，更新操作已被熔断。`
              });
            }
          } else {
            // Find anyway if matched by expectedName, as fallback
            const hasBackupByName = containers.find((c: any) => {
              return c.Names.some((n: string) => {
                const cleanName = n.startsWith('/') ? n.substring(1) : n;
                return cleanName === localExpectedName || cleanName === `${localExpectedName}-dashboard` || cleanName === `${localExpectedName}-gateway`;
              });
            });
            if (!hasBackupByName) {
              return res.status(400).json({
                error: `容器定位安全拦截：数据库中存储的特定 container_id (${dbContainerId.substring(0, 12)}) 关联的物理容器在宿主机中已不复存在。`
              });
            }
          }
        } else {
          // 2. No dbContainerId, fallback to dbContainerName
          const hasBackupByName = containers.find((c: any) => {
            return c.Names.some((n: string) => {
              const cleanName = n.startsWith('/') ? n.substring(1) : n;
              return cleanName === localExpectedName || cleanName === `${localExpectedName}-dashboard` || cleanName === `${localExpectedName}-gateway`;
            });
          });

          if (!hasBackupByName) {
            return res.status(400).json({
              error: `容器定位安全拦截：无法在宿主引擎中匹配到任何名称为 "${localExpectedName}" (来自数据库 container_name) 的有效运行期或静默态物理容器。请检查并确认其已被部署初始化。`
            });
          }
        }
      } catch (err: any) {
        console.error("Local container locator audit failed:", err);
        return res.status(500).json({ error: "容器定位自检判定异常，服务器内部异常" });
      }

      const isFeishu = normalizedConfig.channel === "feishu" || 
                       normalizedConfig.channel === "lark" || 
                       (Array.isArray(normalizedConfig.channel) && normalizedConfig.channel.some((ch: any) => ["feishu", "lark"].includes(String(ch).toLowerCase())));

      const MY_BAY_IMAGE = process.env.MY_BAY_IMAGE?.trim() || "nousresearch/hermes-agent";
      let nextAgentImage = instance.agent_image;
      let nextAgentImageTag = instance.agent_image_tag;
      const versions = await dbAdapter.getMyBayVersions();
      const currentFamilyTag = String(nextAgentImageTag || "").replace(/-feishu$/, "");
      const matchingVersion = versions.find((version: any) => {
        const tag = version.image_tag || version.tag || version.version;
        return tag === currentFamilyTag || version.version === currentFamilyTag;
      });

      if (isFeishu) {
        if (!matchingVersion || !supportsFeishu(matchingVersion)) {
          return res.status(409).json({
            code: "FEISHU_CAPABILITY_REQUIRED",
            params: { version: currentFamilyTag },
            error: "The configured official Hermes version does not support Feishu/Lark."
          });
        }
        nextAgentImage = matchingVersion.image || MY_BAY_IMAGE;
        nextAgentImageTag = matchingVersion.image_tag || matchingVersion.tag || matchingVersion.version;
      } else if (matchingVersion && /-feishu$/i.test(String(nextAgentImageTag || ""))) {
        nextAgentImage = matchingVersion.image || MY_BAY_IMAGE;
        nextAgentImageTag = matchingVersion.image_tag || matchingVersion.tag || matchingVersion.version;
      }

      await dbAdapter.updateInstanceConfig(req.params.id, JSON.stringify(normalizedConfig));
      await dbAdapter.updateInstanceVersionInfo(req.params.id, {
        model_provider: normalizedConfig.provider || null,
        model_name: normalizedConfig.model || null,
        model_base_url: normalizedConfig.baseUrl || null,
        model_config_status: 'pending',
        model_config_error: null,
        limitsCpu: parseFloat(resolvedLimits.limitsCpu),
        limitsMemory: resolvedLimits.limitsMem,
        limitsMemoryMb: resolvedLimits.limitsMemoryMb,
        agent_image: nextAgentImage,
        agent_image_tag: nextAgentImageTag
      });
      
      await dbAdapter.insertAuditLog({
        instance_id: req.params.id,
        action: "update_config",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Updated instance configuration"
      });
      
      await wrappedUpdateStatus.run({ status: "restarting", id: req.params.id });
      
      const instanceFull: any = await dbAdapter.getInstanceById(req.params.id);
      if (instanceFull) {
        const { cleanOldContainersOfInstance } = await import("../../deployment");
        cleanOldContainersOfInstance(req.params.id, io).then(() => {
          executeDeployment(instanceFull, io, wrappedUpdateStatus, normalizedConfig, req.user);
        }).catch((err) => {
          console.error("Clean old containers failed:", err);
          executeDeployment(instanceFull, io, wrappedUpdateStatus, normalizedConfig, req.user);
        });
      }

      res.json({
        success: true,
        configSaved: true,
        restartTriggered: true,
        containerName: expectedName,
        message: "配置修改成功！配置已保存，容器正在重启..."
      });
    } catch (e: any) {
      console.error(e);
      if (sendEntitlementError(res, e)) return;
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/:id/allow-mode", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const { allowMode } = req.body;
      if (!["bind_later", "allowlist", "allow_all", "disabled"].includes(allowMode)) {
        return res.status(400).json({ error: "Invalid allowMode" });
      }

      const config = JSON.parse(instance.config_json || "{}");
      config.allowMode = allowMode;
      config.gatewayAllowAllUsers = (allowMode === "allow_all");

      const updatedConfigJson = JSON.stringify(config);
      await dbAdapter.updateInstanceConfig(instance.id, updatedConfigJson);

      const { writePhysicalConfigs } = await import("../../configWriter");
      writePhysicalConfigs(instance.id, config);

      // Reload config
      const { docker } = await import("../../lib/docker");
      const containerName = `mybay-agent-${instance.id}`;
      const container = docker.getContainer(containerName);
      try {
        await dbAdapter.insertAuditLog({ instance_id: instance.id, action: "restart_container", user_id: req.user.id, timestamp: new Date().toISOString(), details: `Restart container for allowMode config update` }).catch(()=>console.error);
        await container.restart();
      } catch (err) {
        console.warn("[AllowMode] Failed to restart container:", err);
      }

      res.json({ success: true, allowMode, config: sanitizeConfig(config) });
    } catch (e: any) {
      console.error("[Config API] Save error:", e);
      res.status(500).json({ error: "保存配置失败，服务器内部异常" });
    }
  });

  router.get("/:id/runtime-context", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const configJson = JSON.parse(instance.config_json || "{}");
      const { parseInstanceRuntimeContext } = await import("../../services/instanceRuntimeContext");
      
      const runtimeContext = parseInstanceRuntimeContext(
        instance,
        configJson,
        configJson.businessConfig || {}
      );
      
      res.json(runtimeContext);
    } catch (e: any) {
      console.error("[Config API] Get runtime context error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.get("/:id/business-config", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const config = JSON.parse(instance.config_json || "{}");
      res.json({ businessConfig: config.businessConfig || {} });
    } catch (e: any) {
      console.error("[Config API] Get business config error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.put("/:id/business-config", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const config = JSON.parse(instance.config_json || "{}");
      config.businessConfig = { ...config.businessConfig, ...req.body.businessConfig };
      
      await dbAdapter.updateInstanceConfig(req.params.id, JSON.stringify(config));

      try {
        const { refreshInstanceWorkflowReadiness } = await import("../../services/workflowReadinessService");
        await refreshInstanceWorkflowReadiness(req.params.id, config);
      } catch (syncErr: any) {
        console.warn("[Business Config] Failed to synchronize workflow readiness:", syncErr.message || String(syncErr));
      }
      
      await dbAdapter.insertAuditLog({
        instance_id: req.params.id,
        action: "update_business_config",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Updated instance business configuration"
      });

      res.json({ success: true, businessConfig: config.businessConfig });
    } catch (e: any) {
      console.error("[Config API] Put business config error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  return router;
}




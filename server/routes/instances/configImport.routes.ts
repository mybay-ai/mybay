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
import {
  isPrivilegedUser,
  parseInstanceConfigJson,
  resolveProviderCredentialSelection,
} from "../../services/instanceConfig/instanceConfigRoutePolicy";
import { createRuntimeConfigRoutes } from "./config/runtimeConfig.routes";

export function createConfigImportRoutes(deps: RouterDependencies) {
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

  return router;
}

import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { createHash } from "crypto";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { isAdvancedResourceConfigEnabled } from "../../utils/advancedResourceConfigFeature";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { sanitizeChannelConfigForChannel } from "../../utils/channelConfigSanitizer";
import { assertCanCreateInstance, assertCanUseChannel, getEffectiveEntitlements, getStorageLimitMb, sendEntitlementError } from "../../services/entitlements";

import { RouterDependencies } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt, tryResolvePlainInstancePassword } from "../../crypto";
import { isMaskedSecretPlaceholder, redactSecretsDeep } from "../../utils/sanitizer";
import bcrypt from "bcryptjs";
import { findAvailablePort, listInstancePortCandidates } from "../../utils";
import { execFile } from "child_process";
import { rebuildProxyConfig } from "../../deployment"; // Used maybe? Assumed in configWriter
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";
import { providerRegistry as registry } from "../../../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../../../shared/providerRegistryUtils";
import { ensureEncryptedDashboardAuthSecret } from "../../utils/dashboardAuthSecret";
import { buildWorkflowReadinessPayload, evaluateWorkflowReadiness, initialTaskStatus, selectInitialExecutionTasks } from "../../templates/productionPolicy";
import { buildWorkflowReadinessContext } from "../../services/workflowReadinessService";
import { getRuntimeReleaseBoundary } from "../../utils/runtimeReleaseBoundary";
import { applySavedProviderCredential, SavedProviderCredentialError } from "../../utils/savedProviderCredential";
import { summarizeBlueprintChildResults } from "../../services/blueprintIntegrityService";
import { hasTemplateDeploymentPayload, isTemplateWorkflowsEnabled } from "../../utils/templateWorkflowsFeature";
import { supportsFeishu } from "../../utils/hermesCapabilities";

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const createInstanceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req: AuthenticatedRequest) => {
    if (req.user?.id) return `instance-create:user:${req.user.id}`;
    return `instance-create:ip:${ipKeyGenerator(req.ip)}`;
  },
  message: { error: '创建实例频率过高，每小时仅允许创建 3 次。' }
});

export const checkLimitOrSkipAdmin = (req: AuthenticatedRequest, res: Response, next: import("express").NextFunction) => {
  if (req.user?.role === 'admin') {
    return next();
  }
  createInstanceLimiter(req, res, next);
};

export function createCreateRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.post("/", authenticateToken, checkLimitOrSkipAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const idempotencyKey = String(req.header("Idempotency-Key") || "").trim();
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 200)) {
      return res.status(400).json({ code: "INVALID_IDEMPOTENCY_KEY", error: "Idempotency-Key must contain 8 to 200 characters." });
    }
    const requestHash = createHash("sha256").update(canonicalJson(req.body || {})).digest("hex");
    if (idempotencyKey) {
      const existing = await dbAdapter.getIdempotencyRecord(idempotencyKey);
      if (existing) {
        if (existing.request_hash !== requestHash) {
          return res.status(409).json({ code: "IDEMPOTENCY_CONFLICT", error: "The Idempotency-Key was already used with a different payload." });
        }
        return res.status(202).json({
          instanceId: existing.instance_id,
          deploymentTaskId: existing.deployment_task_id,
          status: "queued",
          statusUrl: `/api/deployments/${existing.deployment_task_id}`,
          idempotentReplay: true,
        });
      }
    }
    let generatedId = require("crypto").randomUUID();
    if (!generatedId || typeof generatedId !== "string" || generatedId.trim() === "") {
      return res.status(500).json({ error: "服务器内部错误：无法生成有效的实例唯一标识符(generatedId)。" });
    }
    let instanceCreatedLocally = false;
    let deploymentTaskId = "";
    const movedFiles: Array<{ fileId: string; oldPath: string; newPath: string }> = [];
    try {
      const runtimeBoundary = getRuntimeReleaseBoundary(req.body?.runtime_type);
      if (runtimeBoundary) return res.status(runtimeBoundary.status).json(runtimeBoundary);

      const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");
      // 1. Strong Backend Quota Limit Check
      const instances = await dbAdapter.getInstances(req.user.id, req.user.role);
      const activeInstancesCount = instances.filter((inst: any) => {
        if (inst.archived) return false;
        return isQuotaConsumingStatus(inst.status);
      }).length;

      const fallbackLimit = resolveInstanceLimit(req.user);
      try {
        await assertCanCreateInstance(req.user, req.body?.channel);
      } catch (entitlementErr: any) {
        if (sendEntitlementError(res, entitlementErr)) return;
        throw entitlementErr;
      }

      const rawBody = req.body;
      const data = rawBody;
      if (!isTemplateWorkflowsEnabled() && hasTemplateDeploymentPayload(rawBody)) {
        return res.status(404).json({
          code: "TEMPLATE_WORKFLOWS_DISABLED",
          error: "Template and Blueprint deployments are not enabled in this MyBay Open Source installation. Deploy a standard instance instead."
        });
      }



      // Normalize pure-web channel to "web" for new writes
      let channel = rawBody.channel || "web";
      if (channel === "none") {
        channel = "web";
      }
      data.channel = channel;
      if (rawBody.modelBillingMode === "platform") {
        return res.status(400).json({
          code: "PLATFORM_MODELS_DISABLED",
          error: "Platform-hosted models are not included in the local open-source edition. Use BYOK credentials instead."
        });
      }

      try {
        await assertCanUseChannel(req.user, channel);
      } catch (entitlementErr: any) {
        if (sendEntitlementError(res, entitlementErr)) return;
        throw entitlementErr;
      }

      // 1. Backend format validation
      // Check Model API Key
      if (rawBody.providerApiKey && typeof rawBody.providerApiKey === 'string') {
        const keyLower = rawBody.providerApiKey.toLowerCase();
        const username = req.user?.username ? req.user.username.toLowerCase() : "";
        if (username && (keyLower === username || keyLower.includes(username))) {
          return res.status(400).json({ error: "模型 API Key 格式不正确，检测到被自动填充为了您的账号邮箱，请重新输入。" });
        }
      }

      // Check Feishu
      if (channel === "feishu" || channel === "lark") {
        const appId = rawBody.feishuAppId;
        const appSecret = rawBody.feishuAppSecret;
        if (!appId || typeof appId !== "string" || !appId.startsWith("cli_")) {
          return res.status(400).json({ error: "飞书 App ID 格式不正确，不得使用邮箱地址，必须以 cli_ 开头的 App ID。" });
        }
        if (appId.includes("@")) {
          return res.status(400).json({ error: "飞书 App ID 格式不正确，不得使用邮箱地址，必须以 cli_ 开头的 App ID。" });
        }
        if (!appSecret || typeof appSecret !== "string" || appSecret.trim() === "") {
          return res.status(400).json({ error: "飞书 App Secret 不能为空。" });
        }
      }

      let template: any = null;
      let blueprint: any = null;
      let referencedTemplates: any[] = [];

      if (data.blueprint_id) {
        const { blueprintsRepo } = await import("../../repositories/blueprintsRepo");
        blueprint = await blueprintsRepo.findById(data.blueprint_id);
        if (!blueprint) {
          return res.status(404).json({ error: `未找到指定的行业场景 Blueprint: ${data.blueprint_id}` });
        }
        if (blueprint.is_active === false) {
          return res.status(400).json({ error: `该 Blueprint 已被禁用: ${blueprint.name}` });
        }

        const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");
        await deploymentEventsRepo.create({
          instance_id: generatedId,
          owner_id: req.user.id,
          step: "blueprint_load",
          status: "success",
          message: `已读取指定的行业场景 Blueprint: ${blueprint.name}`,
          metadata: { blueprint_id: blueprint.id, blueprint_slug: blueprint.slug || blueprint.id }
        });

        data.blueprint_id = blueprint.id;
        data.blueprint_slug = blueprint.slug || blueprint.id;
        data.blueprint_version = blueprint.version || "1.0.0";
        data.blueprint_snapshot = {
          id: blueprint.id,
          slug: blueprint.slug,
          name: blueprint.name,
          description: blueprint.description,
          category: blueprint.category,
          version: blueprint.version,
          recommended_skills: blueprint.recommended_skills,
          recommended_channels: blueprint.recommended_channels,
          referenced_workflow_template_ids: blueprint.referenced_workflow_template_ids,
          system_context_preview: blueprint.system_context_preview
        };

        if (blueprint.referenced_workflow_template_ids && Array.isArray(blueprint.referenced_workflow_template_ids)) {
          const { templatesRepo } = await import("../../repositories/templatesRepo");
          for (const refId of blueprint.referenced_workflow_template_ids) {
            const refTemplate = await templatesRepo.findById(refId);
            if (refTemplate) {
              referencedTemplates.push(refTemplate);
            }
          }
        }
      }

      if (data.template_id) {
        const { templatesRepo } = await import("../../repositories/templatesRepo");
        template = await templatesRepo.findById(data.template_id);
        if (!template) {
          return res.status(404).json({ error: `未找到指定的工作流模板: ${data.template_id}` });
        }
        if (template.is_active === false) {
          return res.status(400).json({ error: `模板已被禁用: ${template.name}` });
        }

        const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");
        
        await deploymentEventsRepo.create({
          instance_id: generatedId,
          owner_id: req.user.id,
          step: "template_load",
          status: "success",
          message: `已读取指定的模板: ${template.name}`,
          metadata: { template_id: template.id, template_slug: template.slug || template.id }
        });

        // 合并默认值并归一化输入
        const userInputs = { ...data.template_inputs };
        
        for (const input of (template.required_inputs || [])) {
          // 合并默认值
          const fallbackDefault = input.defaultValue !== undefined ? input.defaultValue : input.default;
          if ((userInputs[input.key] === undefined || userInputs[input.key] === null || userInputs[input.key] === "") && fallbackDefault !== undefined) {
             userInputs[input.key] = fallbackDefault;
          }
          
          // 归一化 url_list 或 list (按行分割并清除空行)
          if (input.type === "url_list" || input.type === "list") {
             if (userInputs[input.key] === "" || userInputs[input.key] === null || userInputs[input.key] === undefined) {
                userInputs[input.key] = [];
             } else if (typeof userInputs[input.key] === "string") {
                userInputs[input.key] = userInputs[input.key].split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
             }
          }
          
          // 归一化 boolean
          if (input.type === "boolean") {
            userInputs[input.key] = !!userInputs[input.key];
          }
          
          // 归一化 number
          if (input.type === "number" && typeof userInputs[input.key] !== "number") {
             const parsed = parseFloat(userInputs[input.key]);
             if (!isNaN(parsed)) userInputs[input.key] = parsed;
          }
        }
        
        // 写回以备后续使用
        data.template_inputs = userInputs;
        
        const missingInputs: string[] = [];
        for (const input of (template.required_inputs || [])) {
          // 空数组也是正常录入的值（如果 allowed），但如果 required，则不能缺少字段。
          // 这里的检查不再拦截空数组，除非它是 undefined/null 或者空字符串
          const isMissing = userInputs[input.key] === undefined || userInputs[input.key] === null || userInputs[input.key] === "";
          // 如果 required 且 missing
          if (input.required && isMissing) {
            missingInputs.push(input.label || input.key);
          }
        }
        if (missingInputs.length > 0) {
          console.log("[Instance Create Route] Template input validation failed:", {
            template_id: template.id,
            required_keys: (template.required_inputs || []).filter((i: any) => i.required).map((i: any) => i.key),
            received_keys: Object.keys(userInputs),
            template_inputs: redactSecretsDeep(userInputs),
            missing_keys: missingInputs
          });

          await deploymentEventsRepo.create({
            instance_id: generatedId,
            owner_id: req.user.id,
            step: "template_validate",
            status: "failed",
            message: `模板校验失败：缺少必选输入参数: ${missingInputs.join("、")}`,
            metadata: { missing_inputs: missingInputs }
          }).catch(() => {});
          
          return res.status(400).json({ error: `配置模板失败：缺少必填输入参数：${missingInputs.join("、")}。\n请返回“模板配置”步骤，确认上述内容已填写后重试。` });
        }

        await deploymentEventsRepo.create({
          instance_id: generatedId,
          owner_id: req.user.id,
          step: "template_validate",
          status: "success",
          message: `工作流运行所需输入参数校验通过`,
          metadata: { user_inputs: redactSecretsDeep(userInputs) }
        });

        // 合并：默认配置、技能、用户覆盖、输入快照等
        data.skills = template.default_skills || [];
        data.template_slug = template.slug || template.id;
        data.template_version = template.updated_at || "1.0.0";
        data.template_inputs = userInputs;

        // Auto-assign properties with standard priority:
        // 1. User config values data.provider / data.model
        // 2. Template's default_provider / default_model
        // 3. System defaults
        const SYSTEM_DEFAULT_PROVIDER = "google";
        const SYSTEM_DEFAULT_MODEL = "gemini-2.5-flash";

        const finalProvider = data.provider || template.default_provider || SYSTEM_DEFAULT_PROVIDER;
        const finalModel = data.model || template.default_model || SYSTEM_DEFAULT_MODEL;

        data.provider = finalProvider;
        data.model = finalModel;

        data.template_recommended_model = {
          provider: template.default_provider,
          model: template.default_model
        };
        data.selected_model = {
          provider: finalProvider,
          model: finalModel
        };

        if (!data.channel && template.default_channel) {
          data.channel = template.default_channel;
        }
        if (data.channel === "none" || !data.channel) {
          data.channel = "web";
        }
        if (!data.prompt && template.default_prompt) {
          data.prompt = template.default_prompt;
        }
        if (!data.name && template.name) {
          data.name = `${template.name}-${Math.random().toString(36).substring(7).toUpperCase()}`;
        }
        
        // Merge template's default_config
        const mergedConfig = { ...template.default_config, ...(data.default_config || {}) };
        data.default_config = mergedConfig;
        
        // Save snapshot of template properties
        data.template_snapshot = {
          name: template.name,
          description: template.description || "",
          default_prompt: template.default_prompt,
          default_skills: template.default_skills,
          required_inputs: template.required_inputs,
          supported_triggers: template.supported_triggers,
          default_trigger: template.default_trigger,
          default_output: template.default_output,
          required_permissions: template.required_permissions,
          risk_level: template.risk_level
        };
      }

      if (!data.name && blueprint) {
        data.name = `${blueprint.name}-${Math.random().toString(36).substring(7).toUpperCase()}`;
      }

      // Unified skills verification using skillPolicyRegistry
      const activeSkills: string[] = Array.isArray(data.skills) ? data.skills : [];
      if (activeSkills.length > 0) {
        const { skillPolicyRegistry } = await import("../../../shared/skillPolicyRegistry");
        const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");

        const dangerousSkillsInRequest = activeSkills.filter((s: string) => {
          const policy = skillPolicyRegistry[s];
          return policy && policy.requiresConfirmation === true;
        });

        if (dangerousSkillsInRequest.length > 0) {
          const confirmedSkillIds = Array.isArray(data.confirmed_skill_ids) 
            ? data.confirmed_skill_ids 
            : (Array.isArray(data.accepted_permissions) ? data.accepted_permissions : []);

          const unconfirmedSkills = dangerousSkillsInRequest.filter((s: string) => {
            if (data.confirm_dangerous_skills === true) return false; // backward compatibility
            return !confirmedSkillIds.includes(s);
          });

          if (unconfirmedSkills.length > 0) {
            const names = unconfirmedSkills.map((s: string) => skillPolicyRegistry[s]?.name || s).join(", ");
            await deploymentEventsRepo.create({
              instance_id: generatedId,
              owner_id: req.user.id,
              step: "template_validate",
              status: "failed",
              message: `安全审核拦截：部署请求包含了需要确认的系统敏感技能 [${names}]，用户未进行显式声明授权。`,
              metadata: { dangerous_skills: unconfirmedSkills }
            }).catch(() => {});
            
            return res.status(400).json({
              error: `高危技能拦截：该部署请求包含了需要您手动确认授权的敏感技能插件：[${names}]。您必须在创建请求中确认并同意授予对此技能的直接开启权限(confirmed_skill_ids 需包含对应 ID)。`
            });
          }
        }
      }
      data.modelBillingMode = "byok";

      // Resolve saved credential if provided
      if (data.providerCredentialId) {
        try {
          const cred = await dbAdapter.getCredentialById(data.providerCredentialId, req.user.id);
          applySavedProviderCredential(data, cred);
        } catch (err: any) {
          console.error("Failed to resolve credential for instance creation:", err);
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

      // Handle Demo Mode token minting and config override
      if (data.use_demo_proxy === true) {
        data.provider = "openai";
        const port = process.env.PORT || "3000";
        // ONLY use internal host bridge IP. This guarantees public requests cannot spoof internal proxy context
        data.baseUrl = `http://172.17.0.1:${port}/api/demo-proxy/internal/${generatedId}/v1`;
        
        // Do NOT assign any placeholder, token, or string to apiKey / providerApiKey.
        // It must remain empty to guarantee it is purely a backend routing logic and no credential enters the instance config.
        data.providerApiKey = "";
        data.apiKey = "";
        
        // Force safe model if not supported
        const { DEMO_ALLOWED_MODELS, DEMO_DEFAULT_MODEL } = await import("../../../shared/providerRegistry");
        if (!DEMO_ALLOWED_MODELS.includes(data.model)) {
           data.model = DEMO_DEFAULT_MODEL; // Default safe model
        }
      }
      
      // Schema Validation: Validate types before encrypting or saving
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
      if (data.apiKey !== undefined && typeof data.apiKey !== 'string') {
        return res.status(400).json({ error: "配置格式验证错误：'apiKey' 必须是 string 字符串类型。" });
      }

      // Provider and Model Validation against providerRegistry
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

      if (data.baseUrl) {
        const { checkSSRFSafe } = require("../../utils/ssrfValidator");
        const ssrfRes = await checkSSRFSafe(data.baseUrl);
        if (!ssrfRes.safe) {
          return res.status(400).json({ error: "安全校验拦截 (SSRF): " + (ssrfRes.error || "未知") });
        }
      }

      // Skill Policy Validation
      const { skillPolicyRegistry } = require("../../../shared/skillPolicyRegistry");
      const skillsToValidate = data.skills || [];
      for (const skillId of skillsToValidate) {
        const policy = skillPolicyRegistry[skillId];
        if (!policy) {
          return res.status(400).json({ error: `未知的技能插件: ${skillId}` });
        }
        if (policy.runtimeStatus === 'coming_soon') {
          return res.status(400).json({ error: `技能插件 [${policy.name}] 尚未开发完成或尚未上线。` });
        }
        if (policy.adminOnly && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
          await dbAdapter.insertAuditLog({
            instance_id: "system",
            action: "security_violation",
            user_id: req.user.id,
            timestamp: new Date().toISOString(),
            details: `用户尝试越权开启管理员技能: ${skillId} (Create)`
          });
          return res.status(403).json({ error: `无权开启管理员专用技能: ${policy.name}` });
        }

        const hasDockerSkill = skillId === "docker" || skillId === "docker_engine";
        if (hasDockerSkill) {
          if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
            await dbAdapter.insertAuditLog({
              instance_id: "system",
              action: "security_violation",
              user_id: req.user.id,
              timestamp: new Date().toISOString(),
              details: `非管理员用户尝试越权开启 Docker 技能`
            });
            return res.status(403).json({ error: "权限不足，无权启用 Docker 物理机引擎技能" });
          }

          const envAllowsDockerSocket = process.env.ENABLE_DOCKER_SOCKET_SKILL === "true";
          if (!envAllowsDockerSocket) {
            return res.status(403).json({ error: "服务器安全策略未启用 Docker Socket 挂载。请先由服务器管理员在部署环境中设置 ENABLE_DOCKER_SOCKET_SKILL=true" });
          }

          const settingsAllowsDockerSocket = await dbAdapter.getSystemSettingBoolean("admin_docker_socket_enabled", false);
          if (!settingsAllowsDockerSocket) {
            return res.status(403).json({ error: "后台安全设置未允许管理员实例挂载 Docker Socket。请先在管理员后台的安全设置中开启此项" });
          }
        }
      }

      try {
        const { assertRuntimeSatisfiesSkillPolicy, createRuntimeSecurityManifest } = await import("../../services/skillPolicyEnforcer");
        const wantsDockerSocket = skillsToValidate.includes("docker") || skillsToValidate.includes("docker_engine");
        const dockerSocketMounted = wantsDockerSocket
          && process.env.ENABLE_DOCKER_SOCKET_SKILL === "true"
          && await dbAdapter.getSystemSettingBoolean("admin_docker_socket_enabled", false);
        const runtime = createRuntimeSecurityManifest({
          runtimeType: "mybay-agent-runtime",
          user: "root",
          capDrop: [],
          securityOpt: req.user.role === "admin" || req.user.role === "super_admin" ? [] : ["no-new-privileges:true"],
          binds: dockerSocketMounted
            ? ["instance:/opt/data:rw", "/var/run/docker.sock:/var/run/docker.sock"]
            : ["instance:/opt/data:rw"],
          resourceLimited: true,
        });
        assertRuntimeSatisfiesSkillPolicy({ skills: skillsToValidate, userRole: req.user.role, isProduction: process.env.NODE_ENV === "production", runtime });
      } catch (error: any) {
        if (error?.name !== "SkillPolicyError") throw error;
        return res.status(403).json({ error: error.code, message: error.message, detail: error.detail });
      }

      // Auto port allocation logic under single-container architecture
      const { isTraefik } = parseTraefikEnv(process.env);
      
      // Default internal web port (default 9119 as required)
      data.internal_web_port = data.internal_web_port ? parseInt(String(data.internal_web_port), 10) : 9119;
      
      // Find or assign the debugging/local host port
      let assignedPort = data.port ? parseInt(String(data.port), 10) : null;
      if (data.host_port) {
        assignedPort = parseInt(String(data.host_port), 10);
      }

      if (!assignedPort || assignedPort === 3000 || assignedPort === 15929) {
          try {
            assignedPort = await findAvailablePort(docker);
            data.host_port = assignedPort;
            data.port = String(assignedPort); // backward compatibility
          } catch (e: any) {
            console.error("[Create API] Port allocation error:", e);
            return res.status(500).json({ error: "无法自动分配可用端口，系统内部异常" });
          }
        } else if (assignedPort) {
          data.host_port = assignedPort;
          data.port = String(assignedPort); // backward compatibility
        }

      // Force safe resource limits based on user policies to prevent API-level bypass
      const resolvedLimits = await resolveResourceLimitsForInstance(
        req.user,
        isAdvancedResourceConfigEnabled() ? data.limitsCpu : undefined,
        isAdvancedResourceConfigEnabled() ? data.limitsMem : undefined,
        req.user.id
      );

      data.limitsCpu = resolvedLimits.limitsCpu;
      data.limitsMem = resolvedLimits.limitsMem;
      
      // Pre-validation of files to ensure they exist and belong to the user
      // This also populates the template inputs structure before serialization
      if (template && data.template_inputs) {
        for (const input of (template.required_inputs || [])) {
          if (input.type === "file" && data.template_inputs[input.key]) {
            const fileRef = data.template_inputs[input.key];
            const fileId = typeof fileRef === 'string' ? fileRef : fileRef.fileId;
            
            if (fileId && typeof fileId === 'string') {
              try {
                const { filesRepo } = await import("../../repositories/filesRepo");
                const fileRecord = await filesRepo.findById(fileId);
                
                if (!fileRecord || fileRecord.owner_id !== req.user.id || fileRecord.instance_id) {
                  return res.status(400).json({ error: "找不到可以绑定的有效上传文件或权限不足。" });
                }
                
                const oldPath = fileRecord.storage_path;
                if (!fs.existsSync(oldPath)) {
                  return res.status(400).json({ error: "上传文件的物理存储已丢失，请重新上传。" });
                }
                
                // Pre-populate structured template inputs so it gets serialized cleanly in config_json/instances config
                data.template_inputs[input.key] = {
                  fileId: fileRecord.id,
                  filename: fileRecord.filename,
                  mimeType: fileRecord.mime_type,
                  size: fileRecord.size,
                  path: `/opt/data/uploads/${fileRecord.filename}`
                };
              } catch (err: any) {
                console.error("[Create API] File validation error:", err);
                return res.status(400).json({ error: "校验预上传文件异常，文件可能损坏或被拦截" });
              }
            } else if (input.required) {
              return res.status(400).json({ error: "缺少必填的文件输入。" });
            }
          }
        }
      }

      let autoGeneratedWebhookSecret = "";
      const needsWebhookSecret = (template && template.readiness === "requires_webhook") ||
                                 (blueprint && referencedTemplates.some((t: any) => t.readiness === "requires_webhook"));
      
      if (needsWebhookSecret && (!data.webhookSecret || typeof data.webhookSecret !== "string" || data.webhookSecret.trim() === "")) {
        const crypto = require("crypto");
        autoGeneratedWebhookSecret = "mb_sec_" + crypto.randomBytes(16).toString("hex");
        data.webhookSecret = autoGeneratedWebhookSecret;
      }

      // Encrypt sensitive data
      const secureData = { ...data };
      const planDiskLimitMb = await getStorageLimitMb(req.user);
      const { getDefaultInstanceDiskMb } = require("../../services/entitlements");
      const userDefaultDiskMb = await getDefaultInstanceDiskMb(req.user);
      const requestedDiskMb = isAdvancedResourceConfigEnabled() && data.limitsDiskMb ? parseInt(String(data.limitsDiskMb), 10) : userDefaultDiskMb;

      secureData.diskLimitMode = "override";
      secureData.limitsDiskMb = requestedDiskMb;
      secureData.limitsDisk = `${requestedDiskMb}MB`;
      secureData.planDiskLimitMb = planDiskLimitMb;
      secureData.diskLimitMb = requestedDiskMb;
      if (secureData.template_inputs) {
        secureData.template_inputs = redactSecretsDeep(JSON.parse(JSON.stringify(secureData.template_inputs)));
      }
      if (data.template_inputs) {
        data.template_inputs = secureData.template_inputs;
      }
      const sensitiveFields = [
        'apiKey', 'providerApiKey', 'password', 'telegramBotToken', 'discordBotToken',
        'feishuAppSecret', 'qqBotSecret', 'whatsappAccessToken', 'slackBotToken',
        'slackSigningSecret', 'slackAppToken', 'dingtalkAppSecret', 'dingtalkRobotSecret',
        'wechatAppSecret', 'wechatMpAppSecret', 'wecomAppSecret', 'weixinToken', 'webhookSecret', 'skillTavilyApiKey', 'skillSerperApiKey',
        'skillGithubToken',
        'wecomToken', 'wecomEncodingAesKey', 'wechatMpToken', 'wechatMpEncodingAesKey',
        'hermesApiKey', 'chatApiKey', 'hermesDashboardAuthSecret', 'dashboardAuthSecret'
      ];
      for (const field of sensitiveFields) {
        if (secureData[field] && isMaskedSecretPlaceholder(secureData[field])) {
          console.warn(`[Create] Intercepted masked placeholder for sensitive field '${field}': ${secureData[field]}. Deleting from payload.`);
          delete secureData[field];
        }
      }

      // Generate internal hermesApiKey if not present
      if (!secureData.hermesApiKey) {
        const crypto = require("crypto");
        const generatedKey = `mb_hermes_${crypto.randomBytes(32).toString("hex")}`;
        secureData.hermesApiKey = encrypt(generatedKey);
      } else {
        secureData.hermesApiKey = encrypt(secureData.hermesApiKey);
      }

      const dashboardAccessEnabled = secureData.enableDashboard !== false;
      let plainPasswordForResponse: string | null = null;

      if (dashboardAccessEnabled) {
        let plainPassword = secureData.password;
        if (!plainPassword || typeof plainPassword !== "string" || plainPassword.trim() === "" || isMaskedSecretPlaceholder(plainPassword)) {
          const crypto = require("crypto");
          plainPassword = "mb_pwd_" + crypto.randomBytes(16).toString("hex");
        }
        plainPasswordForResponse = plainPassword;
        secureData.webPasswordHash = bcrypt.hashSync(plainPassword, 10);
        secureData.password = encrypt(plainPassword);
        ensureEncryptedDashboardAuthSecret(secureData);
      } else {
        delete secureData.password;
        delete secureData.webPasswordHash;
        delete secureData.dashboardAuthSecret;
        delete secureData.hermesDashboardAuthSecret;
      }

      // Dashboard credentials are only required when its access entry point is enabled.
      const isWeb = channel === "web" || !channel;
      if (dashboardAccessEnabled && isWeb) {
        const plainPass = tryResolvePlainInstancePassword(secureData);
        if (!plainPass || !secureData.webPasswordHash || !secureData.dashboardAuthSecret || !secureData.hermesDashboardAuthSecret) {
          return res.status(400).json({
            error: "PASSWORD_MISSING",
            message: "面板访问密码不可用，实例无法完成 Dashboard 登录配置。请重置访问密码后重新部署。"
          });
        }
      }

      if (secureData.chatApiKey) secureData.chatApiKey = encrypt(secureData.chatApiKey);

      if (secureData.apiKey) secureData.apiKey = encrypt(secureData.apiKey);
      if (secureData.providerApiKey) secureData.providerApiKey = encrypt(secureData.providerApiKey);
      if (secureData.telegramBotToken) secureData.telegramBotToken = encrypt(secureData.telegramBotToken);
      if (secureData.discordBotToken) secureData.discordBotToken = encrypt(secureData.discordBotToken);
      if (secureData.feishuAppSecret) secureData.feishuAppSecret = encrypt(secureData.feishuAppSecret);
      if (secureData.qqBotSecret) secureData.qqBotSecret = encrypt(secureData.qqBotSecret);
      if (secureData.whatsappAccessToken) secureData.whatsappAccessToken = encrypt(secureData.whatsappAccessToken);
      if (secureData.slackBotToken) secureData.slackBotToken = encrypt(secureData.slackBotToken);
      if (secureData.slackSigningSecret) secureData.slackSigningSecret = encrypt(secureData.slackSigningSecret);
      if (secureData.slackAppToken) secureData.slackAppToken = encrypt(secureData.slackAppToken);
      if (secureData.dingtalkAppSecret) secureData.dingtalkAppSecret = encrypt(secureData.dingtalkAppSecret);
      if (secureData.dingtalkRobotSecret) secureData.dingtalkRobotSecret = encrypt(secureData.dingtalkRobotSecret);
      if (secureData.wechatAppSecret) secureData.wechatAppSecret = encrypt(secureData.wechatAppSecret);
      if (secureData.wechatMpAppSecret) secureData.wechatMpAppSecret = encrypt(secureData.wechatMpAppSecret);
      if (secureData.wecomAppSecret) secureData.wecomAppSecret = encrypt(secureData.wecomAppSecret);
      if (secureData.weixinToken) secureData.weixinToken = encrypt(secureData.weixinToken);
      if (secureData.webhookSecret) secureData.webhookSecret = encrypt(secureData.webhookSecret);
      secureData.webhookAuthMode = "secret-required";
      if (secureData.skillTavilyApiKey) secureData.skillTavilyApiKey = encrypt(secureData.skillTavilyApiKey);
      if (secureData.skillSerperApiKey) secureData.skillSerperApiKey = encrypt(secureData.skillSerperApiKey);
      if (secureData.skillGithubToken) secureData.skillGithubToken = encrypt(secureData.skillGithubToken);
      if (secureData.wecomToken) secureData.wecomToken = encrypt(secureData.wecomToken);
      if (secureData.wecomEncodingAesKey) secureData.wecomEncodingAesKey = encrypt(secureData.wecomEncodingAesKey);
      if (secureData.wechatMpToken) secureData.wechatMpToken = encrypt(secureData.wechatMpToken);
      if (secureData.wechatMpEncodingAesKey) secureData.wechatMpEncodingAesKey = encrypt(secureData.wechatMpEncodingAesKey);

      const ctx = buildDeploymentContext({ id: generatedId, path: data.path }, secureData);
      const canUseCustomAgentImage = req.user.role === "admin" || req.user.role === "super_admin";
      const systemDefaultAgentImage = process.env.MY_BAY_IMAGE || "nousresearch/hermes-agent";
      const requestedImage = canUseCustomAgentImage ? (data.image || "") : systemDefaultAgentImage;
      
      let { agent_image, agent_image_tag } = parseImageRef(requestedImage);
      
      // If explicit tag provided from new UI selector, override the parsed one. Ordinary users can only pick registered tags.
      if (data.imageTag) {
        agent_image_tag = data.imageTag;
      }
      if (!canUseCustomAgentImage) {
        agent_image = systemDefaultAgentImage;
      }

      let agent_version = agent_image_tag;
      let resolved_version: string | null = null;

      // Determine if this instance requires Feishu capability
      const isChannelFeishu = 
        secureData.channel === "feishu" || 
        secureData.channel === "lark" || 
        (Array.isArray(secureData.channel) && secureData.channel.some((ch: any) => ["feishu", "lark"].includes(String(ch).toLowerCase()))) ||
        (secureData.configuredChannels && (
          (Array.isArray(secureData.configuredChannels) && secureData.configuredChannels.some((ch: any) => ["feishu", "lark"].includes(String(ch).toLowerCase()))) ||
          (typeof secureData.configuredChannels === 'string' && (secureData.configuredChannels.toLowerCase().includes("feishu") || secureData.configuredChannels.toLowerCase().includes("lark")))
        ));

      const hasFeishuSkill = 
        Array.isArray(secureData.skills) && 
        secureData.skills.some((s: string) => 
          ["feishu", "lark", "feishu_adapter", "lark_adapter"].includes(String(s).toLowerCase())
        );

      const isFeishu = !!(isChannelFeishu || hasFeishuSkill);

      const isFeishuCapableVersion = supportsFeishu;

      // Fetch discovered versions from db mapping to perform strict validation
      const myBayVersions = await dbAdapter.getMyBayVersions();
      if (!canUseCustomAgentImage && agent_image_tag !== "latest") {
        const isRegisteredTag = myBayVersions.some((v: any) => {
          const candidates = [
            v.image_tag,
            v.tag,
            v.version,
            v.coreVariant?.tag,
            v.feishuVariant?.tag
          ].filter(Boolean).map((item: any) => String(item));
          return candidates.includes(String(agent_image_tag));
        });
        if (!isRegisteredTag) {
          return res.status(400).json({
            success: false,
            error: "AGENT_IMAGE_TAG_NOT_ALLOWED",
            message: "当前账号只能选择平台版本库中已登记的 Agent 镜像版本。请返回容器配置步骤重新选择版本。"
          });
        }
      }

      if (isFeishu) {
        const { versionsRepo } = await import("../../repositories/versionsRepo");
        let matchingVersion: any = null;
        if (agent_image_tag === "latest") {
          matchingVersion = await versionsRepo.getResolvedLatestFeishuVersion();
          if (!matchingVersion) {
            return res.status(409).json({
              code: "FEISHU_CAPABILITY_REQUIRED",
              params: { version: "latest" },
              error: "No discovered official Hermes version supports Feishu/Lark."
            });
          }
        } else {
          matchingVersion = myBayVersions.find((version: any) => {
            const tag = version.image_tag || version.tag || version.version;
            return tag === agent_image_tag || version.version === agent_image_tag;
          });
          if (!matchingVersion) {
            return res.status(400).json({
              code: "VERSION_NOT_FOUND",
              params: { version: agent_image_tag },
              error: "The selected Hermes version is not registered."
            });
          }
          if (!isFeishuCapableVersion(matchingVersion)) {
            return res.status(409).json({
              code: "FEISHU_CAPABILITY_REQUIRED",
              params: { version: agent_image_tag },
              error: "The selected official Hermes version does not support Feishu/Lark."
            });
          }
        }
        agent_image = matchingVersion.image || systemDefaultAgentImage;
        agent_image_tag = matchingVersion.image_tag || matchingVersion.tag || matchingVersion.version;
        agent_version = matchingVersion.version || agent_image_tag;
        resolved_version = agent_version;
        console.log(`[Instance Create][Feishu] Using official Hermes image ${agent_image}:${agent_image_tag}`);
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
              console.log(`[Instance Create] Resolved 'latest' to prewarmed version: ${resolved_version} (${agent_image}:${agent_image_tag})`);
            } else {
              console.warn(`[Instance Create] No prewarmed latest version found in db, fallback to DEFAULT_AGENT_IMAGE_TAG (${agent_image_tag})`);
            }
          } catch (e: any) {
            console.error(`[Instance Create] Failed to resolve latest version, fallback to ${agent_image_tag}`, e);
          }
        } else {
          // If a non-feishu instance somehow ends up with a -feishu tag, switch it back to core
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

      // Helper function to find version safely
      function MyBay_findVersion(list: any[], tagA: string, tagB: string): any {
        return list.find((v: any) => {
          const vTag = v.image_tag || v.tag || v.version;
          return vTag === tagA || vTag === tagB;
        });
      }


      let newInstance = {
        id: generatedId,
        name: data.name,
        path: data.path,
        status: "queued",
        url: ctx.publicUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config_json: JSON.stringify(secureData),
        user_id: req.user.id,
        user_role: req.user.role,
        agent_image,
        agent_image_tag,
        agent_version,
        resolved_version,
        model_provider: data.provider || null,
        model_name: data.model || null,
        model_base_url: data.baseUrl || null,
        model_config_status: 'pending',
        model_config_error: null,
        template_id: data.template_id || null,
        template_slug: (template ? (template.slug || template.id) : null) || null,
        limitsCpu: parseFloat(resolvedLimits.limitsCpu),
        limitsMemory: resolvedLimits.limitsMem,
        limitsMemoryMb: resolvedLimits.limitsMemoryMb,
      };

      if (!newInstance.id || typeof newInstance.id !== "string" || newInstance.id.trim() === "") {
        throw new Error("数据库写入拦截：实例 ID 不能为空值！");
      }

      const safeSecureDataForTask = {
        ...secureData,
        template_inputs: redactSecretsDeep(secureData.template_inputs || {})
      };
      deploymentTaskId = require("crypto").randomUUID();
      const provisioning = await dbAdapter.createProvisioningBundle({
        instance: newInstance,
        deploymentTask: {
          id: deploymentTaskId,
          payload_json: { instance: newInstance, secureData: safeSecureDataForTask, user: req.user },
          created_by: req.user.id,
          current_step: "queued",
          max_attempts: 3,
        },
        idempotencyKey: idempotencyKey || null,
        requestHash,
        candidatePorts: listInstancePortCandidates(Number(assignedPort || 0)),
        maxActiveInstances: fallbackLimit,
      });
      if (provisioning.kind === "replay") {
        return res.status(202).json({ instanceId: provisioning.instanceId, deploymentTaskId: provisioning.deploymentTaskId, status: "queued", statusUrl: `/api/deployments/${provisioning.deploymentTaskId}`, idempotentReplay: true });
      }
      if (provisioning.kind === "conflict") {
        const status = provisioning.code === "QUOTA_EXCEEDED" ? 429 : provisioning.code === "PORT_UNAVAILABLE" ? 503 : 409;
        const error = provisioning.code === "PATH_CONFLICT" ? "Another instance already uses this path."
          : provisioning.code === "QUOTA_EXCEEDED" ? "The instance quota has been reached."
          : provisioning.code === "PORT_UNAVAILABLE" ? "No host port is currently available in the configured range."
          : "The Idempotency-Key conflicts with another request.";
        return res.status(status).json({ code: provisioning.code, error });
      }
      newInstance = provisioning.instance;
      deploymentTaskId = provisioning.task.id;
      instanceCreatedLocally = true;

      // File Movement to instance folder & public.files database linking after createInstance succeeds 
      if (template && data.template_inputs) {
        for (const input of (template.required_inputs || [])) {
          if (input.type === "file" && data.template_inputs[input.key]) {
            const fileRef = data.template_inputs[input.key];
            const fileId = fileRef && fileRef.fileId;
            
            if (fileId && typeof fileId === 'string') {
              try {
                const { filesRepo } = await import("../../repositories/filesRepo");
                const fileRecord = await filesRepo.findById(fileId);
                
                if (fileRecord && fileRecord.owner_id === req.user.id && !fileRecord.instance_id) {
                    // Check file accept constraints
                    if (input.accept) {
                      const allowedTypes = input.accept.split(',').map((s: string) => s.trim().toLowerCase());
                      const fileExt = path.extname(fileRecord.filename).toLowerCase();
                      const fileMime = (fileRecord.mime_type || "").toLowerCase();

                      let isAllowed = false;
                      for (const allowed of allowedTypes) {
                        if (allowed.startsWith('.')) {
                          if (fileExt === allowed) {
                            isAllowed = true;
                            break;
                          }
                        } else {
                          if (allowed === fileMime) {
                            isAllowed = true;
                            break;
                          }
                          if (allowed.endsWith('/*')) {
                            const prefix = allowed.slice(0, -2);
                            if (fileMime.startsWith(prefix)) {
                              isAllowed = true;
                              break;
                            }
                          }
                        }
                      }

                      if (!isAllowed) {
                        throw new Error(`文件类型不匹配。该输入字段仅接受: ${input.accept}，但上传的文件为: ${fileRecord.filename} (${fileRecord.mime_type || "未知类型"})`);
                      }
                    }

                    const oldPath = fileRecord.storage_path;
                   if (fs.existsSync(oldPath)) {
                      const instanceUploadsDir = path.join(process.cwd(), "data", "instances", generatedId, "uploads");
                      if (!fs.existsSync(instanceUploadsDir)) {
                         fs.mkdirSync(instanceUploadsDir, { recursive: true });
                      }
                      
                      const newPath = path.join(instanceUploadsDir, fileRecord.filename);
                      
                      // Physically move the file
                      fs.renameSync(oldPath, newPath);
                      
                      try {
                        await filesRepo.updateInstanceId(fileId, generatedId, newPath);
                        movedFiles.push({ fileId, oldPath, newPath });
                        console.log(`[Instance Create] Unified file binding success: ${fileRecord.filename} linked to ${generatedId}`);
                      } catch (dbUpdateErr: any) {
                        // Rollback file rename if db update fails!
                        try {
                          if (fs.existsSync(newPath)) {
                            fs.renameSync(newPath, oldPath);
                          }
                        } catch (rollbackErr) {
                          console.error("[Rollback] Failed to rename file back:", rollbackErr);
                        }
                        throw dbUpdateErr;
                      }
                    } else {
                      throw new Error(`缺少物理源文件: ${oldPath}`);
                    }
                  } else {
                    throw new Error(`未找到匹配的未绑定文件，可能已被使用。`);
                  }
                } catch (fileErr: any) {
                  console.error("[Instance Create] Physical file bind failed:", fileErr);
                  throw new Error("模板文件关联失败: " + fileErr.message);
                }
            }
          }
        }
      }

      if (template) {
        await deploymentEventsRepo.create({
          instance_id: generatedId,
          owner_id: req.user.id,
          step: "template_snapshot_saved",
          status: "success",
          message: `静态版本快照成功存盘持久化`,
          metadata: { template_id: template.id, template_slug: template.slug || template.id }
        });

        const ownerId = req.user.id;
        let triggersOrTasksCreated = false;
        
        let triggersMetadata: any = {};
        let tasksMetadata: any = {};
        const templateConfigForReadiness = {
          businessConfig: data.businessConfig || {},
          template_inputs: data.template_inputs || {}
        };
        const templateReadiness = evaluateWorkflowReadiness(template, buildWorkflowReadinessContext(templateConfigForReadiness));
        const templateReadinessPayload = buildWorkflowReadinessPayload(templateReadiness);

        // 6. 如果模板有 default_trigger 且是 schedule，则创建 scheduled_jobs
        if (template.default_trigger && template.default_trigger.type === "schedule") {
          try {
            console.log(`Template trigger detected: schedule`);
            const { scheduledJobsRepo } = await import("../../repositories/scheduledJobsRepo");
            // Work out cron schedule
            let cronVal = template.default_trigger.cron || "0 9 * * *";
            if (data.template_inputs && data.template_inputs.run_time) {
               try {
                  const parts = data.template_inputs.run_time.split(":");
                  if (parts.length === 2) {
                     cronVal = `${parseInt(parts[1], 10)} ${parseInt(parts[0], 10)} * * *`;
                  }
               } catch (e) {}
            }
            const labelStr = `${template.name} 定时任务`;
            
            const payloadContent = redactSecretsDeep({
               template_id: template.id,
               template_slug: template.slug || template.id,
               template_inputs: data.template_inputs || {},
               workflow_readiness: templateReadinessPayload,
               template_snapshot: data.template_snapshot || {},
               trigger: template.default_trigger
            });
            
            const newJob = await scheduledJobsRepo.create({
              owner_id: ownerId,
              instance_id: generatedId,
              template_id: template.id,
              title: labelStr,
              cron_expression: cronVal,
              is_active: templateReadiness.ready,
              next_run_at: templateReadiness.ready ? new Date(Date.now() + 90 * 1000).toISOString() : null,
              input_payload: payloadContent
            });
            triggersOrTasksCreated = true;
            triggersMetadata.job_id = newJob.id;
            triggersMetadata.cron_expression = cronVal;
            console.log(`Scheduled job created: ${newJob.id}`);
          } catch (jobErr: any) {
            console.error("[Instance Create Route] Failed to create scheduled job:", jobErr);
            throw new Error("初始化模板调度任务失败: " + jobErr.message);
          }
        }

        // 7. 如果模板有 initial_tasks，则创建 tasks
        if (template.initial_tasks && Array.isArray(template.initial_tasks)) {
          try {
            const { tasksRepo } = await import("../../repositories/tasksRepo");
            for (const t of selectInitialExecutionTasks(template.initial_tasks)) {
              const payloadContent = redactSecretsDeep({
                 template_id: template.id,
                 template_slug: template.slug || template.id,
                 template_inputs: data.template_inputs || {},
                 workflow_readiness: templateReadinessPayload,
                 template_snapshot: data.template_snapshot || {},
                 initial_task: t
              });
              
              await tasksRepo.create({
                owner_id: ownerId,
                instance_id: generatedId,
                template_id: template.id,
                title: `${template.name} - 初始化阶段: ${t.title}`,
                trigger_type: "template_initial",
                status: initialTaskStatus(templateReadiness, t.status || "queued"),
                input_payload: payloadContent
              });
            }
            triggersOrTasksCreated = true;
            tasksMetadata.created_count = selectInitialExecutionTasks(template.initial_tasks).length;
            console.log(`Initial tasks created: ${tasksMetadata.created_count}`);
          } catch (taskErr: any) {
            console.error("[Instance Create Route] Failed to create initial tasks:", taskErr);
             throw new Error("初始化模板前置任务失败: " + taskErr.message);
          }
           await deploymentEventsRepo.create({
              instance_id: generatedId,
              owner_id: req.user.id,
              step: "template_initial_tasks_created",
              status: "success",
              message: `初始化前置任务已创建，待用户手动触发`,
              metadata: tasksMetadata
           });
        }

        if (triggersOrTasksCreated && Object.keys(triggersMetadata).length > 0) {
          await deploymentEventsRepo.create({
            instance_id: generatedId,
            owner_id: req.user.id,
            step: "template_triggers_created",
            status: "success",
            message: `相关的定时任务调度器注册就绪`,
            metadata: triggersMetadata
          });
          console.log(`Deployment event written: template_triggers_created`);
        }
      }

      // Expand blueprint referenced templates
      if (referencedTemplates.length > 0) {
        try {
          const { tasksRepo } = await import("../../repositories/tasksRepo");
          const { scheduledJobsRepo } = await import("../../repositories/scheduledJobsRepo");
          const ownerId = req.user.id;
          const initialConfigForReadiness = {
            businessConfig: data.businessConfig || {},
            template_inputs: data.template_inputs || {}
          };

          const childResults: Array<{ templateId: string; readiness: string; initializationFailed: boolean }> = [];
          for (const refTemplate of referencedTemplates) {
            let initializationFailed = false;
            const triggerType = refTemplate.default_trigger?.type;
            const readiness = evaluateWorkflowReadiness(refTemplate, buildWorkflowReadinessContext(initialConfigForReadiness));
            const readinessPayload = buildWorkflowReadinessPayload(readiness);
            const templateSnapshot = {
              name: refTemplate.name,
              description: refTemplate.description || "",
              default_prompt: refTemplate.default_prompt,
              default_skills: refTemplate.default_skills,
              required_inputs: refTemplate.required_inputs,
              supported_triggers: refTemplate.supported_triggers,
              default_trigger: refTemplate.default_trigger,
              default_output: refTemplate.default_output,
              required_permissions: refTemplate.required_permissions,
              risk_level: refTemplate.risk_level
            };

            if (refTemplate.default_trigger && (triggerType === "schedule" || triggerType === "interval")) {
              try {
                const labelStr = `Blueprint scheduled workflow: ${refTemplate.name}`;
                let cronVal = refTemplate.default_trigger.cron || refTemplate.default_trigger.interval || "0 9 * * *";
                if (triggerType === "schedule" && data.template_inputs?.run_time) {
                  try {
                    const parts = String(data.template_inputs.run_time).split(":");
                    if (parts.length === 2) {
                      const hour = parseInt(parts[0], 10);
                      const minute = parseInt(parts[1], 10);
                      if (Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                        cronVal = `${minute} ${hour} * * *`;
                      }
                    }
                  } catch (e) {}
                }

                const payloadContent = redactSecretsDeep({
                  source: "blueprint",
                  blueprint_id: blueprint?.id || data.blueprint_id || null,
                  blueprint_slug: blueprint?.slug || blueprint?.id || data.blueprint_id || null,
                  template_id: refTemplate.id,
                  template_slug: refTemplate.slug || refTemplate.id,
                  template_inputs: data.template_inputs || {},
                  workflow_readiness: readinessPayload,
                  template_snapshot: templateSnapshot,
                  trigger: refTemplate.default_trigger
                });

                await scheduledJobsRepo.create({
                  owner_id: ownerId,
                  instance_id: generatedId,
                  template_id: refTemplate.id,
                  title: labelStr,
                  cron_expression: cronVal,
                  is_active: readiness.ready,
                  next_run_at: readiness.ready ? new Date(Date.now() + 120 * 1000).toISOString() : null,
                  input_payload: payloadContent
                });
                console.log(`[Blueprint Deploy] Created referenced scheduled job: ${refTemplate.id} (${triggerType})`);
              } catch (jobErr) {
                console.error("[Blueprint Deploy] Failed to create scheduled job for refTemplate:", refTemplate.id, jobErr);
                initializationFailed = true;
              }
            } else if (refTemplate.default_trigger) {
              console.log(`[Blueprint Deploy] Registered non-scheduled workflow trigger metadata: ${refTemplate.id} (${triggerType || "unknown"})`);
            }
            if (refTemplate.initial_tasks && Array.isArray(refTemplate.initial_tasks)) {
              try {
                for (const t of selectInitialExecutionTasks(refTemplate.initial_tasks)) {
                  const payloadContent = redactSecretsDeep({
                    template_id: refTemplate.id,
                    template_slug: refTemplate.slug || refTemplate.id,
                    template_inputs: data.template_inputs || {},
                    workflow_readiness: readinessPayload,
                    template_snapshot: templateSnapshot,
                    initial_task: t
                  });

                  await tasksRepo.create({
                    owner_id: ownerId,
                    instance_id: generatedId,
                    template_id: refTemplate.id,
                    title: `${refTemplate.name} - 初始化阶段: ${t.title}`,
                    trigger_type: "template_initial",
                    status: initialTaskStatus(readiness, t.status || "queued"),
                    input_payload: payloadContent
                  });
                }
                console.log(`[Blueprint Deploy] Created initial tasks for refTemplate: ${refTemplate.id}`);
              } catch (taskErr) {
                console.error("[Blueprint Deploy] Failed to create initial tasks for refTemplate:", refTemplate.id, taskErr);
                initializationFailed = true;
              }
            }
            childResults.push({ templateId: refTemplate.id, readiness: initializationFailed ? "failed" : readiness.state, initializationFailed });
          }

          const childSummary = summarizeBlueprintChildResults(referencedTemplates.length, childResults);

          await deploymentEventsRepo.create({
            instance_id: generatedId,
            owner_id: req.user.id,
            step: "blueprint_expanded_workflows",
            status: childSummary.status,
            message: childSummary.failed > 0 ? `行业方案子工作流初始化存在 ${childSummary.failed} 个失败项` : `行业方案包含的 ${referencedTemplates.length} 个子工作流已完成初始化`,
            metadata: childSummary
          });

          // Generate mybay.blueprint.yaml on blueprint deployment
          if (data.blueprint_id) {
            try {
              const yaml = await import("js-yaml");
              const instanceDir = path.join(process.cwd(), "data", "instances", generatedId);
              if (!fs.existsSync(instanceDir)) {
                fs.mkdirSync(instanceDir, { recursive: true });
              }

              const blueprintDoc = redactSecretsDeep({
                blueprint: {
                  id: data.blueprint_id,
                  name: blueprint ? blueprint.name : "Unknown Blueprint",
                  description: blueprint ? blueprint.description : "",
                  version: blueprint ? (blueprint.version || "1.0.0") : "1.0.0"
                },
                instance: {
                  id: generatedId,
                  name: data.name,
                  path: data.path,
                  deployed_at: new Date().toISOString()
                },
                workflows: referencedTemplates.map((refTemplate: any) => ({
                  id: refTemplate.id,
                  name: refTemplate.name,
                  readiness: refTemplate.readiness || "ready",
                  inputs: data.template_inputs || {}
                }))
              });

              const yamlString = yaml.dump(blueprintDoc);
              fs.writeFileSync(path.join(instanceDir, "mybay.blueprint.yaml"), yamlString, "utf8");
              console.log(`[Blueprint Deploy] Successfully generated mybay.blueprint.yaml inside ${instanceDir}`);
            } catch (yamlErr: any) {
              console.error("[Blueprint Deploy] Failed to generate mybay.blueprint.yaml:", yamlErr.message);
            }
          }
        } catch (bpExpansionErr) {
          console.error("[Blueprint Deploy] Failed to expand referenced templates:", bpExpansionErr);
        }
      }
      
      await dbAdapter.insertAuditLog({
        instance_id: newInstance.id,
        action: "create",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Created new instance"
      });

      console.log("Created asynchronous deployment task:", deploymentTaskId, "for instance:", newInstance.id);

      await deploymentEventsRepo.create({
        instance_id: generatedId,
        owner_id: req.user.id,
        step: "instance_queued",
        status: "success",
        message: "实例已成功加入本地异步部署队列。",
        metadata: { execution: "local-docker" }
      }).catch(() => {});

      const { sanitizeInstance } = require("../../utils/sanitizer");
      const sanitized = sanitizeInstance(newInstance);
      if (autoGeneratedWebhookSecret) {
        sanitized.autoGeneratedWebhookSecret = autoGeneratedWebhookSecret;
      }

      if (dashboardAccessEnabled && isWeb && plainPasswordForResponse) {
        sanitized.initialDashboardCredentials = {
          username: secureData.username || "admin",
          password: plainPasswordForResponse,
          url: ctx.publicUrl || sanitized.url
        };
      }

      res.status(202).json({
        ...sanitized,
        id: newInstance.id,
        instanceId: newInstance.id,
        deploymentTaskId,
        status: "queued",
        statusUrl: `/api/deployments/${deploymentTaskId}`,
      });
    } catch (e: any) {
      console.error("Instance creation error:", e);
      if (sendEntitlementError(res, e)) return;
      if (typeof instanceCreatedLocally !== "undefined" && instanceCreatedLocally) {
         try {
            console.log(`[Rollback] Clean-up for failed instance creation: ${generatedId}`);
            
            // Delete created instance
            await dbAdapter.deleteInstance(generatedId).catch((err) => console.error("Rollback deleteInstance error:", err));
            await dbAdapter.deleteProvisioningRecords(generatedId).catch((err) => console.error("Rollback provisioning records error:", err));


            // Rollback file moves and database links
            for (const moved of movedFiles) {
              try {
                if (fs.existsSync(moved.newPath)) {
                  fs.renameSync(moved.newPath, moved.oldPath);
                }
                const { filesRepo } = await import("../../repositories/filesRepo");
                await filesRepo.updateInstanceId(moved.fileId, null as any, moved.oldPath).catch(() => {});
              } catch (fileRollbackErr) {
                console.error("[Rollback] Failed to restore file:", moved.fileId, fileRollbackErr);
              }
            }
         } catch (ignore) {}
      }
      res.status(500).json({ error: "应用创建或部署调度失败: " + e.message });
    }
  });

  return router;
}



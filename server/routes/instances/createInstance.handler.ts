import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { createHash } from "crypto";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext, rebuildProxyConfig } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { isAdvancedResourceConfigEnabled } from "../../utils/advancedResourceConfigFeature";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { sanitizeChannelConfigForChannel } from "../../utils/channelConfigSanitizer";
import { assertCanCreateInstance, assertCanUseChannel, getEffectiveEntitlements, getStorageLimitMb, sendEntitlementError } from "../../services/entitlements";

import { RouterDependencies } from "./index";
import { isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt, tryResolvePlainInstancePassword } from "../../crypto";
import { isMaskedSecretPlaceholder, redactSecretsDeep } from "../../utils/sanitizer";
import bcrypt from "bcryptjs";
import { findAvailablePort, listInstancePortCandidates } from "../../utils";
import { execFile } from "child_process";
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

import { canonicalJson, checkLimitOrSkipAdmin } from "./create/createRequestPolicy";
import { resolveCreateTemplateContext } from "./createTemplateContext";
import { resolveCreateRuntimeImage } from "./createRuntimeImageSelection";
import { initializeTemplateWorkflow } from "./createTemplateWorkflowInitialization";

export { createInstanceLimiter, checkLimitOrSkipAdmin } from "./create/createRequestPolicy";

export function createInstanceHandler(deps: RouterDependencies) {
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;
  return async (req: AuthenticatedRequest, res: Response) => {
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

      const templateContext = await resolveCreateTemplateContext({
        data,
        generatedId,
        userId: req.user.id,
        res,
      });
      if (!templateContext) return;
      const { template, blueprint, referencedTemplates } = templateContext;

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
        'skillGithubToken', 'a2aBearerToken',
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
      const runtimeImageResult = await resolveCreateRuntimeImage({
        data,
        secureData,
        userRole: req.user.role,
      });
      if (runtimeImageResult.ok === false) {
        return res.status(runtimeImageResult.status).json(runtimeImageResult.body);
      }
      const { agent_image, agent_image_tag, agent_version, resolved_version, myBayVersions } = runtimeImageResult.selection;

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
        await initializeTemplateWorkflow({
          template,
          data,
          generatedId,
          ownerId: req.user.id,
          deploymentEventsRepo,
        });
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
  };
}

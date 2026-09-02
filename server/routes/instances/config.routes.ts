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
import { createConfigArchiveRoutes } from "./configArchive.routes";
import {
  collectReservedInstancePorts,
  disableCredentiallessA2AForRestore,
  isContainerlessInstanceEligibleForDeployment,
} from "../../utils/configArchiveRestorePolicy";

export function createConfigRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.use(createConfigArchiveRoutes(deps));

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
      if (
        data.providerCredentialId !== undefined &&
        data.providerCredentialId !== null &&
        typeof data.providerCredentialId !== "string"
      ) {
        return res.status(400).json({
          code: "INVALID_PROVIDER_CREDENTIAL_ID",
          error: "配置格式验证错误：'providerCredentialId' 必须是 string 字符串或 null。"
        });
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

      const config = parseInstanceConfigJson(instance.config_json);
      const previousChannelConfig = { ...config };
      const credentialSelection = resolveProviderCredentialSelection(data, config);
      const { selectedCredentialId } = credentialSelection;

      // Resolve saved credential if provided during update
      if (selectedCredentialId) {
        try {
          const cred = await dbAdapter.getCredentialById(selectedCredentialId, req.user.id);
          data.providerCredentialId = selectedCredentialId;
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

      if (
        credentialSelection.requiresNewManualApiKey ||
        (
          credentialSelection.switchingToManual &&
          isMaskedSecretPlaceholder(data.providerApiKey)
        )
      ) {
        return res.status(400).json({
          code: "MODEL_API_KEY_REQUIRED",
          error: "切换为手动填写 API Key 时，请输入新的模型 API Key。"
        });
      }
      
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
        if (data.providerApiKey) delete config.apiKey;
      }
      if (selectedCredentialId) {
        config.providerCredentialId = selectedCredentialId;
        delete config.apiKey;
      } else if (credentialSelection.switchingToManual) {
        delete config.providerCredentialId;
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
      const isInitialDeployment = isContainerlessInstanceEligibleForDeployment(instance);
      try {
        const dbContainerId = instance.container_id;
        const dbContainerName = instance.container_name;

        if (!dbContainerId && !dbContainerName && !isInitialDeployment) {
          return res.status(400).json({
            error: "容器定位自检判定：由于该实例在数据库中没有容器标识（container_id 与 container_name 均为空），暂无法进行配置热更新保存并重启。请确认实例已被成功初次部署上线。"
          });
        }

        const containers = isInitialDeployment ? [] : await docker.listContainers({ all: true });

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

        if (isInitialDeployment) {
          // No existing container can be overwritten. The owned, stopped
          // record is safe to save and will be created by executeDeployment.
        } else if (dbContainerId) {
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

      if (isInitialDeployment) {
        disableCredentiallessA2AForRestore(normalizedConfig);
        const siblingInstances = (await dbAdapter.getInstances(req.user.id, req.user.role))
          .filter((candidate: any) => candidate.id !== instance.id);
        const reservedPorts = collectReservedInstancePorts(siblingInstances);
        const configuredPort = Number.parseInt(
          String(normalizedConfig.host_port || normalizedConfig.port || ""),
          10,
        );
        if (
          !Number.isInteger(configuredPort)
          || configuredPort < 1
          || configuredPort > 65535
          || reservedPorts.includes(configuredPort)
          || [3000, 15929].includes(configuredPort)
        ) {
          const assignedPort = await findAvailablePort(docker, reservedPorts);
          normalizedConfig.host_port = assignedPort;
          normalizedConfig.port = String(assignedPort);
        }
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

  router.use(createRuntimeConfigRoutes());

  return router;
}




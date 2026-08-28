import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { providerRegistry } from "../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../shared/providerRegistryUtils";
import { buildProviderRuntimeEnv, buildHermesModelConfig } from "./providerEnv";
import { buildChannelRuntimeEnv } from "./channelEnv";
import { decrypt, tryResolvePlainInstancePassword } from "./crypto";
import { isMaskedSecretPlaceholder, redactSecretsDeep } from "./utils/sanitizer";
import { buildInstancePublicUrl } from "./utils/publicUrl";
import { ensureEncryptedDashboardAuthSecret } from "./utils/dashboardAuthSecret";
import { MANAGED_OPERATION_SYSTEM_POLICY } from "./utils/managedOperationGuard";

export const DEFAULT_AGENT_MAX_TURNS = 60;
export const DEFAULT_AGENT_GATEWAY_TIMEOUT = 300;
export const DEFAULT_AGENT_RESTART_DRAIN_TIMEOUT = 60;
export const DEFAULT_DELEGATION_CONFIG = {
  max_iterations: 15,
  max_concurrent_children: 1,
  max_spawn_depth: 1,
  child_timeout_seconds: 600,
  orchestrator_enabled: false
};

export function buildHermesNativeYamlTemplate(
  provider = "openai",
  model = "gpt-4o",
  auxiliaryBlock = "",
  dashboardBlock = "",
  displayBlock = "",
  pluginsBlock = "",
  config: any = {}
) {
  return `
model:
  provider: "${provider}"
  default: "${model}"

providers: {}
fallback_providers: []
credential_pool_strategies: {}

toolsets:
  - hermes-cli

agent:
  max_turns: ${DEFAULT_AGENT_MAX_TURNS}
  gateway_timeout: ${DEFAULT_AGENT_GATEWAY_TIMEOUT}
  restart_drain_timeout: ${DEFAULT_AGENT_RESTART_DRAIN_TIMEOUT}
  api_max_retries: 3
  service_tier: "standard"
  tool_use_enforcement: "auto"
  task_completion_guidance: true
  environment_probe: true
  environment_hint: ""
  gateway_timeout_warning: 180
  clarify_timeout: 180
  gateway_notify_interval: 60
  gateway_auto_continue_freshness: 1800
  image_input_mode: "auto"
  disabled_toolsets: []

terminal: {}
web: {}
browser: {}
checkpoints: {}
${auxiliaryBlock}
${dashboardBlock}

${displayBlock}

${pluginsBlock}

privacy: {}
memory: {}
delegation:
  max_iterations: ${DEFAULT_DELEGATION_CONFIG.max_iterations}
  max_concurrent_children: ${DEFAULT_DELEGATION_CONFIG.max_concurrent_children}
  max_spawn_depth: ${DEFAULT_DELEGATION_CONFIG.max_spawn_depth}
  child_timeout_seconds: ${DEFAULT_DELEGATION_CONFIG.child_timeout_seconds}
  orchestrator_enabled: ${DEFAULT_DELEGATION_CONFIG.orchestrator_enabled}
skills: {}
security: {}
gateway: {}
sessions: {}

model_catalog:
  enabled: false
  url: "https://hermes-agent.nousresearch.com/docs/api/model-catalog.json"
  ttl_hours: 24

logging: {}
network: {}
cron: {}
kanban: {}

telegram:
  allowed_users: "${config?.telegramAllowedUsers || ''}"
  allowed_chats: "${config?.telegramAllowedChats || ''}"

feishu:
  allowed_users: "${config?.feishuAllowedUsers || ''}"
  allowed_chats: "${config?.feishuAllowedChats || ''}"

discord:
  allowed_users: "${config?.discordAllowedUsers || ''}"
  allowed_guilds: "${config?.discordAllowedGuilds || ''}"
  allowed_channels: "${config?.discordAllowedChannels || ''}"

slack:
  allowed_users: "${config?.slackAllowedUsers || ''}"
  allowed_channels: "${config?.slackAllowedChannels || ''}"

dingtalk:
  allowed_users: "${config?.dingtalkAllowedUsers || ''}"
  allowed_chats: "${config?.dingtalkAllowedChats || ''}"

whatsapp:
  allowed_users: "${config?.whatsappAllowedUsers || ''}"
  allowed_channels: "${config?.whatsappAllowedChannels || ''}"

qq_bot:
  allowed_users: "${config?.qqBotAllowedUsers || ''}"
  allowed_guilds: "${config?.qqBotAllowedGuilds || ''}"
  allowed_channels: "${config?.qqBotAllowedChannels || ''}"

wechat_mp:
  allowed_users: "${config?.wechatMpAllowedUsers || ''}"
  allowed_chats: "${config?.wechatMpAllowedChats || ''}"

wecom:
  allowed_users: "${config?.wecomAllowedUsers || ''}"
  allowed_chats: "${config?.wecomAllowedChats || ''}"

weixin:
  allowed_users: "${config?.weixinAllowedUsers || ''}"
  allowed_chats: "${config?.weixinAllowedChats || ''}"

webhook:
  allowed_users: "${config?.webhookAllowedUsers || ''}"
  allowed_channels: "${config?.webhookAllowedChannels || ''}"
`;
}

function cleanYamlObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => cleanYamlObject(item));
  }

  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'object' && val !== null) {
        const cleanedVal = cleanYamlObject(val);
        if (Array.isArray(cleanedVal)) {
          cleaned[key] = cleanedVal;
        } else {
          const emptyKeys = Object.keys(cleanedVal);
          if (emptyKeys.length > 0) {
            cleaned[key] = cleanedVal;
          } else {
            const sectionsToRemoveIfEmpty = [
              "telegram", "discord", "slack", "dingtalk", "qq_bot",
              "wechat_mp", "wecom", "weixin", "webhook", "whatsapp",
              "context_file_max_chars", "max_concurrent_sessions", "feishu"
            ];
            if (!sectionsToRemoveIfEmpty.includes(key)) {
              cleaned[key] = cleanedVal;
            }
          }
        }
      } else {
        if (val !== "" && val !== null && val !== undefined) {
          cleaned[key] = val;
        }
      }
    }
    return cleaned;
  }

  return obj;
}

export function buildHermesOAuthAuthStore(
  existing: any,
  providerId: string,
  oauthAuthPayload: any,
  fallbackBaseUrl = "",
) {
  const authStore = existing && typeof existing === "object"
    ? existing
    : { version: 2, providers: {}, credential_pool: {} };
  authStore.version = Math.max(Number(authStore.version) || 1, 2);
  authStore.providers = authStore.providers && typeof authStore.providers === "object" ? authStore.providers : {};
  authStore.credential_pool = authStore.credential_pool && typeof authStore.credential_pool === "object" ? authStore.credential_pool : {};
  const tokens = oauthAuthPayload?.tokens;
  if (!tokens?.access_token || !tokens?.refresh_token) {
    throw new Error("OAUTH_CREDENTIAL_INVALID");
  }
  const oauthPayload = {
    ...oauthAuthPayload,
    provider: providerId,
    auth_type: "oauth_external",
    credential_pool: providerId,
    tokens,
  };
  authStore.providers[providerId] = oauthPayload;
  const expiresAt = tokens.expires_at || oauthPayload.expires_at;
  const expiresAtMs = expiresAt ? Date.parse(String(expiresAt)) : undefined;
  const poolEntries = Array.isArray(authStore.credential_pool[providerId])
    ? authStore.credential_pool[providerId]
    : [];
  const poolId = String(oauthPayload.credential_id || `${providerId}-mybay-local`)
    .replace(/[^A-Za-z0-9_.:-]/g, "-")
    .slice(0, 120);
  const poolEntry = {
    id: poolId,
    label: String(oauthPayload.label || providerId),
    auth_type: "oauth",
    priority: 0,
    source: "manual:device_code",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    base_url: oauthPayload.base_url || fallbackBaseUrl || undefined,
    expires_at: expiresAt,
    expires_at_ms: Number.isFinite(expiresAtMs) ? expiresAtMs : undefined,
    last_refresh: oauthPayload.last_refresh,
  };
  const existingIndex = poolEntries.findIndex((entry: any) => entry?.id === poolId);
  if (existingIndex >= 0) poolEntries[existingIndex] = { ...poolEntries[existingIndex], ...poolEntry };
  else poolEntries.push(poolEntry);
  authStore.credential_pool[providerId] = poolEntries;
  authStore.active_provider = providerId;
  return authStore;
}

function sanitizeErrorMessage(msg: string, config: any): string {
  if (!msg) return "";
  let clean = msg;

  // Redact mb_dash_xxxxxxxxxxxxx
  clean = clean.replace(/mb_dash_[a-fA-F0-9]+/gi, "[REDACTED_DASHBOARD_SECRET]");

  // 1. Decrypt raw password and raw API key to redact them
  let rawPassword = "";
  let rawApiKey = "";

  if (config) {
    try {
      if (config.password) rawPassword = decrypt(config.password);
    } catch (e) {}

    try {
      if (config.providerApiKey) rawApiKey = decrypt(config.providerApiKey);
      else if (config.apiKey) rawApiKey = decrypt(config.apiKey);
    } catch (e) {}
  }

  if (rawPassword && rawPassword.length > 0) {
    const escaped = rawPassword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escaped, 'g'), "[REDACTED_PASSWORD]");
  }

  if (rawApiKey && rawApiKey.length > 0) {
    const escaped = rawApiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escaped, 'g'), "[REDACTED_API_KEY]");
  }

  // Redact ENCRYPTION_KEY=xxxx or encryption_key=xxxx (case-insensitive)
  clean = clean.replace(/encryption_key\s*=\s*[^\s,;"]+/gi, "encryption_key=[REDACTED_KEY_SYM]");

  // Redact Authorization: Bearer xxxx (case-insensitive)
  clean = clean.replace(/Authorization:\s*Bearer\s+[^\s,;"]+/gi, "Authorization: Bearer [REDACTED_TOKEN]");

  // Redact Bearer xxxx (case-insensitive)
  clean = clean.replace(/Bearer\s+[^\s,;"]+/gi, "Bearer [REDACTED_TOKEN]");

  // Redact iv:tag:ciphertext format (12 bytes iv = 24 hex characters, 16 bytes tag = 32 hex characters, arbitrary hex ciphertext)
  clean = clean.replace(/\b[a-fA-F0-9]{24}:[a-fA-F0-9]{32}:[a-fA-F0-9]+\b/gi, "[REDACTED_CIPHERTEXT]");

  // Redact long hex strings (length >= 32)
  clean = clean.replace(/\b[a-fA-F0-9]{32,}\b/gi, "[REDACTED_HEX]");

  // 2. Redact long base64 or hex strings (like encrypted ciphertexts)
  clean = clean.replace(/[A-Za-z0-9+/=]{24,}/g, "[REDACTED_SECRET]");

  // 3. Redact ENCRYPTION_KEY or decryptions
  clean = clean.replace(/ENCRYPTION_KEY/gi, "[REDACTED_KEY_SYM]");

  // 4. Redact plain text password or decrypt secrets from standard helper if any remaining
  const plainPwd = tryResolvePlainInstancePassword(config);
  if (plainPwd && plainPwd.length > 0) {
    const escapedPwd = plainPwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escapedPwd, 'g'), "[REDACTED_PASSWORD]");
  }

  // Redact config.password itself if any remains
  if (config && config.password && typeof config.password === 'string') {
    const escaped = config.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escaped, 'g'), "[REDACTED_CIPHERTEXT]");
  }

  // Redact API Keys if they are strings
  if (config && config.providerApiKey && typeof config.providerApiKey === 'string') {
    const escaped = config.providerApiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escaped, 'g'), "[REDACTED_API_KEY]");
  }
  if (config && config.apiKey && typeof config.apiKey === 'string') {
    const escaped = config.apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escaped, 'g'), "[REDACTED_API_KEY]");
  }

  return clean;
}

export function writePhysicalConfigs(instanceId: string, config: any) {
  try {
    const instanceDir = path.join(process.cwd(), "data", "instances", instanceId);
    if (!fs.existsSync(instanceDir)) {
      fs.mkdirSync(instanceDir, { recursive: true });
    }

    const providerStr = String(config.provider || '');
    const modelStr = String(config.model || '');

    const regKeyForMeta = resolveProviderRegistryKey(providerStr, modelStr, config.baseUrl);
    const registryItem = providerRegistry[regKeyForMeta];
    const providerLabel = registryItem ? registryItem.label : providerStr;
    const providerType = registryItem ? registryItem.type : "openai-compatible";

    const internalPortVal = String(config.internal_web_port || "9119");
    
    const plainPassword = tryResolvePlainInstancePassword(config);
    const username = config.username || "admin";

    let decryptedSecret = "";
    let sessionTtlSeconds = 604800;
    let pluginsBlock = "";

    let pluginsEnabled: string[] = [];
    let pluginsDisabled: string[] = [];

    if (config.plugins && typeof config.plugins === 'object') {
      if (Array.isArray(config.plugins.enabled)) {
        pluginsEnabled = [...config.plugins.enabled];
      }
      if (Array.isArray(config.plugins.disabled)) {
        pluginsDisabled = [...config.plugins.disabled];
      }
    }

    if (config.nativeDashboardBasicAuthEnabled === true) {
      ensureEncryptedDashboardAuthSecret(config);
      if (config.hermesDashboardAuthSecret) {
        try {
          decryptedSecret = decrypt(config.hermesDashboardAuthSecret);
        } catch (e: any) {
          console.warn("[ConfigWriter] Failed to decrypt hermesDashboardAuthSecret:", e.message);
        }
      }
      if (!decryptedSecret || decryptedSecret.length < 16) {
        if (config.dashboardAuthSecret) {
          try {
            decryptedSecret = decrypt(config.dashboardAuthSecret);
          } catch (e: any) {
            console.warn("[ConfigWriter] Failed to decrypt dashboardAuthSecret:", e.message);
          }
        }
      }

      if (config.session_ttl_seconds !== undefined) {
        const parsedVal = parseInt(config.session_ttl_seconds, 10);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          sessionTtlSeconds = parsedVal;
        }
      } else if (config.sessionTtlSeconds !== undefined) {
        const parsedVal = parseInt(config.sessionTtlSeconds, 10);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          sessionTtlSeconds = parsedVal;
        }
      } else if (config.dashboard?.basic_auth?.session_ttl_seconds !== undefined) {
        const parsedVal = parseInt(config.dashboard.basic_auth.session_ttl_seconds, 10);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          sessionTtlSeconds = parsedVal;
        }
      }
      config.session_ttl_seconds = sessionTtlSeconds;
      config.sessionTtlSeconds = sessionTtlSeconds;

      if (!pluginsEnabled.includes("dashboard_auth/basic")) {
        pluginsEnabled.push("dashboard_auth/basic");
      }
      pluginsEnabled = Array.from(new Set(pluginsEnabled));
      pluginsEnabled = pluginsEnabled.filter(p => p !== "basic");
      pluginsDisabled = pluginsDisabled.filter(p => p !== "dashboard_auth/basic" && p !== "basic");
    }

    if (pluginsEnabled.length > 0 || pluginsDisabled.length > 0) {
      pluginsBlock = yaml.dump({
        plugins: {
          enabled: pluginsEnabled,
          disabled: pluginsDisabled
        }
      }).trim();
    } else if (config.nativeDashboardBasicAuthEnabled === true) {
      pluginsBlock = `
plugins:
  enabled:
    - "dashboard_auth/basic"
  disabled: []
`.trim();
    }

    const finalEnvMap: { [key: string]: string } = {
      PORT: internalPortVal,
    };

    const enableDashboard = config.enableDashboard ?? true;
    if (enableDashboard) {
      finalEnvMap.HERMES_DASHBOARD = "1";
      finalEnvMap.HERMES_DASHBOARD_PORT = internalPortVal;
      finalEnvMap.HERMES_DASHBOARD_HOST = "0.0.0.0";

      const dashboardAuthSecret = config.hermesDashboardAuthSecret ? decrypt(config.hermesDashboardAuthSecret) : "";
      if (config.nativeDashboardBasicAuthEnabled === true) {
        if (!config.hermesDashboardPasswordHash) {
          throw new Error("新版 Hermes Dashboard 必须提供 native dashboard basic auth 密码哈希 (hermesDashboardPasswordHash)。请确认输入或重新配置。");
        }
        if (!username || !dashboardAuthSecret || dashboardAuthSecret.length < 16) {
          throw new Error("新版 Hermes Dashboard Basic Auth 需要 username 与至少 16 字节的 secret。");
        }
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_USERNAME = username;
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH = config.hermesDashboardPasswordHash;
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_SECRET = dashboardAuthSecret;
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_TTL_SECONDS = String(sessionTtlSeconds);
      } else if (username && plainPassword && dashboardAuthSecret) {
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_USERNAME = username;
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD = plainPassword;
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_SECRET = dashboardAuthSecret;
        finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_TTL_SECONDS = String(sessionTtlSeconds);
      } else {
        throw new Error("新版 Hermes Dashboard 绑定 0.0.0.0 时必须配置 Basic Auth。请为实例设置访问保护密码后重新部署。");
      }

      if (finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_USERNAME) {
        // Optional PUBLIC_URL setup for callbacks
        if (config.slug) {
          finalEnvMap.HERMES_DASHBOARD_PUBLIC_URL = buildInstancePublicUrl(config.slug, config.host_port || config.port);
        }
      }
    }

    // Provider Env
    let rawProviderApiKey = (config.providerApiKey ? decrypt(config.providerApiKey) : '') || (config.apiKey ? decrypt(config.apiKey) : '');
    const isOAuthProvider = registryItem?.authMode === "oauth-device-code";
    let oauthAuthPayload: any = null;
    if (isOAuthProvider && rawProviderApiKey) {
      try {
        oauthAuthPayload = JSON.parse(rawProviderApiKey);
      } catch {
        throw new Error("OAuth 凭据格式无效，请重新连接模型账号后再部署。");
      }
      rawProviderApiKey = "";
    }
    
    if (isMaskedSecretPlaceholder(rawProviderApiKey)) {
      console.error(`[CRITICAL] 配置中的模型密钥已损坏或被占位符污染 (instance_id: ${instanceId})。检查到脱敏占位符。真密钥已被拦截，将不会写入运行时环境。`);
      rawProviderApiKey = '';
    }

    const hermesModelConfigResult = buildHermesModelConfig({
      provider: providerStr,
      model: modelStr,
      baseUrl: config.baseUrl || '',
      apiKey: rawProviderApiKey
    });

    if (!hermesModelConfigResult || !hermesModelConfigResult.hermesProvider || !hermesModelConfigResult.hermesModel) {
      throw new Error("Hermes 模型配置构建失败，提供商 (provider) 或模型 (model) 未配置。");
    }
    
    // Apply standard environment variables built from buildHermesModelConfig
    Object.assign(finalEnvMap, hermesModelConfigResult.envVars);

    // Mask secret for secure logging (Requirement 9)
    const maskSecret = (key: string | null | undefined): string => {
      if (!key) return "未配置";
      if (key.length <= 8) return "****";
      return key.substring(0, 4) + "****" + key.substring(key.length - 4);
    };

    console.log(`[Model Setting Injection]
  - Model Provider: ${providerStr}
  - Model Name: ${modelStr}
  - Base URL: ${config.baseUrl || '默认'}
  - API Key Env Name: ${hermesModelConfigResult.apiKeyEnvName}
  - API Key Masked: ${maskSecret(rawProviderApiKey)}
  - Config status: written successfully to .env and config.yaml`);

    // Channel Env
    const channelEnv = buildChannelRuntimeEnv(config);
    
    // Merge any explicitly injected envs (like DEMO_SAFE_MODE)
    if (config.env && typeof config.env === 'object') {
      Object.assign(finalEnvMap, config.env);
    }

    // Filter out any empty/undefined/null keys
    Object.entries(channelEnv).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        finalEnvMap[k] = v;
      }
    });

    const envLines = [
      "# MyBay Agent Environment Variables",
      "# Generated automatically by MyBay Control Plane"
    ];
    Object.entries(finalEnvMap).forEach(([k, v]) => {
      envLines.push(`${k}=${v}`);
    });

    const envContent = envLines.join("\n").trim();
    fs.writeFileSync(path.join(instanceDir, ".env"), envContent);

    if (isOAuthProvider) {
      const tokens = oauthAuthPayload?.tokens;
      if (!tokens?.access_token || !tokens?.refresh_token) {
        throw new Error("OAuth 凭据缺失或已失效，请重新连接模型账号后再部署。");
      }
      const authPath = path.join(instanceDir, "auth.json");
      let authStore: any = { version: 2, providers: {}, credential_pool: {} };
      try {
        if (fs.existsSync(authPath)) {
          const existing = JSON.parse(fs.readFileSync(authPath, "utf8"));
          if (existing && typeof existing === "object") authStore = existing;
        }
      } catch {
        authStore = { version: 2, providers: {}, credential_pool: {} };
      }
      const providerId = hermesModelConfigResult.hermesProvider;
      authStore = buildHermesOAuthAuthStore(authStore, providerId, oauthAuthPayload, config.baseUrl || "");
      fs.writeFileSync(authPath, `${JSON.stringify(authStore, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      try { fs.chmodSync(authPath, 0o600); } catch {}
    }

    // Create main_mybay_run.sh to satisfy "no sleep infinity"
    // Since gateway is dynamically registered by "gateway run", we just make main-mybay gracefully exit
    // instead of running sleep infinity. If we exit 0, s6-supervise will try to restart it unless it's one-shot.
    // To gracefully keep it up without sleeping forever, we can just run tail -f /dev/null,
    // or run a dummy python loop. But to be safest, we use s6-pause which doesn't show as "sleep infinity".
    // Alternatively, we use `s6-pause`!
    const mockMainMyBay = `#!/command/with-contenv sh\nexec s6-pause\n`;
    fs.writeFileSync(path.join(instanceDir, "main_mybay_run.sh"), mockMainMyBay);
    fs.chmodSync(path.join(instanceDir, "main_mybay_run.sh"), 0o755);

    // Create mybay.instance.yaml for MyBay metadata
    const myBayContent = `
mybay:
  instance:
    id: "${instanceId}"
    name: ${JSON.stringify(config.name || '麦贝 Agent')}
    path: ${JSON.stringify(config.path || '')}
    image: ${JSON.stringify(config.image || '')}
  control_plane:
    provider:
      name: "${providerStr}"
      label: "${providerLabel}"
      model: "${modelStr}"
      base_url: "${config.baseUrl || ''}"
      type: "${providerType}"
      api_key_env_name: "${hermesModelConfigResult.apiKeyEnvName}"
  channel:
    active: "${config.channel || ''}"
    mode: "${(config.channelMode || 'production') === 'testing' ? 'production' : (config.channelMode || 'production')}"
    gateway_allow_all_users: ${config.gatewayAllowAllUsers === true ? 'true' : 'false'}
    telegram_allowed_users: "${config.telegramAllowedUsers || ''}"
    telegram_allowed_chats: "${config.telegramAllowedChats || ''}"
    feishu_allowed_users: "${config.feishuAllowedUsers || ''}"
    feishu_allowed_chats: "${config.feishuAllowedChats || ''}"
    discord_allowed_users: "${config.discordAllowedUsers || ''}"
    discord_allowed_guilds: "${config.discordAllowedGuilds || ''}"
    discord_allowed_channels: "${config.discordAllowedChannels || ''}"
    slack_allowed_users: "${config.slackAllowedUsers || ''}"
    slack_allowed_channels: "${config.slackAllowedChannels || ''}"
    dingtalk_allowed_users: "${config.dingtalkAllowedUsers || ''}"
    dingtalk_allowed_chats: "${config.dingtalkAllowedChats || ''}"
    whatsapp_allowed_users: "${config.whatsappAllowedUsers || ''}"
    whatsapp_allowed_channels: "${config.whatsappAllowedChannels || ''}"
    qq_bot_allowed_users: "${config.qqBotAllowedUsers || ''}"
    qq_bot_allowed_guilds: "${config.qqBotAllowedGuilds || ''}"
    qq_bot_allowed_channels: "${config.qqBotAllowedChannels || ''}"
    wechat_mp_allowed_users: "${config.wechatMpAllowedUsers || ''}"
    wechat_mp_allowed_chats: "${config.wechatMpAllowedChats || ''}"
    wecom_allowed_users: "${config.wecomAllowedUsers || ''}"
    wecom_allowed_chats: "${config.wecomAllowedChats || ''}"
    weixin_allowed_users: "${config.weixinAllowedUsers || ''}"
    weixin_allowed_chats: "${config.weixinAllowedChats || ''}"
    webhook_allowed_users: "${config.webhookAllowedUsers || ''}"
    webhook_allowed_channels: "${config.webhookAllowedChannels || ''}"
  skills:
    active_list:
${(config.skills || []).map((s: string) => `      - ${s}`).join('\n') || '      []'}
  template:
    id: "${config.template_id || ''}"
    slug: "${config.template_slug || ''}"
    version: "${config.template_version || ''}"
  blueprint:
    id: "${config.blueprint_id || config.blueprint_snapshot?.id || ''}"
    slug: "${config.blueprint_slug || config.blueprint_snapshot?.slug || ''}"
    version: "${config.blueprint_version || config.blueprint_snapshot?.version || ''}"
`.trim();

    fs.writeFileSync(path.join(instanceDir, "mybay.instance.yaml"), myBayContent);

    // Create mybay.template.yaml if template info is present
    if (config.template_id || config.template_snapshot) {
      const templateData = redactSecretsDeep({
        template_id: config.template_id || "",
        template_name: config.template_snapshot?.name || "",
        template_slug: config.template_slug || "",
        template_version: config.template_version || "1.0.0",
        inputs: config.template_inputs || {}
      });
      fs.writeFileSync(path.join(instanceDir, "mybay.template.yaml"), yaml.dump(templateData), "utf8");
    }

    // Create mybay.blueprint.yaml if an industry blueprint is present.
    // Keep blueprint metadata consistent across create and redeploy flows.
    if (config.blueprint_id || config.blueprint_snapshot) {
      const blueprintSnapshot = config.blueprint_snapshot || {};
      const blueprintData = redactSecretsDeep({
        blueprint_id: config.blueprint_id || blueprintSnapshot.id || "",
        blueprint_name: blueprintSnapshot.name || "",
        blueprint_slug: config.blueprint_slug || blueprintSnapshot.slug || "",
        blueprint_version: config.blueprint_version || blueprintSnapshot.version || "1.0.0",
        description: blueprintSnapshot.description || "",
        category: blueprintSnapshot.category || "",
        recommended_skills: blueprintSnapshot.recommended_skills || config.skills || [],
        recommended_channels: blueprintSnapshot.recommended_channels || (config.channel ? [config.channel] : []),
        referenced_workflow_template_ids: blueprintSnapshot.referenced_workflow_template_ids || [],
        system_context_preview: blueprintSnapshot.system_context_preview || "",
        inputs: config.template_inputs || {}
      });
      fs.writeFileSync(path.join(instanceDir, "mybay.blueprint.yaml"), yaml.dump(blueprintData), "utf8");
    }

    // Resolve and write system prompt & template variables into SOUL.md / mybay.system.md
    let finalPrompt = config.prompt || "";
    if (config.template_snapshot?.default_prompt) {
      const basePrompt = config.template_snapshot.default_prompt;
      const inputs = config.template_inputs || {};
      finalPrompt = basePrompt.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
        return inputs[key] !== undefined ? String(inputs[key]) : match;
      });
    } else if (!finalPrompt && config.blueprint_snapshot?.system_context_preview) {
      finalPrompt = String(config.blueprint_snapshot.system_context_preview);
    }

    finalPrompt = finalPrompt
      ? `${finalPrompt.trim()}\n\n${MANAGED_OPERATION_SYSTEM_POLICY}`
      : MANAGED_OPERATION_SYSTEM_POLICY;
    fs.writeFileSync(path.join(instanceDir, "SOUL.md"), finalPrompt, "utf8");
    fs.writeFileSync(path.join(instanceDir, "mybay.system.md"), finalPrompt, "utf8");

    // Resolve any explicit auxiliary configuration from config or inputs or env map
    let explicitAuxProvider = (config?.auxiliary_provider || config?.auxiliaryProvider || "").trim().toLowerCase();
    let explicitAuxModel = (config?.auxiliary_model || config?.auxiliaryModel || "").trim();

    if (config?.auxiliary && typeof config.auxiliary === "object") {
      explicitAuxProvider = explicitAuxProvider || String(config.auxiliary.provider || "").trim().toLowerCase();
      explicitAuxModel = explicitAuxModel || String(config.auxiliary.model || "").trim();
    } else if (config?.auxiliary && typeof config.auxiliary === "string") {
      explicitAuxProvider = explicitAuxProvider || String(config.auxiliary).trim().toLowerCase();
    }

    if (config?.template_inputs) {
      explicitAuxProvider = explicitAuxProvider || String(config.template_inputs.auxiliary_provider || config.template_inputs.auxiliaryProvider || "").trim().toLowerCase();
      explicitAuxModel = explicitAuxModel || String(config.template_inputs.auxiliary_model || config.template_inputs.auxiliaryModel || "").trim();
    }

    explicitAuxProvider = explicitAuxProvider || String(finalEnvMap.AUXILIARY_PROVIDER || process.env.AUXILIARY_PROVIDER || "").trim().toLowerCase();
    explicitAuxModel = explicitAuxModel || String(finalEnvMap.AUXILIARY_MODEL || process.env.AUXILIARY_MODEL || "").trim();

    // Auxiliary config logic
    const providerStrLower = String(config?.provider || config?.model_provider || "").toLowerCase();
    const hasOpenRouterKey = !!finalEnvMap.OPENROUTER_API_KEY;
    const hasNousAuth = !!(finalEnvMap.NOUS_API_KEY || finalEnvMap.NOUS_AUTH || finalEnvMap.NOUS_API_TOKEN);

    let auxiliaryBlock = "auxiliary:\n  provider: \"none\"\n  model: \"none\"";

    if (explicitAuxProvider && explicitAuxProvider !== "none") {
      // If user explicitly configured an auxiliary provider
      let hasCredsForExplicit = false;
      if (explicitAuxProvider === "openrouter") {
        hasCredsForExplicit = hasOpenRouterKey;
      } else if (explicitAuxProvider === "nous") {
        hasCredsForExplicit = hasNousAuth;
      } else {
        // For other explicit providers, if key exists in env or we assume configuration implies intent
        hasCredsForExplicit = true;
      }

      if (hasCredsForExplicit) {
        auxiliaryBlock = `auxiliary:\n  provider: "${explicitAuxProvider}"\n  model: "${explicitAuxModel || 'auto'}"`;
      }
    } else {
      // No explicit auxiliary config, fall back to matching primary provider if we have credentials
      if (providerStrLower === "openrouter" && hasOpenRouterKey) {
        auxiliaryBlock = `auxiliary:\n  provider: "openrouter"\n  model: "auto"`;
      } else if (providerStrLower === "nous" && hasNousAuth) {
        auxiliaryBlock = `auxiliary:\n  provider: "nous"\n  model: "auto"`;
      }
    }

    // pet configuration block (using official display.pet structure)
    let displayBlock = "display: {}";
    if (config.pet && config.pet.enabled) {
      const petConf: any = { enabled: true };
      if (config.pet.slug) petConf.slug = config.pet.slug;
      if (config.pet.render_mode) petConf.render_mode = config.pet.render_mode;
      if (typeof config.pet.scale === 'number') petConf.scale = config.pet.scale;
      
      try {
        displayBlock = yaml.dump({ display: { pet: petConf } }).trim();
      } catch (err) {
        console.error("Failed to dump display block yaml, fallback to raw string", err);
        displayBlock = `display:\n  pet:\n    enabled: true\n    slug: "${petConf.slug || ''}"`;
      }
    }

    // learn configuration is explicitly EXCLUDED from Hermes native config.yaml
    // because it currently lacks an official schema, but it remains in config_json for MyBay layer.

    // observability log
    if (config.pet?.enabled || config.learn?.enabled) {
      console.log(`[ConfigWriter] Observability (instance_id: ${instanceId}): pet_enabled=${!!config.pet?.enabled} (injected as display.pet), learn_enabled=${!!config.learn?.enabled} (retained in MyBay config, NOT injected into Hermes native config)`);
    }

    let dashboardBlock = "dashboard: {}";
    if (enableDashboard) {
      if (config.nativeDashboardBasicAuthEnabled === true) {
        if (!config.hermesDashboardPasswordHash) {
          throw new Error("新版 Hermes Dashboard 必须提供 native dashboard basic auth 密码哈希 (hermesDashboardPasswordHash)。请确认输入或重新配置。");
        }
        dashboardBlock = `
dashboard:
  enabled: true
  basic_auth:
    username: "${username}"
    password_hash: "${config.hermesDashboardPasswordHash}"
    secret: "${decryptedSecret}"
    session_ttl_seconds: ${sessionTtlSeconds}
`.trim();
      } else {
        dashboardBlock = `
dashboard:
  enabled: true
`.trim();
      }
    } else {
      dashboardBlock = `
dashboard:
  enabled: false
`.trim();
    }

    const hermesNativeYamlContent = buildHermesNativeYamlTemplate(
      hermesModelConfigResult.hermesProvider,
      hermesModelConfigResult.hermesModel,
      auxiliaryBlock,
      dashboardBlock,
      displayBlock,
      pluginsBlock,
      config
    );

    // Load native YAML structure into JS object, clean it recursively to remove empty properties and empty sections,
    // and dump it back cleanly.
    let finalYamlContent = "";
    try {
      const parsedObj = yaml.load(hermesNativeYamlContent) as any;
      parsedObj.model = {
        ...(parsedObj.model || {}),
        ...(hermesModelConfigResult.configYaml.model || {})
      };
      parsedObj.providers = {
        ...(parsedObj.providers || {}),
        ...(hermesModelConfigResult.configYaml.providers || {})
      };
      const cleanedObj = cleanYamlObject(parsedObj) as any;

      if (config.nativeDashboardBasicAuthEnabled === true) {
        const dbAuth = cleanedObj.dashboard?.basic_auth;
        const enabledPlugins = cleanedObj.plugins?.enabled || [];
        if (
          !dbAuth ||
          !dbAuth.username ||
          !dbAuth.password_hash ||
          !dbAuth.secret ||
          dbAuth.secret.length < 16 ||
          !(dbAuth.session_ttl_seconds > 0) ||
          !enabledPlugins.includes("dashboard_auth/basic") ||
          !finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH ||
          !!finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD ||
          !finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_SECRET ||
          finalEnvMap.HERMES_DASHBOARD_BASIC_AUTH_SECRET.length < 16
        ) {
          throw new Error("DASHBOARD_AUTH_CONFIG_INVALID");
        }
      }

      finalYamlContent = yaml.dump(cleanedObj, { noRefs: true, lineWidth: -1 });
    } catch (parseErr: any) {
      if (parseErr.message === "DASHBOARD_AUTH_CONFIG_INVALID") {
        throw parseErr;
      }
      console.error("Failed to parse or clean config.yaml with js-yaml, falling back to basic string filtering:", parseErr);
      const lines = hermesNativeYamlContent.split("\n");
      const cleanedLines = lines.filter(line => {
        const trimmed = line.trim();
        const matchesEmptyProp = /^[ \t]*[\w_-]+\s*:\s*(["']\s*["']|null)?\s*$/.test(line);
        const isTopLevelSection = /^\w+:\s*$/.test(line); // sections like "telegram:" or "model:"
        if (matchesEmptyProp && !isTopLevelSection) {
          return false;
        }
        return true;
      });
      finalYamlContent = cleanedLines.join("\n");
    }

    fs.writeFileSync(path.join(instanceDir, "config.yaml"), finalYamlContent);

    return { finalEnvMap, hermesModelConfigResult };
  } catch (err: any) {
    const cleanMsg = sanitizeErrorMessage(err.message || String(err), config);
    console.error("[ConfigWriter] Failed to write physical configs:", {
      errorName: err?.name || "Error",
      message: cleanMsg
    });
    throw new Error(cleanMsg);
  }
}

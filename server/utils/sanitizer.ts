import { instanceSensitiveFields } from "./instances/instanceSensitiveFields";
import { providerRegistry } from "../../shared/providerRegistry";

const DEFAULT_SENSITIVE_KEYS = [
  ...instanceSensitiveFields,
  'apiKey', 'api_key', 'token', 'secret', 'password', 'authorization', 
  'credential', 'webhook', 'encrypted', 'private', 'access_token', 
  'refresh_token', 'app_secret', 'bot_token', 'client_secret',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY',
  'FEISHU_APP_SECRET', 'TELEGRAM_BOT_TOKEN', 'DISCORD_TOKEN'
];

/**
 * Regex patterns for desensitizing strings (logs, errors, etc.)
 */
const SECRET_REDACTION_PATTERNS = [
  // Authorization headers
  /(Authorization:\s*(Bearer|Basic)\s+)[^\s"'\\]+/gi,
  // sk- keys
  /(sk-[a-zA-Z0-9]{20,})/g,
  // tokens, keys, secrets in env vars or JSON
  /((OPENAI_API_KEY|API_KEY|SECRET|TOKEN|PASSWORD|CLIENT_SECRET)["']?\s*[:=]\s*["']?)[^\s"'\\]+(["']?)/gi,
  // eyJ tokens (JWT)
  /(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/g,
  // URL credentials
  /:\/\/[^:]+:[^@]+@/g,
];

/**
 * Redacts secrets from a string using regex patterns.
 */
export function sanitizeString(str: string): string {
  if (!str) return str;
  let result = str;
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    result = result.replace(pattern, (match, p1, p2, p3) => {
      if (match.startsWith('://')) {
        return '://[REDACTED]:[REDACTED]@';
      }
      if (p1 && p3 !== undefined && !match.startsWith('eyJ') && !match.startsWith('sk-')) {
        return p1 + '[REDACTED]' + p3;
      }
      if (p1 && !match.startsWith('eyJ') && !match.startsWith('sk-')) {
        return p1 + '[REDACTED]';
      }
      return '[REDACTED]';
    });
  }
  return result;
}

/**
 * Deeply redacts sensitive information from objects/arrays.
 */
export function redactSecretsDeep(obj: any, sensitiveKeys: string[] = DEFAULT_SENSITIVE_KEYS): any {
  if (!obj) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => redactSecretsDeep(item, sensitiveKeys));
  }
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  if (typeof obj === 'object') {
    const redacted: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const lowerKey = key.toLowerCase();
        const normalizedKey = lowerKey.replace(/[^a-z0-9]/g, '');
        // Skip helper flags like 'hasApiKey' or 'isConfigured' from redaction
        const isHelperFlag = key.startsWith('has') && key.length > 3 && key[3] === key[3].toUpperCase();
        const extraSensitiveKeywords = [
          'apikey', 'token', 'secret', 'password', 'credential', 
          'accesscode', 'licensekey', 'signingkey', 'privateconfig', 
          'privatekey', 'authcode', 'sessionkey', 'passphrase', 
          'cert', 'authorization', 'clienttoken', 'appcredential'
        ];
        const isSensitive = !isHelperFlag && (
          sensitiveKeys.some(sk => {
            const normSk = sk.toLowerCase().replace(/[^a-z0-9]/g, '');
            return normSk.length >= 3 && normalizedKey.includes(normSk);
          }) ||
          (lowerKey === 'key' && !('label' in obj || 'type' in obj || 'placeholder' in obj)) ||
          extraSensitiveKeywords.some(keyword => normalizedKey.includes(keyword))
        );
        
        if (isSensitive) {
          if (obj[key] === null || obj[key] === undefined) {
            redacted[key] = obj[key];
          } else if (typeof obj[key] === 'string' && obj[key].trim() === '') {
            redacted[key] = '';
          } else {
            redacted[key] = "[REDACTED]";
          }
          // Also add a 'has' flag for UI convenience
          const flagName = `has${key.charAt(0).toUpperCase()}${key.slice(1)}`;
          redacted[flagName] = !!obj[key];
        } else if (typeof obj[key] === 'object') {
          redacted[key] = redactSecretsDeep(obj[key], sensitiveKeys);
        } else if (typeof obj[key] === 'string') {
          redacted[key] = sanitizeString(obj[key]);
        } else {
          redacted[key] = obj[key];
        }
      }
    }
    return redacted;
  }
  return obj;
}
/**
 * Specifically cleans up admin error summaries.
 */
export function sanitizeAdminErrorSummary(rawError: string | any): string {
  if (!rawError) return '';
  let str = typeof rawError === 'string' ? rawError : String(rawError);
  
  str = sanitizeString(str);

  // Normalize whitespace
  str = str.replace(/\s+/g, ' ').trim();

  // Truncate linearly
  if (str.length > 150) {
    str = str.substring(0, 147) + '...';
  }

  return str;
}

/**
 * Specifically sanitizes an instance object for public API responses.
 * Ensures config_json is NOT returned in full, but as a safe summary.
 * Level 'list' returns lightweight summary, 'detail' returns more fields.
 */
export function sanitizeInstance(instance: any, mode: 'list' | 'detail' = 'detail'): any {
  if (!instance) return null;
  
  const sanitized = { ...instance };
  
  // High risk: config_json and env_config
  delete sanitized.config_json;
  delete sanitized.env_config;

  // For non-failed statuses, ensure deployment_error is strictly null
  if (sanitized.status !== 'failed') {
    sanitized.deployment_error = null;
  }
  
  // Redact secrets in other fields if any
  const final = redactSecretsDeep(sanitized);
  
  // Extract safe summary from config if needed by UI
  if (instance.config_json) {
    let config: any = {};
    try {
      config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : instance.config_json;
    } catch (e) {}
    
    const channel = config.channel || 'default';
    const isChannelFeishu = 
      channel === "feishu" || 
      channel === "lark" || 
      (Array.isArray(channel) && channel.some((ch: any) => ["feishu", "lark"].includes(String(ch).toLowerCase())));

    const hasFeishuSkill = 
      Array.isArray(config.skills) && 
      config.skills.some((s: string) => 
        ["feishu", "lark", "feishu_adapter", "lark_adapter"].includes(String(s).toLowerCase())
      );

    const isFeishu = !!(isChannelFeishu || hasFeishuSkill);

    // Safe parse base url for hostname
    let safeHostname = null;
    if (config.baseUrl) {
      try {
        safeHostname = new URL(config.baseUrl).hostname;
      } catch (e) {
        safeHostname = String(config.baseUrl);
      }
    }

    // Resolve base url via priority
    let rawBaseUrl = config.baseUrl || config.base_url || instance.model_base_url || instance.baseUrl || instance.base_url;
    let resolvedBaseUrl = "使用默认通道";
    let baseUrlStatus = "pass";
    let baseUrlIsValid = true;

    if (config.baseUrl !== undefined && config.baseUrl !== null && typeof config.baseUrl !== 'string' && typeof config.baseUrl !== 'boolean') {
      resolvedBaseUrl = "格式错误 (非 String!)";
      baseUrlStatus = "fail";
      baseUrlIsValid = false;
    } else {
      if (rawBaseUrl && typeof rawBaseUrl === 'string') {
        try {
          const urlObj = new URL(rawBaseUrl);
          resolvedBaseUrl = urlObj.origin + (urlObj.pathname === "/" ? "" : urlObj.pathname);
        } catch (e) {
          resolvedBaseUrl = rawBaseUrl;
        }
      } else if (config.provider) {
        const provKey = String(config.provider).toLowerCase();
        const regKey = provKey === "custom" ? "custom-openai-compatible" : provKey;
        const regProv = providerRegistry[regKey];
        if (regProv && regProv.defaultBaseUrl) {
          try {
            const urlObj = new URL(regProv.defaultBaseUrl);
            resolvedBaseUrl = urlObj.origin + (urlObj.pathname === "/" ? "" : urlObj.pathname);
          } catch (e) {
            resolvedBaseUrl = regProv.defaultBaseUrl;
          }
        }
      }
    }

    const isInjectedOrWritten = instance.model_config_status === 'injected' || instance.model_config_status === 'written';

    let resolvedLimitsCpu = config.limitsCpu;
    if (resolvedLimitsCpu === undefined || resolvedLimitsCpu === null || resolvedLimitsCpu === '') {
      resolvedLimitsCpu = instance.limitsCpu !== undefined && instance.limitsCpu !== null ? instance.limitsCpu : instance.limits_cpu;
    }
    if (resolvedLimitsCpu === undefined || resolvedLimitsCpu === null || resolvedLimitsCpu === '') {
      resolvedLimitsCpu = '0.5';
    } else {
      resolvedLimitsCpu = String(resolvedLimitsCpu);
    }

    let resolvedLimitsMem = config.limitsMem;
    if (resolvedLimitsMem === undefined || resolvedLimitsMem === null || resolvedLimitsMem === '') {
      const cMemMb = config.limitsMemoryMb;
      if (cMemMb !== undefined && cMemMb !== null && cMemMb !== '') {
        resolvedLimitsMem = `${cMemMb}MB`;
      }
    }
    if (resolvedLimitsMem === undefined || resolvedLimitsMem === null || resolvedLimitsMem === '') {
      resolvedLimitsMem = instance.limitsMemory !== undefined && instance.limitsMemory !== null ? instance.limitsMemory : instance.limits_memory;
    }
    if (resolvedLimitsMem === undefined || resolvedLimitsMem === null || resolvedLimitsMem === '') {
      const dbMemMb = instance.limitsMemoryMb !== undefined && instance.limitsMemoryMb !== null ? instance.limitsMemoryMb : instance.limits_memory_mb;
      if (dbMemMb !== undefined && dbMemMb !== null && dbMemMb !== '') {
        resolvedLimitsMem = `${dbMemMb}MB`;
      }
    }
    if (resolvedLimitsMem === undefined || resolvedLimitsMem === null || resolvedLimitsMem === '') {
      resolvedLimitsMem = '512MB';
    } else {
      resolvedLimitsMem = String(resolvedLimitsMem);
    }

    let resolvedLimitsMemoryMb = config.limitsMemoryMb;
    if (resolvedLimitsMemoryMb === undefined || resolvedLimitsMemoryMb === null || resolvedLimitsMemoryMb === '') {
      resolvedLimitsMemoryMb = instance.limitsMemoryMb !== undefined && instance.limitsMemoryMb !== null ? instance.limitsMemoryMb : instance.limits_memory_mb;
    }
    if (resolvedLimitsMemoryMb === undefined || resolvedLimitsMemoryMb === null || resolvedLimitsMemoryMb === '') {
      const match = String(resolvedLimitsMem).match(/^(\d+)(MB|GB|M|G)?/i);
      if (match) {
        let val = parseInt(match[1], 10);
        const unit = (match[2] || '').toLowerCase();
        if (unit.startsWith('g')) {
          val = val * 1024;
        }
        resolvedLimitsMemoryMb = val;
      } else {
        resolvedLimitsMemoryMb = 512;
      }
    } else {
      resolvedLimitsMemoryMb = parseInt(String(resolvedLimitsMemoryMb), 10) || 512;
    }

    // Provide safe fields that the UI needs (Common for both modes)
    const dashboardEnabled = config.enableDashboard !== false;
    const hasDashboardPassword = dashboardEnabled && !!(config.password || config.webPasswordHash);
    const summary: any = {
      provider: config.provider || null,
      model: config.model || null,
      providerCredentialId: config.providerCredentialId || null,
      baseUrl: (config.baseUrl || config.base_url || instance.model_base_url || instance.baseUrl || instance.base_url) ? resolvedBaseUrl : null,
      baseUrlHost: safeHostname,
      enableDashboard: dashboardEnabled,
      authMode: !dashboardEnabled ? "disabled" : hasDashboardPassword ? "basic_auth" : "public",
      hasPassword: hasDashboardPassword,
      accessProtectionLabel: !dashboardEnabled ? "Dashboard 访问已关闭" : hasDashboardPassword ? "Dashboard 密码保护已启用" : "公开无密码",
      limitsCpu: resolvedLimitsCpu,
      limitsMem: resolvedLimitsMem,
      limitsMemoryMb: resolvedLimitsMemoryMb,
      
      // Channel info (TYPE ONLY)
      configuredChannels: config.channel ? [config.channel.toLowerCase()] : [],
      channelLabel: (config.channel || '本地终端').toUpperCase(),
      
      allowMode: config.allowMode || (config.gatewayAllowAllUsers ? 'allow_all' : 'bind_later'),
      templateName: config.templateName || null,
      storageExceeded: !!config.storageExceeded,
      skills: config.skills || [],
      
      // CONFIG CHECKS (Safe summary for status panel)
      configChecks: {
        provider: {
          value: config.provider || "N/A",
          status: (isInjectedOrWritten || config.provider) ? "pass" : "fail",
          type: "string",
          isValid: isInjectedOrWritten || typeof config.provider === 'string'
        },
        model: {
          value: config.model || "N/A",
          status: (isInjectedOrWritten || config.model) ? "pass" : "fail",
          type: "string",
          isValid: isInjectedOrWritten || typeof config.model === 'string'
        },
        baseUrl: {
          value: resolvedBaseUrl,
          status: (isInjectedOrWritten || baseUrlIsValid) ? "pass" : "fail",
          type: "string",
          isValid: isInjectedOrWritten || baseUrlIsValid
        },
        providerApiKey: {
          configured: !!(isInjectedOrWritten || config.providerApiKey || config.apiKey),
          label: (isInjectedOrWritten || config.providerApiKey || config.apiKey) ? "密钥已配置" : "未配置",
          status: (isInjectedOrWritten || config.providerApiKey || config.apiKey) ? "pass" : "fail",
          type: "secret"
        }
      }
    };

    if (mode === 'list') {
      // Lightweight list: only return preview of prompt
      if (config.agentPrompt) {
        // Redact secrets in prompt before previewing
        const redactedPrompt = sanitizeString(config.agentPrompt);
        summary.agentPromptPreview = redactedPrompt.substring(0, 100) + (redactedPrompt.length > 100 ? '...' : '');
      }
    } else {
      // Detailed view: return full non-sensitive configs
      summary.agentPrompt = sanitizeString(config.agentPrompt || '');
      summary.channel = config.channel || 'default';
      
      // Additional non-sensitive fields
      summary.telegramAllowedUsers = config.telegramAllowedUsers || '';
      summary.discordAllowedGuilds = config.discordAllowedGuilds || '';
      if (isFeishu) {
        summary.feishuAppId = config.feishuAppId || '';
        summary.feishuRegion = config.feishuRegion || 'feishu';
      }
      summary.qqBotAppId = config.qqBotAppId || '';
      summary.qqBotAllowedUsers = config.qqBotAllowedUsers || '';
      summary.qqBotAllowedGuilds = config.qqBotAllowedGuilds || '';
      summary.qqBotAllowedChannels = config.qqBotAllowedChannels || '';
      summary.whatsappPhoneNumberId = config.whatsappPhoneNumberId || '';
      summary.whatsappAllowedUsers = config.whatsappAllowedUsers || '';
      summary.whatsappAllowedChannels = config.whatsappAllowedChannels || '';
      summary.dingtalkAppKey = config.dingtalkAppKey || '';
      summary.dingtalkAllowedUsers = config.dingtalkAllowedUsers || '';
      summary.dingtalkAllowedChats = config.dingtalkAllowedChats || '';
      summary.wechatMpAppId = config.wechatMpAppId || '';
      summary.wechatMpAllowedUsers = config.wechatMpAllowedUsers || '';
      summary.wechatMpAllowedChats = config.wechatMpAllowedChats || '';
      summary.wecomAppId = config.wecomAppId || '';
      summary.wecomAgentId = config.wecomAgentId || '';
      summary.wecomAllowedUsers = config.wecomAllowedUsers || '';
      summary.wecomAllowedChats = config.wecomAllowedChats || '';
      
      // Webhook URL is strictly restricted to origin only if present
      if (config.webhookUrl) {
        try {
          const url = new URL(config.webhookUrl);
          summary.webhookUrl = url.origin + " (TOKEN REDACTED)";
        } catch (e) {
          summary.webhookUrl = "URL CONFIGURED";
        }
      }
    }

    final.configSummary = summary;
  }
  
  return final;
}

/**
 * Sanitizes config object for safe client consumption (e.g. during update responses)
 */
export function sanitizeConfig(config: any): any {
  if (!config) return null;
  return redactSecretsDeep(config);
}

/**
 * Checks if a given string value is a masked/redacted secret placeholder
 * rather than a real key/token. Used to prevent placeholder pollution.
 */
export function isMaskedSecretPlaceholder(value: any): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (
    lower === '[redacted]' || 
    lower === '[masked]' || 
    lower === 'redacted' || 
    lower === 'masked' || 
    lower === 'placeholder' ||
    lower === 'null' ||
    lower === 'undefined'
  ) {
    return true;
  }

  // Check if string consists only of masking characters: *, •, ●, ·, -, space
  if (/^[•\*●·\- ]+$/g.test(trimmed)) {
    if (trimmed.length >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitizes system/Docker/path error messages to avoid leaking absolute host paths,
 * internal container names, or raw docker socket details.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return "";
  let msg = message;

  // 1. Redact Windows absolute paths (for example, drive-letter user/project paths)
  msg = msg.replace(/[a-zA-Z]:\\[a-zA-Z0-9_.-]+(?:\\[a-zA-Z0-9_.-]+)*/g, "[PATH]");

  // 2. Redact Linux absolute paths (e.g. /var/run/docker.sock, /www/wwwroot/...)
  msg = msg.replace(/\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+/g, "[PATH]");

  // 3. Redact internal container names (e.g. mybay-agent-instanceId)
  msg = msg.replace(/mybay-agent-[a-zA-Z0-9_-]+/g, "[CONTAINER]");

  // 4. Redact docker socket reference
  msg = msg.replace(/docker\.sock/gi, "docker daemon");
  msg = msg.replace(/dockerode/gi, "docker engine");

  // 5. Clean up duplicate or trailing separators
  msg = msg.replace(/\[PATH\](?:\\|\/)+/g, "[PATH]");

  return msg;
}

/**
 * Interface representing a safe, sanitized credential returned to the frontend.
 * This ensures absolute API key confidentiality by never leaking raw key/token.
 */
export interface CredentialClientModel {
  id: string;
  name: string;
  type: string;
  provider: string;       // Backward compatibility / old consumers expecting .provider
  key: string;            // Secure masked placeholder ("••••••••••••••••")
  baseUrl: string;        // Uniform camelCase representation
  base_url: string;       // Uniform snake_case representation for backward compatibility
  isCustom: boolean;      // Uniform boolean camelCase representation
  is_custom: boolean;     // Uniform boolean snake_case representation for backward compatibility
  createdAt: string;      // Uniform ISO string representation
  created_at: string;     // Uniform ISO string representation for backward compatibility
  owner_id: string;       // Owner user ID representation
  user_id: string;        // Backward compatible user ID representation
  hasSecret: boolean;     // Semantic check indicating secret presence
  secretLabel: string;    // Uniform secure label
  verificationStatus: "untested" | "verified" | "failed";
  verifiedAt: string | null;
}

/**
 * Architectural Presenter / Serializer:
 * Maps an internal database/repository credential object (which contains the decrypted key)
 * into a safe, client-facing standard model to prevent data leakage.
 * 
 * Supporting both singular objects and lists of credentials.
 */
export function sanitizeCredentialsForClient(input: any): any {
  if (!input) return input;
  
  const sanitizeSingle = (cred: any): CredentialClientModel | null => {
    if (!cred) return null;
    
    // Extract base properties with safe fallbacks
    const id = String(cred.id || "");
    const name = String(cred.name || "");
    const type = String(cred.type || "");
    
    const baseUrl = String(cred.baseUrl || cred.base_url || "");
    const isCustom = cred.isCustom !== undefined ? !!cred.isCustom : !!cred.is_custom;
    
    const createdAt = cred.createdAt || cred.created_at || new Date().toISOString();
    const ownerId = String(cred.owner_id || cred.user_id || "");
    
    return {
      id,
      name,
      type,
      provider: type, // Backward compatibility / old consumers expecting .provider
      key: "••••••••••••••••", // Never return raw decypted value or decryptedKey
      baseUrl,
      base_url: baseUrl,
      isCustom,
      is_custom: isCustom,
      createdAt,
      created_at: createdAt,
      owner_id: ownerId,
      user_id: ownerId,
      hasSecret: true,
      secretLabel: "••••••••••••••••",
      verificationStatus: cred.verification_status || "untested",
      verifiedAt: cred.verified_at || null
    };
  };

  if (Array.isArray(input)) {
    return input.map(sanitizeSingle).filter(Boolean);
  }
  return sanitizeSingle(input);
}


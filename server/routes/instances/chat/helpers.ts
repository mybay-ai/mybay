import rateLimit from "express-rate-limit";
import { getClientIp } from "../../../utils/ip";
import { dbAdapter } from "../../../db";
import { resolveProviderRegistryKey } from "../../../../shared/providerRegistryUtils";
import { providerRegistry } from "../../../../shared/providerRegistry";
import { isMaskedSecretPlaceholder } from "../../../utils/sanitizer";
import { decrypt, encrypt } from "../../../crypto";
import {
  normalizeCodexAccountAuth,
  readCodexRuntimeAccountAuth,
  writeCodexRuntimeAccountAuth,
} from "../../../runtime/adapters/codex/CodexRuntimeEnvironment";
import { resolveStoredCredentialApiKey } from "../../../utils/savedProviderCredential";

function isCodexChatGptAccountMode(instance: any, config: any): boolean {
  return String(instance?.runtime_type || instance?.runtimeType || "").toLowerCase() === "codex"
    && String(config?.codexAuthMode || "chatgpt").toLowerCase() === "chatgpt";
}
export function normalizeChatTemperature(provider: string, model: string, temperature?: number): number | undefined {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();
  if ((p === "moonshot" || p === "kimi") && m.startsWith("kimi-")) {
    return 1;
  }
  return typeof temperature === "number" ? temperature : undefined;
}

export type ChatReasoningEffort = "fast" | "balanced" | "deep";

export function normalizeReasoningEffort(value: any): ChatReasoningEffort {
  const incoming = String(value || "").toLowerCase().trim();
  if (incoming === "fast" || incoming === "balanced" || incoming === "deep") return incoming;
  return "balanced";
}

export function getReasoningInstruction(effort: ChatReasoningEffort): string {
  if (effort === "fast") {
    return "Reasoning mode: fast. Keep the answer concise and avoid unnecessary exploration.";
  }
  if (effort === "deep") {
    return "Reasoning mode: deep. Analyze carefully, cover important edge cases, and provide a more complete answer when useful.";
  }
  return "Reasoning mode: balanced. Balance response speed with answer quality.";
}

export function getDefaultMaxTokensForReasoning(effort: ChatReasoningEffort, fallback: number): number {
  if (effort === "fast") return Math.min(fallback, 512);
  if (effort === "deep") return Math.max(fallback, 1536);
  return fallback;
}

export function isChatTurnRpcSchemaError(message: string): boolean {
  const m = String(message || "").toLowerCase();
  return (
    (m.includes("begin_chat_turn") || m.includes("finish_chat_turn")) &&
    (
      m.includes("schema cache") ||
      m.includes("could not find the function") ||
      m.includes("function") && m.includes("does not exist") ||
      m.includes("p_metadata") ||
      m.includes("p_new_session_id")
    )
  );
}

export function extractSafeErrorMessage(err: any): string {
  if (!err) return "Unknown Error";
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;
  const candidates = [
    err.message,
    err.error_description,
    err.details,
    err.hint,
    err.code,
    err.error
  ];
  const message = candidates.find((item) => typeof item === "string" && item.trim());
  if (message) return message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function buildAssistContext(
  skillId: string,
  instance: any,
  config: any,
  conversation: any,
  history: any[],
  latestFailure?: any | null
): Promise<string> {
  const isCodexAccountMode = isCodexChatGptAccountMode(instance, config);
  const rawProvider = isCodexAccountMode
    ? "openai-codex"
    : config.provider || config.model_provider || instance.model_provider || "gemini";
  const provider = resolveProviderRegistryKey(
    rawProvider,
    config.model || instance.model_name,
    config.baseUrl || config.base_url || config.model_base_url || instance.model_base_url
  );
  const providerConf = providerRegistry[provider];
  const model = config.model || config.current_model || config.MODEL || instance.model_name || providerConf?.defaultModel || "unknown";
  let baseUrlHost = "unknown";
  const resolvedBaseUrl = config.baseUrl || config.base_url || config.model_base_url || instance.model_base_url || providerConf?.defaultBaseUrl;
  if (resolvedBaseUrl) {
    try {
      let urlStr = resolvedBaseUrl;
      if (!urlStr.includes("://")) {
        urlStr = "https://" + urlStr;
      }
      const urlObj = new URL(urlStr);
      baseUrlHost = urlObj.hostname;
    } catch (err) {}
  }

  const hasModelCredential = !!(config.providerApiKey || config.apiKey || config.providerCredentialId || config.codexAuthJson);
  const authentication = isCodexAccountMode ? "ChatGPT OAuth" : "API Key / 已保存凭据";
  const status = instance.status || "unknown";
  const channels = config.channel || instance.configSummary?.channel || [];

  if (skillId === "model_config_diagnosis") {
    return `你是一位资深全栈工程师、安全审计顾问和 SaaS 架构顾问。正在进行 model_config_diagnosis (模型配置诊断)。
以下是当前实例模型配置只读数据：
- 供应商 (Provider): ${provider}
- 模型 (Model): ${model}
- 基础 API 地址 (BaseUrl Host): ${baseUrlHost}
- 认证方式 (Authentication): ${authentication}
- 是否配置了模型凭据 (HasModelCredential): ${hasModelCredential}
- 实例当前运行状态 (Instance Status): ${status}
- 启用的通讯渠道 (Channels): ${JSON.stringify(channels)}

请在诊断报告中用中文提供以下内容：
1. 配置分析和摘要：说明当前配置的健康状况，以及所用服务商的默认特性。
2. 潜在安全或连通风险：评估是否存在不安全的 API 域名、或者是否可能因未提供 API 密钥而导致无法连接。
3. 推荐的排查和修复步骤：一步步指导用户解决配置问题。`;
  }

  if (skillId === "explain_last_error") {
    // Find the last failed or errored message in the current conversation
    const failedMsg = latestFailure || [...history].reverse().find(h => h.status === 'failed' || h.error_code);
    const lastErrorCode = failedMsg?.error_code || "未知";
    const knownErrorMessages: Record<string, string> = {
      API_KEY_MISSING: "控制平面在该次直接回答请求中没有解析到可用的 API Key。",
      CODEX_AUTH_REQUIRED: "该次请求未获得有效的 Codex ChatGPT OAuth 凭据，需要重新授权。",
      MODEL_CONFIG_MISSING: "该次请求缺少可用的模型或模型服务商配置。",
      DIRECT_MODEL_CHAT_FAILED: "该次直接模型调用失败；上游错误详情未持久化时应以错误码和当前配置为准。"
    };
    const lastErrorMessage = failedMsg?.content || knownErrorMessages[lastErrorCode] || "错误详情未持久化，请以错误码为准。";

    return `你是一位资深全栈工程师和系统诊断专家。正在进行 explain_last_error (解释上一次聊天错误)。
以下是上下文信息：
- 最近失败消息的错误码 (Error Code): ${lastErrorCode}
- 错误细节/供应商返回 (Error Message): ${lastErrorMessage}
- 供应商 (Provider): ${provider}
- 模型 (Model): ${model}
- 基础 API 地址 (BaseUrl Host): ${baseUrlHost}
- 认证方式 (Authentication): ${authentication}
- 当前是否配置模型凭据 (HasModelCredential): ${hasModelCredential}
- 实例运行状态 (Instance Status): ${status}

请在诊断报告中用中文解答以下内容：
1. 错误含义解释：用通俗易懂的语言解释该错误的底层技术原因。
2. 检查指南：指导用户如何检查自己的服务商余额、配置参数或网络环境。
3. 建议与下一步行动：提供具体、可操作的解决方案，让用户能够尽快恢复正常对话。`;
  }

  if (skillId === "instance_health_summary") {
    return `你是一位资深全栈工程师和容器运维专家。正在进行 instance_health_summary (实例健康摘要诊断)。
以下是只读环境状态：
- 实例当前运行状态 (Instance Status): ${status}
- 容器名称 (Container Name): ${instance.container_name || "unknown"}
- 启用的通讯渠道 (Channels): ${JSON.stringify(channels)}
- 供应商 (Provider): ${provider}
- 模型 (Model): ${model}
- 基础 API 地址 (BaseUrl Host): ${baseUrlHost}

请在诊断报告中用中文提供以下内容：
1. 实例健康等级评估：判断系统是否正常运作，各渠道连接和容器运行情况。
2. 任何需要注意的运维隐患：例如配置为空，渠道可能无响应等。
3. 推荐的运维操作或优化建议。`;
  }

  if (skillId === "summarize_conversation") {
    const chatLog = history.slice(-10).map(h => `${h.role === 'assistant' ? 'AI' : 'User'}: ${h.content}`).join("\n");
    return `你是一位高效、专业的助理。正在进行 summarize_conversation (会话摘要总结)。
以下是当前会话最近消息：
${chatLog || "（无最近对话历史）"}

请在诊断报告中用中文提供以下内容：
1. 简要的会话摘要（不超过 200 字），提炼出当前交流的核心主题。
2. 列出清晰的待办事项 (Action Items) 或后续跟进建议。`;
  }

  return "";
}

export async function resolveQuickChatModelConfig(
  instance: any,
  config: any,
  reqBodyModel?: string,
  userId?: string
) {
  const isCodexAccountMode = isCodexChatGptAccountMode(instance, config);

  // 1. Resolve Provider
  const rawProvider = isCodexAccountMode
    ? "openai-codex"
    : config.provider || config.model_provider || instance.model_provider;
  if (!rawProvider) {
    throw {
      status: 424,
      error: "MODEL_CONFIG_MISSING",
      message: "该实例缺少快速对话所需的模型服务商配置。"
    };
  }

  const canonicalProvider = resolveProviderRegistryKey(
    rawProvider,
    reqBodyModel || config.model || instance.model_name,
    config.baseUrl || config.model_base_url || instance.model_base_url
  );

  const providerConf = providerRegistry[canonicalProvider];

  // 2. Resolve Model
  const model = reqBodyModel || config.model || config.current_model || config.MODEL || instance.model_name || (providerConf ? providerConf.defaultModel : "");
  if (!model) {
    throw {
      status: 424,
      error: "MODEL_CONFIG_MISSING",
      message: "该实例缺少快速对话所需的模型 (model) 配置。"
    };
  }

  // 3. Resolve Base URL
  let baseUrl = config.baseUrl || config.base_url || config.model_base_url || instance.model_base_url;
  if (!baseUrl && providerConf) {
    baseUrl = providerConf.defaultBaseUrl;
  }

  // 4. Resolve Provider API Key
  const credentialId = typeof config.providerCredentialId === "string" ? config.providerCredentialId.trim() : "";
  let codexCredentialPayload = "";
  if (isCodexAccountMode && instance?.id) {
    codexCredentialPayload = readCodexRuntimeAccountAuth(String(instance.id)) || "";
  }
  if (isCodexAccountMode && !codexCredentialPayload && credentialId && userId) {
    try {
      const credential = await dbAdapter.getCredentialById(credentialId, userId);
      if (credential?.type === "openai-codex") {
        codexCredentialPayload = resolveStoredCredentialApiKey(credential.key || credential.encrypted_value || credential.key_encrypted);
      }
    } catch (error) {
      console.warn("[resolveQuickChatModelConfig] Failed to load Codex OAuth credential:", error instanceof Error ? error.message : "unknown");
    }
  }
  const rawKey = isCodexAccountMode ? codexCredentialPayload || config.codexAuthJson : config.providerApiKey || config.apiKey;
  let providerApiKey = "";

  if (rawKey && !isMaskedSecretPlaceholder(rawKey)) {
    try {
      providerApiKey = decrypt(rawKey);
    } catch (e) {
      providerApiKey = rawKey;
    }
  }

  if (isCodexAccountMode) {
    try {
      providerApiKey = normalizeCodexAccountAuth(providerApiKey);
    } catch {
      throw {
        status: 401,
        error: "CODEX_AUTH_REQUIRED",
        message: "当前 Codex 实例需要重新连接 OpenAI OAuth，完成授权后再使用直接回答。"
      };
    }
  }

  // Try loading from credential if key is missing or is a masked placeholder
  if (!isCodexAccountMode && (!providerApiKey || isMaskedSecretPlaceholder(providerApiKey)) && config.providerCredentialId && userId) {
    try {
      const cred = await dbAdapter.getCredentialById(config.providerCredentialId, userId);
      if (cred && cred.key && !isMaskedSecretPlaceholder(cred.key)) {
        providerApiKey = cred.key;
      }
    } catch (e) {
      console.warn("[resolveQuickChatModelConfig] Failed to fetch credential by ID:", e);
    }
  }

  // Fallback to platform environment variables
  if (!isCodexAccountMode && (!providerApiKey || isMaskedSecretPlaceholder(providerApiKey))) {
    if (canonicalProvider === "gemini") {
      providerApiKey = process.env.GEMINI_API_KEY || "";
    } else if (canonicalProvider === "openai") {
      providerApiKey = process.env.OPENAI_API_KEY || "";
    } else {
      if (providerConf?.envPrefix) {
        providerApiKey = process.env[`${providerConf.envPrefix}_API_KEY`] || "";
      }
    }
  }

  if (!providerApiKey || isMaskedSecretPlaceholder(providerApiKey)) {
    throw {
      status: isCodexAccountMode ? 401 : 424,
      error: isCodexAccountMode ? "CODEX_AUTH_REQUIRED" : "API_KEY_MISSING",
      message: isCodexAccountMode
        ? "当前 Codex 实例需要重新连接 OpenAI OAuth，完成授权后再使用直接回答。"
        : `无法获取服务商 "${canonicalProvider}" 的 API 密钥。由于后端无权直接读取容器内局部 .env，请在麦贝控制台的实例设置或平台凭证中心重新配置该供应商的 API 密钥。`
    };
  }

  const onOAuthRefresh = isCodexAccountMode && instance?.id && userId
    ? async (refreshedPayload: Record<string, unknown>) => {
      const normalizedAuth = normalizeCodexAccountAuth(JSON.stringify(refreshedPayload));
      const latestInstance: any = await dbAdapter.getInstanceById(String(instance.id));
      if (!latestInstance) throw new Error("CODEX_OAUTH_PERSIST_INSTANCE_MISSING");
      const latestConfig = typeof latestInstance.config_json === "string"
        ? JSON.parse(latestInstance.config_json || "{}")
        : { ...(latestInstance.config_json || {}) };
      if (String(latestInstance.runtime_type || "").toLowerCase() !== "codex" || String(latestConfig.codexAuthMode || "chatgpt").toLowerCase() !== "chatgpt") {
        throw new Error("CODEX_OAUTH_PERSIST_MODE_CHANGED");
      }
      latestConfig.codexAuthJson = encrypt(normalizedAuth);
      latestConfig.provider = "openai";
      latestConfig.codexAuthMode = "chatgpt";
      if (credentialId) latestConfig.providerCredentialId = credentialId;
      writeCodexRuntimeAccountAuth(String(instance.id), normalizedAuth);
      await dbAdapter.updateInstanceConfig(String(instance.id), JSON.stringify(latestConfig));
      if (credentialId) {
        const auth = JSON.parse(normalizedAuth);
        await dbAdapter.updateCredential(credentialId, userId, {
          key: encrypt(JSON.stringify({
            version: 1,
            provider: "openai-codex",
            auth_type: "oauth_external",
            credential_pool: "openai-codex",
            base_url: "https://chatgpt.com/backend-api/codex",
            ...auth,
          })),
          verification_status: "verified",
          verified_at: new Date().toISOString(),
        });
      }
    }
    : undefined;

  return {
    provider: canonicalProvider,
    model,
    baseUrl,
    providerApiKey,
    ...(onOAuthRefresh ? { onOAuthRefresh } : {}),
  };
}

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Max 20 requests per minute
  keyGenerator: (req: any) => `chat_workspace:ip:${getClientIp(req)}:user:${req.user?.id || 'anon'}`,
  message: {
    success: false,
    error: "RATE_LIMIT_EXCEEDED",
    message: "对话请求过于频繁，每分钟最多发送 20 条消息，请稍后再试。"
  }
});

export function getSingleHeader(val: string | string[] | undefined): string | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] : val;
}

export function isValidUUID(val: any): boolean {
  if (typeof val !== "string") return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val);
}

export function isValidInstanceId(val: any): boolean {
  if (typeof val !== "string") return false;
  return /^[A-Za-z0-9-]{1,128}$/.test(val);
}


export interface StandardErrorResponse {
  success: false;
  error: string;
  message: string;
  diagnostics?: {
    statusCode?: number;
    durationMs?: number;
    errorCode?: string;
  };
}

export const WHITE_LISTED_ERRORS = [
  "INTERNAL_ROUTING_SECRET_MISSING",
  "INTERNAL_ROUTE_NOT_FOUND",
  "INTERNAL_ROUTE_AUTH_FAILED",
  "INTERNAL_ROUTE_TIMEOUT",
  "INTERNAL_ROUTE_CONNECT_FAILED",
  "HERMES_API_AUTH_FAILED",
  "HERMES_API_NOT_READY",
  "INVALID_HERMES_RESPONSE",
  "INTERNAL_RESPONSE_TOO_LARGE",
  "CHAT_UPSTREAM_ERROR"
] as const;

export type WhitelistedErrorCode = typeof WHITE_LISTED_ERRORS[number];

export const CHAT_ERROR_MESSAGES: Record<WhitelistedErrorCode, string> = {
  INTERNAL_ROUTING_SECRET_MISSING: "安全配置还原异常，内部路由不可用。",
  INTERNAL_ROUTE_NOT_FOUND: "工作台内部路由暂不可用。",
  INTERNAL_ROUTE_AUTH_FAILED: "内部网关路由访问被拒绝。",
  INTERNAL_ROUTE_TIMEOUT: "Agent 响应超时，请检查模型服务或重试。",
  INTERNAL_ROUTE_CONNECT_FAILED: "连接实例内部 8642 对话端口失败，请检查容器状态。",
  HERMES_API_AUTH_FAILED: "实例 API 鉴权失败，请检查 API Key 配置。",
  HERMES_API_NOT_READY: "Agent 尚未就绪，可能正在加载模型服务。",
  INVALID_HERMES_RESPONSE: "实例 API 返回了非预期的响应格式。",
  INTERNAL_RESPONSE_TOO_LARGE: "Agent 响应内容过大，已触发安全截断保护。",
  CHAT_UPSTREAM_ERROR: "对话服务暂时不可用，请稍后再试。"
};

export function sanitizeLog(text: string): string {
  if (!text) return "";
  let cleaned = text;
  // Mask Bearer tokens
  cleaned = cleaned.replace(/Bearer\s+[a-zA-Z0-9\-_\.\~]+/gi, "Bearer ****");
  // Mask key-value patterns (JSON or headers) containing keys, tokens, secrets, authorizations, passwords
  cleaned = cleaned.replace(/(authorization|api[-_]?key|hermes[-_]?api[-_]?key|chat[-_]?api[-_]?key|key|token|secret|password|passwd)\s*[:=]\s*["']?[a-zA-Z0-9\-_\.\~\$]+["']?/gi, "$1: ****");
  // Mask raw OpenAI/DeepSeek keys
  cleaned = cleaned.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-****masked");
  return cleaned;
}

export function mapChatError(
  response: {
    statusCode?: number;
    error?: unknown;
    json?: any;
    durationMs?: number;
  }
): StandardErrorResponse {
  const status = typeof response.statusCode === "number" ? response.statusCode : 500;
  
  // 1. Safe resolve string error identifier
  let rawErrStr = "";
  if (typeof response.error === "string") {
    rawErrStr = response.error;
  }

  // 2. Resolve upstream error code if present
  let upstreamCode = "";
  if (response.json && response.json.error) {
    const rawUpstreamCode = response.json.error.code || response.json.error;
    if (typeof rawUpstreamCode === "string") {
      upstreamCode = rawUpstreamCode;
    }
  }

  // 3. Normalise connection errors
  const connectionErrors = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "INTERNAL_ROUTE_CONNECT_FAILED"];
  if (connectionErrors.includes(rawErrStr) || connectionErrors.includes(upstreamCode)) {
    rawErrStr = "INTERNAL_ROUTE_CONNECT_FAILED";
  }

  let errCode: WhitelistedErrorCode = "CHAT_UPSTREAM_ERROR";

  // 4. Primary: mapping based on standardized error code
  if (rawErrStr === "INTERNAL_ROUTING_SECRET_MISSING") {
    errCode = "INTERNAL_ROUTING_SECRET_MISSING";
  } else if (rawErrStr === "ETIMEDOUT" || rawErrStr === "INTERNAL_ROUTE_TIMEOUT") {
    errCode = "INTERNAL_ROUTE_TIMEOUT";
  } else if (rawErrStr === "INTERNAL_ROUTE_CONNECT_FAILED") {
    errCode = "INTERNAL_ROUTE_CONNECT_FAILED";
  } else if (rawErrStr === "INTERNAL_RESPONSE_TOO_LARGE") {
    errCode = "INTERNAL_RESPONSE_TOO_LARGE";
  } else if (rawErrStr === "INVALID_TRAEFIK_INTERNAL_URL") {
    errCode = "CHAT_UPSTREAM_ERROR";
  } else if (rawErrStr === "INVALID_HERMES_RESPONSE") {
    errCode = "INVALID_HERMES_RESPONSE";
  } else {
    // Secondary: mapping based on HTTP status code (if standard error code didn't match)
    if (status === 404) {
      errCode = "INTERNAL_ROUTE_NOT_FOUND";
    } else if (status === 401) {
      errCode = "HERMES_API_AUTH_FAILED";
    } else if (status === 403) {
      errCode = "INTERNAL_ROUTE_AUTH_FAILED";
    } else if (status === 502 || status === 503 || status === 504) {
      errCode = "HERMES_API_NOT_READY";
    }
  }

  // Tertiary: check if upstream error code matches whitelist
  if (upstreamCode && WHITE_LISTED_ERRORS.includes(upstreamCode as any)) {
    errCode = upstreamCode as WhitelistedErrorCode;
  }

  const finalMsg = CHAT_ERROR_MESSAGES[errCode];

  return {
    success: false,
    error: errCode,
    message: finalMsg,
    diagnostics: {
      statusCode: status,
      durationMs: response.durationMs,
      errorCode: errCode
    }
  };
}

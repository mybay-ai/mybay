function parseInstanceConfigJson(instance: any): any {
  const raw = instance?.config_json;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function getInstanceModelFingerprint(instance: any): string {
  const config = parseInstanceConfigJson(instance);
  return [
    instance?.model_provider,
    instance?.model_name,
    instance?.model_base_url,
    instance?.provider,
    instance?.model,
    instance?.current_provider,
    instance?.current_model,
    instance?.base_url,
    instance?.BASE_URL,
    config.provider,
    config.model_provider,
    config.modelProvider,
    config.current_provider,
    config.currentProvider,
    config.model,
    config.model_name,
    config.modelName,
    config.current_model,
    config.currentModel,
    config.MODEL,
    config.base_url,
    config.baseUrl,
    config.BASE_URL
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function shouldPreferNonStreamingChatForInstance(instance: any): boolean {
  // Agent mode must prefer Hermes Runs so tool calls are executed by Hermes instead of
  // being surfaced as raw model protocol text. Keep the legacy chat-completions
  // fallback opt-in only for emergency provider incidents.
  if (process.env.MYBAY_FORCE_AGENT_CHAT_COMPLETIONS_FALLBACK !== "true") {
    return false;
  }

  const fingerprint = getInstanceModelFingerprint(instance);
  return (
    fingerprint.includes("moonshot") ||
    fingerprint.includes("kimi") ||
    fingerprint.includes("api.moonshot.cn")
  );
}

export function isStreamingDecoderCompatError(rawError: unknown): boolean {
  const code = extractUpstreamErrorCode(rawError);
  if ([
    "STREAMING_DECODER_ERROR",
    "STREAM_DECODER_ERROR",
    "BROTLI_DECODER_ERROR",
    "CONTENT_DECODING_ERROR",
    "ERR_CONTENT_DECODING_FAILED",
    "CAN_ACCEPT_MORE_DATA"
  ].includes(code)) {
    return true;
  }

  const text = JSON.stringify(rawError || "").toLowerCase();
  return (
    text.includes("brotli") && text.includes("can_accept_more_data") ||
    text.includes("streaming failed before delivery") ||
    text.includes("content decoding failed")
  );
}

export function extractAssistantContentFromChatResponse(json: any): string {
  const choice = Array.isArray(json?.choices) ? json.choices[0] : undefined;
  const content = choice?.message?.content ?? choice?.delta?.content ?? json?.message ?? json?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function buildHermesChatMessages(messages: Array<{ role: string; content: string }>) {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content
  }));
}
export function extractHermesSessionId(json: any): string | null {
  const candidates = [
    json?.session_id,
    json?.sessionId,
    json?.id,
    json?.session?.id,
    json?.data?.session_id,
    json?.data?.id
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function buildFallbackHermesSessionId(conversationId: string): string {
  const normalizedConversationId = String(conversationId || "").replace(/[^A-Za-z0-9]/g, "");
  return `mybay_${normalizedConversationId.slice(0, 80)}`;
}

export function isLegacyGeneratedSessionId(sessionId: string | null | undefined, conversationId: string): boolean {
  if (!sessionId) return true;
  const normalizedConversationId = String(conversationId || "").replace(/[^A-Za-z0-9]/g, "");
  return sessionId === `conv_${normalizedConversationId}` || /^conv_[A-Za-z0-9]{24,64}$/.test(sessionId);
}

export function isFallbackHermesSessionId(sessionId: string | null | undefined, conversationId: string): boolean {
  if (!sessionId || !conversationId) return false;
  const expectedFallbackId = buildFallbackHermesSessionId(conversationId);
  return sessionId === expectedFallbackId;
}

function parsePotentialJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function extractUpstreamErrorCode(rawError: unknown): string {
  const visited = new Set<unknown>();
  const directKeys = ["errorCode", "error_code", "code"];

  const visit = (value: unknown, depth: number): string => {
    if (value === null || value === undefined || depth > 8) return "";

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        const parsed = parsePotentialJsonString(trimmed);
        if (parsed !== value) {
          const parsedCode = visit(parsed, depth + 1);
          if (parsedCode) return parsedCode;
        }
      }
      return trimmed.toUpperCase();
    }

    if (typeof value !== "object") return String(value).trim().toUpperCase();
    if (visited.has(value)) return "";
    visited.add(value);

    const obj = value as Record<string, unknown>;
    for (const key of directKeys) {
      const candidate = obj[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim().toUpperCase();
    }

    for (const key of ["error", "detail"]) {
      const nestedCode = visit(obj[key], depth + 1);
      if (nestedCode) return nestedCode;
    }

    const message = obj.message;
    if (typeof message === "string" && message.trim()) return message.trim().toUpperCase();

    for (const nested of Object.values(obj)) {
      const nestedCode = visit(nested, depth + 1);
      if (nestedCode) return nestedCode;
    }

    return "";
  };

  return visit(rawError, 0);
}

export function shouldFallbackSessionCreate(statusCode: number, rawError?: unknown): boolean {
  if (statusCode === 404 || statusCode === 405 || statusCode === 501) return true;

  const errorText = extractUpstreamErrorCode(rawError);
  const explicitUnsupportedCodes = [
    "UNSUPPORTED_PATH",
    "METHOD_NOT_ALLOWED",
    "NOT_IMPLEMENTED",
    "SESSION_API_NOT_SUPPORTED",
    "ENDPOINT_NOT_FOUND",
    "NOT_FOUND",
    "ROUTE_NOT_FOUND",
    "WORKER_UPSTREAM_ERROR"
  ];
  if (explicitUnsupportedCodes.includes(errorText)) return true;

  if (statusCode === 403 && /FORBIDDEN|UNAUTHORIZED|AUTH|WORKER_UPSTREAM_ERROR/.test(errorText)) return true;
  if (/CANNOT\s+(POST|GET)\s+\/API\/SESSIONS|ROUTE|NOT\s+FOUND|ENDPOINT/.test(errorText)) return true;

  return false;
}

export function isStaleSessionError(statusCode: number, rawError?: unknown): boolean {
  const validStatusCodes = [400, 404, 410, 422];
  if (!validStatusCodes.includes(statusCode)) return false;

  const errorCode = extractUpstreamErrorCode(rawError);
  const exactSessionErrorCodes = [
    "SESSION_NOT_FOUND",
    "INVALID_SESSION_ID",
    "SESSION_EXPIRED",
    "UNKNOWN_SESSION"
  ];

  return exactSessionErrorCodes.includes(errorCode);
}


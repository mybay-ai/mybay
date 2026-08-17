export interface HumanizedChatError {
  code: string;
  message: string;
  technicalMessage?: string;
  known: boolean;
}

type ErrorInput = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  data?: {
    code?: unknown;
    error?: unknown;
    errorCode?: unknown;
    error_code?: unknown;
    message?: unknown;
  } | null;
} | null;

const ERROR_MESSAGES: Record<string, string> = {
  INSTANCE_NOT_FOUND: "找不到这个实例，可能已删除或当前账号无权访问。",
  INTERNAL_ROUTING: "服务器内部路由密钥未配置，请补充配置后重启服务。",
  DOCKER_UNAVAILABLE: "服务器 Docker 服务暂时不可用，请检查 Docker 是否正在运行。",
  DOCKER_NOT_RUNNING: "服务器 Docker 服务未运行，请启动 Docker 后重试。",
  DOCKER_SOCKET_UNAVAILABLE: "无法连接 Docker 服务，请检查 Docker Socket 配置。",
  CHAT_API_NOT_READY: "实例聊天接口还未就绪，请等待实例启动完成。",
  CHAT_API_AUTH_REDIRECTED: "实例聊天接口鉴权失败，请重新部署或检查实例配置。",
  CONTAINER_NOT_REDEPLOYED: "实例配置尚未重新部署，请完成部署后再试。",
  INTERNAL_TRAEFIK_ROUTE_404: "实例内部路由不存在，请检查部署配置和路由密钥。",
  DIRECT_8642_TIMEOUT: "实例聊天端口响应超时，请检查容器运行状态。",
  DIRECT_8642_REFUSED: "实例聊天端口拒绝连接，请检查容器是否正常运行。",
  INSTANCE_OFFLINE: "实例当前离线，请先启动实例后再重试。",
  INSTANCE_NOT_READY: "实例还没有准备好，请等待实例状态变为可用。",
  UPSTREAM_UNAVAILABLE: "Agent 服务暂时不可用，请检查实例运行状态。",
  DISPATCH_UPSTREAM_UNAVAILABLE: "Agent 服务暂时不可用，请稍后重试。",
  RUN_NOT_FOUND: "任务不存在，可能已经过期或实例已重启。",
  UPSTREAM_RUN_NOT_FOUND: "Agent 任务状态已丢失，部分输出已保留，请重试。",
  CONVERSATION_NOT_FOUND: "当前会话不存在或已被删除，请重新选择会话。",
  SESSION_NOT_FOUND: "实例的会话路由不可用，请重试或检查实例状态。",
  DISPATCH_ROUTE_NOT_FOUND: "实例的 Agent 路由不存在，请检查实例是否正确部署。",
  ROUTE_NOT_FOUND: "实例访问路由不存在，请检查实例部署状态。",
  ENDPOINT_NOT_FOUND: "实例接口不可用，请检查 Agent 运行环境。",
  MODEL_CONFIG_MISSING: "实例缺少模型配置，请先完成模型和 API Key 配置。",
  API_KEY_MISSING: "当前实例没有可用的 API Key，请到实例设置或凭证中心配置。",
  HERMES_INTERNAL_API_KEY_MISSING: "实例内部 API Key 未配置，请重新部署或完善实例配置。",
  HERMES_API_AUTH_FAILED: "实例内部 API Key 校验失败，请检查实例配置后重试。",
  FEATURE_DISABLED: "当前部署未启用异步对话功能。",
  RUNS_NOT_SUPPORTED: "当前实例运行环境不支持异步对话。",
  CHAT_API_NOT_ENABLED: "当前实例未启用聊天接口，请检查 Agent 配置。",
  INSUFFICIENT_CREDITS: "当前账户额度不足，请充值或切换可用的模型配置。",
  CREDIT_LEDGER_NOT_READY: "账户额度服务还未准备好，请稍后重试。",
  CREDIT_LEDGER_UNAVAILABLE: "账户额度服务暂时不可用，请稍后重试。",
  INVALID_ATTACHMENT: "附件无法读取，请重新上传后再试。",
  ATTACHMENT_READ_FAILED: "附件读取失败，请重新上传后再试。",
  ATTACHMENT_METADATA_UPDATE_FAILED: "附件关联失败，请重新上传后再试。",
  BEGIN_RUN_FAILED: "任务初始化失败，请检查实例状态后重试。",
  BEGIN_TURN_FAILED: "对话初始化失败，请稍后重试。",
  DIRECT_MODEL_CHAT_FAILED: "大模型调用失败，请检查模型配置、额度和网络连接。",
  CHAT_TURN_COMMIT_FAILED: "对话结果保存失败，请稍后重试。",
  CHAT_TURN_FAILURE_COMMIT_FAILED: "任务失败状态保存失败，请刷新后重试。",
  CHAT_TURN_METADATA_RPC_MISSING: "数据库迁移版本不完整，请先完成数据库升级。",
  CHAT_TURN_RPC_SCHEMA_MISMATCH: "数据库函数版本不匹配，请同步最新数据库迁移。",
  DISPATCH_TIMEOUT: "任务派发超时，请检查实例运行状态后重试。",
  REMOTE_TIMEOUT: "实例响应超时，请检查实例网络或稍后重试。",
  LOCAL_ROUTE_TIMEOUT: "实例内部路由响应超时，请稍后重试。",
  RUNTIME_TIMEOUT_EXCEEDED: "任务执行超时，部分输出可能已保留，请重试。",
  TIMEOUT_EXCEEDED: "任务执行超时，部分输出可能已保留，请重试。",
  ZOMBIE_RUN_TIMEOUT: "任务长时间没有响应，已自动结束，请重试。",
  STOP_CONFIRMATION_TIMEOUT: "停止任务确认超时，请刷新页面确认当前状态。",
  STOP_REQUEST_FAILED: "停止任务失败，请稍后重试。",
  INTERNAL_ERROR: "服务器内部处理失败，请稍后重试。",
};

function normalizeCode(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function inferMessage(code: string, rawMessage: string, status: number): string | undefined {
  if (code.includes("TIMEOUT") || status === 408 || status === 504) return "请求或任务执行超时，请稍后重试。";
  if (code.includes("OFFLINE") || code.includes("UNAVAILABLE") || code.includes("CONNECTION") || status === 502 || status === 503) {
    return "实例或上游 Agent 服务暂时不可用，请检查运行状态后重试。";
  }
  if (code.includes("NOT_FOUND") || code.includes("ROUTE") || code.includes("ENDPOINT")) {
    return "实例访问路由不可用，请检查实例部署状态。";
  }
  const lower = rawMessage.toLowerCase();
  if (lower.includes("fetch failed") || lower.includes("networkerror") || lower.includes("failed to fetch")) {
    return "网络连接失败，请检查服务器和实例的网络状态。";
  }
  return undefined;
}

export function humanizeChatError(input: ErrorInput | unknown, fallback = "请求失败，请稍后重试。"): HumanizedChatError {
  const source = (input && typeof input === "object" ? input : {}) as ErrorInput;
  const data = source.data || {};
  const errorText = typeof data.error === "string" ? data.error.trim() : "";
  const legacyErrorCode = /^[A-Z][A-Z0-9_]+$/.test(errorText) ? errorText : "";
  const code = normalizeCode(data.code || data.errorCode || data.error_code || source.code || legacyErrorCode);
  const rawMessage = String(
    data.message || (!legacyErrorCode ? errorText : "") || source.message || "",
  ).trim();
  const status = Number(source.status || 0);
  const mapped = code ? ERROR_MESSAGES[code] : undefined;
  const inferred = inferMessage(code, rawMessage, status);
  const message = mapped || inferred || rawMessage || fallback;

  return {
    code,
    message,
    technicalMessage: rawMessage && rawMessage !== message ? rawMessage : undefined,
    known: Boolean(mapped || inferred),
  };
}

export function getChatErrorMessage(input: ErrorInput | unknown, fallback?: string): string {
  return humanizeChatError(input, fallback).message;
}

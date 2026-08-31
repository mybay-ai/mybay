export type LocalInstanceReadinessPhase =
  | "deploying"
  | "runtime_starting"
  | "runtime_ready_chat_initializing"
  | "runtime_ready_chat_configuration_required"
  | "ready"
  | "deployment_failed"
  | "chat_auth_or_route_failed"
  | "readiness_check_failed"
  | "stopped"
  | "unknown";

export type LocalInstanceReadinessInput = {
  status?: unknown;
  physicalStatus?: unknown;
  deploymentError?: unknown;
  modelConfigStatus?: unknown;
  modelRuntimeStatus?: unknown;
  gatewayStatus?: unknown;
  configuredChannels?: unknown;
  connectedChannels?: unknown;
  chat?: {
    ready?: boolean;
    runtimeReady?: boolean;
    sendable?: boolean;
    reason?: unknown;
    error?: unknown;
    message?: unknown;
    checkedAt?: string;
    probeStatus?: "checked" | "failed";
  } | null;
};

export type LocalInstanceReadiness = {
  phase: LocalInstanceReadinessPhase;
  runtimeReady: boolean;
  chatReady: boolean;
  reason: string | null;
  message: string | null;
};

const DEPLOYING_STATUSES = new Set([
  "queued",
  "creating",
  "deploying",
  "initializing",
  "container_starting",
  "gateway_starting",
  "gateway_syncing",
  "health_checking",
  "restarting",
]);

const RUNTIME_READY_STATUSES = new Set([
  "running",
  "gateway_ready",
  "partial_running",
  "dashboard_ready",
]);

const CHAT_AUTH_OR_ROUTE_ERRORS = new Set([
  "HERMES_API_AUTH_FAILED",
  "INTERNAL_ROUTE_AUTH_FAILED",
  "INTERNAL_ROUTING_SECRET_MISSING",
  "INTERNAL_ROUTE_NOT_FOUND",
  "INTERNAL_ROUTE_CONNECT_FAILED",
  "INTERNAL_ROUTE_TIMEOUT",
  "INVALID_HERMES_RESPONSE",
]);

const CHAT_CONFIGURATION_ERRORS = new Set([
  "CHAT_API_NOT_ENABLED",
  "HERMES_INTERNAL_API_KEY_MISSING",
  "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED",
  "MODEL_CONFIG_UNAVAILABLE",
  "CHANNEL_CONFIG_UNAVAILABLE",
]);

function normalize(value: unknown): string {
  return String(value || "").trim();
}

function upper(value: unknown): string {
  return normalize(value).toUpperCase();
}

export function deriveLocalInstanceReadiness(input: LocalInstanceReadinessInput): LocalInstanceReadiness {
  const status = normalize(input.status).toLowerCase();
  const physicalStatus = normalize(input.physicalStatus).toLowerCase();
  const chatReason = upper(input.chat?.reason || input.chat?.error) || null;
  const chatMessage = normalize(input.chat?.message) || null;
  const runtimeReady = input.chat?.runtimeReady === true
    || RUNTIME_READY_STATUSES.has(status)
    || physicalStatus === "running";
  const chatReady = input.chat?.ready === true && input.chat?.sendable !== false && input.chat?.probeStatus !== "failed";

  if (["stopped", "archived", "deleting", "deleted"].includes(status)) {
    return { phase: "stopped", runtimeReady: false, chatReady: false, reason: "INSTANCE_STOPPED", message: null };
  }

  if (DEPLOYING_STATUSES.has(status) && !runtimeReady) {
    return { phase: "deploying", runtimeReady: false, chatReady: false, reason: null, message: null };
  }

  if (!runtimeReady && (["failed", "unhealthy", "frontend_missing_build"].includes(status) || normalize(input.deploymentError))) {
    return {
      phase: "deployment_failed",
      runtimeReady: false,
      chatReady: false,
      reason: "DEPLOYMENT_FAILED",
      message: normalize(input.deploymentError) || null,
    };
  }

  if (!runtimeReady) {
    return { phase: status ? "runtime_starting" : "unknown", runtimeReady: false, chatReady: false, reason: chatReason, message: chatMessage };
  }

  if (chatReady) {
    return { phase: "ready", runtimeReady: true, chatReady: true, reason: null, message: chatMessage };
  }

  if (input.chat?.probeStatus === "failed" || chatReason === "PROBE_FAILED") {
    return { phase: "readiness_check_failed", runtimeReady, chatReady: false, reason: chatReason || "PROBE_FAILED", message: chatMessage };
  }

  if (chatReason && CHAT_AUTH_OR_ROUTE_ERRORS.has(chatReason)) {
    return { phase: "chat_auth_or_route_failed", runtimeReady: true, chatReady: false, reason: chatReason, message: chatMessage };
  }

  const modelConfigStatus = normalize(input.modelConfigStatus).toLowerCase();
  const gatewayStatus = normalize(input.gatewayStatus).toLowerCase();
  const configuredChannels = Number(input.configuredChannels || 0);
  const connectedChannels = Number(input.connectedChannels || 0);
  const inferredConfigurationReason = ["failed", "mismatched"].includes(modelConfigStatus)
    ? "MODEL_CONFIG_UNAVAILABLE"
    : configuredChannels > 0 && connectedChannels === 0 && gatewayStatus === "channel_adapter_failed"
      ? "CHANNEL_CONFIG_UNAVAILABLE"
      : null;
  const configurationReason = chatReason && CHAT_CONFIGURATION_ERRORS.has(chatReason)
    ? chatReason
    : inferredConfigurationReason;

  if (configurationReason) {
    return {
      phase: "runtime_ready_chat_configuration_required",
      runtimeReady: true,
      chatReady: false,
      reason: configurationReason,
      message: chatMessage,
    };
  }

  return {
    phase: "runtime_ready_chat_initializing",
    runtimeReady: true,
    chatReady: false,
    reason: chatReason,
    message: chatMessage,
  };
}

/** A stopped lifecycle wins over a stale container-running observation. GET only. */
export function canProbeLocalInstanceReadiness(input: LocalInstanceReadinessInput): boolean {
  const status = normalize(input.status).toLowerCase();
  if (["stopped", "archived", "deleting", "deleted"].includes(status)) return false;
  return normalize(input.physicalStatus).toLowerCase() === "running"
    || RUNTIME_READY_STATUSES.has(status) || ["failed", "unhealthy"].includes(status);
}

export type LocalReadinessCheckStatus = "ready" | "pending" | "failed" | "unknown" | "configured" | "not_configured" | "partial" | "historical_success" | "stopped";
export type LocalReadinessCheck = { key: "runtime" | "chat" | "model_config" | "model_response" | "channels"; status: LocalReadinessCheckStatus };

/** These dimensions describe their own evidence; API health is not a model call. */
export function deriveLocalReadinessChecks(input: LocalInstanceReadinessInput): LocalReadinessCheck[] {
  const readiness = deriveLocalInstanceReadiness(input);
  const modelConfig = normalize(input.modelConfigStatus).toLowerCase();
  const modelRuntime = normalize(input.modelRuntimeStatus).toLowerCase();
  const configured = input.configuredChannels == null ? null : Number(input.configuredChannels);
  const connected = input.connectedChannels == null ? null : Number(input.connectedChannels);
  const stopped = readiness.phase === "stopped";
  const chatFailure = ["readiness_check_failed", "chat_auth_or_route_failed", "runtime_ready_chat_configuration_required"].includes(readiness.phase);
  return [
    { key: "runtime", status: stopped ? "stopped" : readiness.runtimeReady ? "ready" : readiness.phase === "deployment_failed" ? "failed" : readiness.phase === "unknown" ? "unknown" : "pending" },
    { key: "chat", status: stopped ? "stopped" : readiness.chatReady ? "ready" : !input.chat ? "unknown" : chatFailure ? "failed" : "pending" },
    { key: "model_config", status: ["failed", "mismatched"].includes(modelConfig) ? "failed" : ["verified", "verified_by_runtime_session"].includes(modelConfig) ? "ready" : ["written", "injected", "verification_auth_required"].includes(modelConfig) ? "configured" : modelConfig === "pending" ? "pending" : "unknown" },
    { key: "model_response", status: modelRuntime === "callable" ? "historical_success" : modelRuntime === "failed" ? "failed" : "unknown" },
    { key: "channels", status: stopped ? "stopped" : configured === null || !Number.isFinite(configured) || configured < 0 ? "unknown" : configured === 0 ? "not_configured" : connected === null || !Number.isFinite(connected) || connected < 0 ? "unknown" : connected >= configured ? "ready" : connected > 0 ? "partial" : normalize(input.gatewayStatus) === "channel_adapter_failed" ? "failed" : "pending" },
  ];
}

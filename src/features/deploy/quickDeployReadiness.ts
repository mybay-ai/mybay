export type QuickReadinessTone = "pending" | "ready" | "attention" | "failed";

export interface QuickReadinessStage {
  tone: QuickReadinessTone;
  reason?: string | null;
}

export interface QuickDeployReadiness {
  runtime: QuickReadinessStage;
  chat: QuickReadinessStage;
  terminal: boolean;
}

const RUNTIME_READY_STATUSES = new Set(["running", "partial_running", "gateway_ready", "dashboard_ready"]);
const RUNTIME_FAILED_STATUSES = new Set(["failed", "unhealthy", "frontend_missing_build"]);
const CHAT_ATTENTION_ERRORS = new Set([
  "CHAT_API_NOT_ENABLED",
  "HERMES_INTERNAL_API_KEY_MISSING",
  "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED",
  "HERMES_API_AUTH_FAILED",
  "INTERNAL_ROUTE_AUTH_FAILED",
  "INTERNAL_ROUTING_SECRET_MISSING",
  "RUNTIME_ERROR",
]);

export function deriveQuickDeployReadiness(deployment: any, instance: any, chatReadiness: any): QuickDeployReadiness {
  const deploymentStatus = String(deployment?.status || "queued").toLowerCase();
  const instanceStatus = String(instance?.status || deployment?.instanceStatus || "deploying").toLowerCase();
  const failureReason = deployment?.errorMessage || deployment?.errorCode || instance?.runtime_error || instance?.error_message || null;

  if (["failed", "cancelled"].includes(deploymentStatus) || RUNTIME_FAILED_STATUSES.has(instanceStatus)) {
    return {
      runtime: { tone: "failed", reason: failureReason || instanceStatus },
      chat: { tone: "failed", reason: failureReason || chatReadiness?.message || instanceStatus },
      terminal: true,
    };
  }

  if (deploymentStatus !== "success" || !RUNTIME_READY_STATUSES.has(instanceStatus)) {
    return {
      runtime: { tone: "pending", reason: deploymentStatus !== "success" ? deploymentStatus : instanceStatus },
      chat: { tone: "pending", reason: chatReadiness?.message || null },
      terminal: false,
    };
  }

  if (chatReadiness?.ready === true || chatReadiness?.sendable === true) {
    return { runtime: { tone: "ready" }, chat: { tone: "ready" }, terminal: true };
  }

  const chatError = chatReadiness?.error || chatReadiness?.reason || null;
  if (chatError && CHAT_ATTENTION_ERRORS.has(String(chatError))) {
    return {
      runtime: { tone: "ready" },
      chat: { tone: "attention", reason: chatReadiness?.message || String(chatError) },
      terminal: true,
    };
  }

  return {
    runtime: { tone: "ready" },
    chat: { tone: "pending", reason: chatReadiness?.message || chatError },
    terminal: false,
  };
}

import { deriveLocalInstanceReadiness } from "../../../shared/localInstanceReadiness";

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

export function deriveQuickDeployReadiness(deployment: any, instance: any, chatReadiness: any): QuickDeployReadiness {
  const deploymentStatus = String(deployment?.status || "queued").toLowerCase();
  const instanceStatus = String(instance?.status || deployment?.instanceStatus || "deploying").toLowerCase();
  const failureReason = deployment?.errorMessage || deployment?.errorCode || instance?.runtime_error || instance?.error_message || null;
  const local = deriveLocalInstanceReadiness({
    status: instanceStatus,
    physicalStatus: instance?.physical_status,
    deploymentError: instance?.deployment_error,
    modelConfigStatus: instance?.model_config_status,
    gatewayStatus: instance?.gateway_status,
    configuredChannels: instance?.configured_channels,
    connectedChannels: instance?.connected_channels,
    chat: chatReadiness,
  });

  if (["failed", "cancelled"].includes(deploymentStatus) || local.phase === "deployment_failed") {
    return {
      runtime: local.runtimeReady ? { tone: "ready" } : { tone: "failed", reason: failureReason || instanceStatus },
      chat: { tone: "failed", reason: failureReason || chatReadiness?.message || instanceStatus },
      terminal: true,
    };
  }

  if (local.phase === "stopped") {
    return { runtime: { tone: "attention", reason: local.reason }, chat: { tone: "attention", reason: local.reason }, terminal: true };
  }

  if (deploymentStatus !== "success" || !local.runtimeReady) {
    return {
      runtime: { tone: "pending", reason: deploymentStatus !== "success" ? deploymentStatus : instanceStatus },
      chat: { tone: "pending", reason: chatReadiness?.message || null },
      terminal: false,
    };
  }

  if (local.chatReady) {
    return { runtime: { tone: "ready" }, chat: { tone: "ready" }, terminal: true };
  }

  const chatError = chatReadiness?.error || chatReadiness?.reason || null;
  if (["runtime_ready_chat_configuration_required", "chat_auth_or_route_failed", "readiness_check_failed"].includes(local.phase)) {
    return {
      runtime: { tone: "ready" },
      chat: { tone: "attention", reason: chatReadiness?.message || local.reason || String(chatError) },
      terminal: true,
    };
  }

  return {
    runtime: { tone: "ready" },
    chat: { tone: "pending", reason: chatReadiness?.message || chatError },
    terminal: false,
  };
}

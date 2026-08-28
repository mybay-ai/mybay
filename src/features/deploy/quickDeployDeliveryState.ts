import type { QuickDeployReadiness } from "./quickDeployReadiness";

export const QUICK_DEPLOY_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function shouldProbeQuickDeployChat(deployment: any, instance: any) {
  const deploymentStatus = String(deployment?.status || "").toLowerCase();
  const instanceStatus = String(instance?.status || deployment?.instanceStatus || "").toLowerCase();
  return deploymentStatus === "success"
    && ["running", "partial_running", "gateway_ready", "dashboard_ready"].includes(instanceStatus);
}

export function shouldContinueQuickDeployPolling(
  readiness: QuickDeployReadiness,
  elapsedMs: number,
  timeoutMs = QUICK_DEPLOY_POLL_TIMEOUT_MS,
) {
  return !readiness.terminal && elapsedMs < timeoutMs;
}

export function quickDeployProgressPercent(value: unknown) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 5;
  return Math.max(5, Math.min(100, Math.round(progress)));
}

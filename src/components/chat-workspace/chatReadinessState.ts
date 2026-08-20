export interface ChatReadinessState {
  ready: boolean;
  runtimeReady: boolean;
  sendable: boolean;
  wakeable: boolean;
  runtimeState?: string;
  reason?: string;
  message?: string;
}

export function normalizeChatReadinessProbe(probe: any): ChatReadinessState {
  const ready = probe?.ready === true;
  const runtimeReady = probe?.runtimeReady ?? ready;
  const sendable = probe?.sendable ?? ready;
  const wakeable = probe?.wakeable ?? false;
  const reason = String(probe?.reason || probe?.error || "").trim() || undefined;
  return {
    ready,
    runtimeReady: runtimeReady === true,
    sendable: sendable === true,
    wakeable: wakeable === true,
    runtimeState: typeof probe?.runtimeState === "string" ? probe.runtimeState : undefined,
    reason,
    message: typeof probe?.message === "string" ? probe.message : undefined,
  };
}

export function unavailableChatReadiness(
  reason = "PROBE_FAILED",
  message?: string,
): ChatReadinessState {
  return {
    ready: false,
    runtimeReady: false,
    sendable: false,
    wakeable: false,
    reason,
    message,
  };
}

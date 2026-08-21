export interface LocalChatReadiness {
  ready: boolean;
  runtimeReady: boolean;
  sendable: boolean;
  wakeable: false;
  runtimeState: string;
  reason: string | null;
  error: string | null;
  message: string;
}

const PROBEABLE_INSTANCE_STATUSES = new Set([
  "running",
  "gateway_ready",
  "partial_running",
  "dashboard_ready",
]);

const DASHBOARDLESS_RECOVERABLE_STATUSES = new Set(["failed", "unhealthy"]);

function normalizeRuntimeState(status: unknown, ready: boolean): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (ready) return "running";
  return normalized || "unknown";
}

export function buildLocalChatReadiness(input: {
  ready: boolean;
  status?: unknown;
  reason?: string | null;
  error?: string | null;
  message: string;
}): LocalChatReadiness {
  const reason = input.reason ?? input.error ?? null;
  return {
    ready: input.ready,
    runtimeReady: input.ready,
    sendable: input.ready,
    wakeable: false,
    runtimeState: normalizeRuntimeState(input.status, input.ready),
    reason,
    error: input.error ?? reason,
    message: input.message,
  };
}

export function resolveLocalChatLifecycleReadiness(input: {
  status?: unknown;
  dashboardEnabled?: boolean;
}): LocalChatReadiness | null {
  const status = String(input.status || "").trim().toLowerCase();
  const canProbe = PROBEABLE_INSTANCE_STATUSES.has(status)
    || (input.dashboardEnabled === false && DASHBOARDLESS_RECOVERABLE_STATUSES.has(status));
  if (canProbe) return null;

  return buildLocalChatReadiness({
    ready: false,
    status,
    reason: "INSTANCE_NOT_RUNNING",
    error: "INSTANCE_NOT_RUNNING",
    message: `Instance is currently ${status || "unknown"} and cannot accept chat requests.`,
  });
}

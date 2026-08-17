export interface DispatchRunContext {
  id: string;
  instance_id: string;
  [key: string]: unknown;
}

export interface DispatchRecordResult {
  status: string;
  run_status: string | null;
}

export interface DispatchRecordDependencies {
  publishStatus(runId: string, status: "running" | "stopping"): void;
  startEventStream(run: DispatchRunContext, upstreamId: string): void;
  clearEvents(runId: string): void;
  markLeaseLost(runId: string): void;
  logOperation(
    operation: string,
    runId: string,
    instanceId: string,
    statusCode: number,
    errorCode?: string,
  ): void;
  getRun(runId: string): Promise<unknown>;
  hasValidLease(run: unknown): boolean;
  failRun(runId: string, errorCode: string): Promise<unknown>;
}

export async function handleDispatchRecordResult(
  run: DispatchRunContext,
  recordResult: DispatchRecordResult,
  upstreamId: string,
  dependencies: DispatchRecordDependencies,
): Promise<boolean> {
  const status = recordResult.status;
  if (status === "recorded_running" || status === "already_running") {
    dependencies.publishStatus(run.id, "running");
    dependencies.startEventStream(run, upstreamId);
    return true;
  }
  if (status === "recorded_stopping") {
    dependencies.publishStatus(run.id, "stopping");
    return false;
  }
  if (status === "already_terminal") {
    dependencies.clearEvents(run.id);
    return false;
  }
  if (status === "lease_lost") {
    dependencies.markLeaseLost(run.id);
    dependencies.clearEvents(run.id);
    return false;
  }

  const failure = status === "upstream_id_conflict"
    ? { operation: "UPSTREAM_ID_CONFLICT", statusCode: 409, errorCode: "UPSTREAM_RUN_ID_CONFLICT" }
    : status === "invalid_upstream_run_id"
      ? { operation: "INVALID_UPSTREAM_RUN_ID", statusCode: 400, errorCode: "INVALID_UPSTREAM_RUN_ID" }
      : null;

  if (failure) {
    dependencies.logOperation(failure.operation, run.id, run.instance_id, failure.statusCode, failure.errorCode);
    const freshRun = await dependencies.getRun(run.id);
    if (dependencies.hasValidLease(freshRun)) {
      await dependencies.failRun(run.id, failure.errorCode);
    }
    return false;
  }

  dependencies.logOperation("DISPATCH_RECORD_FAILED", run.id, run.instance_id, 500, status);
  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function extractUpstreamRunList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.runs)) return payload.runs.filter(isObject);
  if (Array.isArray(payload.data)) return payload.data.filter(isObject);
  return [];
}

export function findRecoveredUpstreamId(payload: unknown, localRunId: string): string | null {
  const match = extractUpstreamRunList(payload).find((candidate) =>
    candidate.id === localRunId ||
    candidate.run_id === localRunId ||
    candidate.upstream_run_id === localRunId
  );
  return match?.id ? match.id as string : null;
}

export function isValidUpstreamRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_\-.]{1,128}$/.test(value);
}

export function shouldSearchForDispatchedRun(nextAttempts: number): boolean {
  return nextAttempts > 1;
}

export function hasReachedDispatchAttemptLimit(attempts: number): boolean {
  return attempts >= 3;
}

export function isStoppingRecoveryRecordSuccess(status: string): boolean {
  return ["recorded_stopping", "already_stopping", "recorded_running", "already_running"].includes(status);
}

export interface StopRecoveryWindow {
  stopAttempts: number;
  elapsedSeconds: number;
  timedOut: boolean;
}

export function resolveStopRecoveryWindow(
  rawStopAttempts: unknown,
  stopRequestedAt: unknown,
  nowMs: number,
): StopRecoveryWindow {
  const stopAttempts = Number.isFinite(Number(rawStopAttempts)) ? Number(rawStopAttempts) : 0;
  let requestedTime = nowMs;
  if (stopRequestedAt) {
    const parsedTime = new Date(String(stopRequestedAt)).getTime();
    if (Number.isFinite(parsedTime)) requestedTime = parsedTime;
  }
  const elapsedSeconds = (nowMs - requestedTime) / 1000;
  return {
    stopAttempts,
    elapsedSeconds,
    timedOut: stopAttempts >= 3 || elapsedSeconds > 300,
  };
}

export function normalizeDispatchError(statusCode: number, rawError?: unknown): string {
  const code = typeof rawError === "string" ? rawError.toUpperCase() : String(rawError || "").toUpperCase();
  if (
    code.includes("SESSION_NOT_FOUND") ||
    code.includes("INVALID_SESSION_ID") ||
    code.includes("SESSION_EXPIRED") ||
    code.includes("UNKNOWN_SESSION")
  ) {
    return code;
  }
  if (code === "HERMES_INTERNAL_API_KEY_MISSING" || code === "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED") return code;
  if (statusCode === 401 || statusCode === 403 || code.includes("AUTH")) return "HERMES_API_AUTH_FAILED";
  if (statusCode === 404 || code.includes("NOT_FOUND") || code.includes("ROUTE")) return "DISPATCH_ROUTE_NOT_FOUND";
  if (statusCode === 408 || statusCode === 504 || code.includes("TIMEOUT")) return "DISPATCH_TIMEOUT";
  if (statusCode === 400 || statusCode === 422) return "DISPATCH_INVALID_REQUEST";
  if (statusCode === 502 || statusCode === 503 || code.includes("ECONN") || code.includes("CONNECT") || code.includes("UNAVAILABLE")) {
    return "DISPATCH_UPSTREAM_UNAVAILABLE";
  }
  if (statusCode >= 500) return "DISPATCH_UPSTREAM_UNAVAILABLE";
  return "UPSTREAM_DISPATCH_ERR";
}

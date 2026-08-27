import type { TerminalRunStatus } from "../runUiLifecycle";

export type StopRunStatus = "stopping" | TerminalRunStatus;
export type StopRunResult = { ok: true; status: StopRunStatus } | { ok: false; error: string };
export type RunReleaseResult = {
  released: boolean;
  status?: StopRunStatus;
  reason?: "timeout" | "unavailable";
};
export type StopLifecycleOutcome = "failed" | "stale" | "status_unknown" | TerminalRunStatus;

export function normalizeStopRunStatus(value: unknown): StopRunStatus | null {
  const status = String(value || "").trim().toLowerCase();
  if (status === "canceled") return "cancelled";
  if (status === "stop_requested") return "stopping";
  return ["stopping", "completed", "failed", "cancelled", "stopped", "expired"].includes(status)
    ? status as StopRunStatus
    : null;
}

export function isTerminalStopStatus(status?: string | null): status is TerminalRunStatus {
  return ["completed", "failed", "cancelled", "stopped", "expired"].includes(String(status || "").toLowerCase());
}

export async function pollRunRelease(options: {
  readStatus: () => Promise<unknown>;
  delay: (ms: number) => Promise<void>;
  attempts?: number;
}): Promise<RunReleaseResult> {
  let lastStatus: StopRunStatus | undefined;
  for (let attempt = 0; attempt < (options.attempts ?? 8); attempt += 1) {
    await options.delay(attempt === 0 ? 180 : 320);
    try {
      const status = normalizeStopRunStatus(await options.readStatus());
      if (status) lastStatus = status;
      if (status && isTerminalStopStatus(status)) return { released: true, status };
    } catch {
      return { released: false, status: lastStatus, reason: "unavailable" };
    }
  }
  return { released: false, status: lastStatus, reason: "timeout" };
}

export async function executeStopLifecycle(options: {
  requestStop: () => Promise<StopRunResult>;
  waitForRelease: () => Promise<RunReleaseResult>;
  isCurrentTarget: () => boolean;
  onTerminal: (status: TerminalRunStatus) => void;
}): Promise<StopLifecycleOutcome> {
  const stopResult = await options.requestStop();
  if (!stopResult.ok) return "failed";
  if (!options.isCurrentTarget()) return "stale";
  if (isTerminalStopStatus(stopResult.status)) {
    options.onTerminal(stopResult.status);
    return stopResult.status;
  }

  const release = await options.waitForRelease();
  if (!options.isCurrentTarget()) return "stale";
  if (release.released && isTerminalStopStatus(release.status)) {
    options.onTerminal(release.status);
    return release.status;
  }
  return "status_unknown";
}

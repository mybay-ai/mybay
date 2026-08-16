import type { CapabilityState } from "./capabilities";

export type InteractiveRunsAvailabilityReason =
  | "INTERACTIVE_RUNS_DISABLED"
  | "UPSTREAM_RUNS_UNSUPPORTED"
  | "CAPABILITY_PROBE_FAILED"
  | null;

export interface InteractiveRunsAvailability {
  upstreamState: CapabilityState;
  creationEnabled: boolean;
  effectiveState: CapabilityState;
  runsSupported: boolean;
  reason: InteractiveRunsAvailabilityReason;
}

/** Fail closed and remain independent from Scheduler task execution. */
export function isInteractiveRunsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MYBAY_ASYNC_CHAT_RUNS_ENABLED === "true";
}

export function resolveInteractiveRunsAvailability(
  upstreamState: CapabilityState,
  creationEnabled = isInteractiveRunsEnabled()
): InteractiveRunsAvailability {
  if (!creationEnabled) {
    return { upstreamState, creationEnabled: false, effectiveState: "explicitly_unsupported", runsSupported: false, reason: "INTERACTIVE_RUNS_DISABLED" };
  }
  if (upstreamState === "supported") {
    return { upstreamState, creationEnabled: true, effectiveState: "supported", runsSupported: true, reason: null };
  }
  if (upstreamState === "explicitly_unsupported") {
    return { upstreamState, creationEnabled: true, effectiveState: "explicitly_unsupported", runsSupported: false, reason: "UPSTREAM_RUNS_UNSUPPORTED" };
  }
  return { upstreamState, creationEnabled: true, effectiveState: "unavailable", runsSupported: false, reason: "CAPABILITY_PROBE_FAILED" };
}

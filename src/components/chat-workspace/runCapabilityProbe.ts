export type RunsCapabilityState = "checking" | "supported" | "explicitly_unsupported" | "unavailable" | "disabled";
export type RunsCapabilityDetails = {
  features: Record<string, boolean>;
  toolProgressEvents: boolean;
  runEventsSse: boolean;
  runStop: boolean;
  approvalEvents: boolean;
  runApprovalResponse: boolean;
};
export type RunCapabilitySnapshot = {
  instanceId: string;
  state: RunsCapabilityState;
  details: RunsCapabilityDetails;
};

export function checkingRunCapabilities(instanceId: string): RunCapabilitySnapshot {
  return { instanceId, state: "checking", details: {
    features: {}, toolProgressEvents: false, runEventsSse: false, runStop: false,
    approvalEvents: false, runApprovalResponse: false,
  } };
}

export function scopedRunCapabilities(snapshot: RunCapabilitySnapshot, instanceId: string): RunCapabilitySnapshot {
  // Do not briefly enable a new Agent with the previous Agent's capability result.
  return snapshot.instanceId === instanceId ? snapshot : checkingRunCapabilities(instanceId);
}

export function normalizeRunCapabilities(instanceId: string, response: any): RunCapabilitySnapshot {
  const snapshot = checkingRunCapabilities(instanceId);
  if (!response?.success) return { ...snapshot, state: "unavailable" };
  const details: RunsCapabilityDetails = {
    features: response.features && typeof response.features === "object" ? response.features : {},
    toolProgressEvents: response.toolProgressEvents === true,
    runEventsSse: response.runEventsSse === true || response.features?.run_events_sse === true,
    runStop: response.runStop === true || response.features?.run_stop === true,
    approvalEvents: response.approvalEvents === true || response.features?.approval_events === true,
    runApprovalResponse: response.runApprovalResponse === true || response.features?.run_approval_response === true,
  };
  let state: RunsCapabilityState = "unavailable";
  if (response.reason === "INTERACTIVE_RUNS_DISABLED" || response.creationEnabled === false) state = "disabled";
  else if (response.reason === "UPSTREAM_RUNS_UNSUPPORTED") state = "explicitly_unsupported";
  else if (response.reason !== "CAPABILITY_PROBE_FAILED") {
    if (response.state === "supported") state = "supported";
    else if (response.state === "explicitly_unsupported") state = "explicitly_unsupported";
  }
  return { instanceId, state, details };
}

export function startRunCapabilityProbe({ instanceId, load, apply, isCurrent }: {
  instanceId: string;
  load: (instanceId: string, signal: AbortSignal) => Promise<unknown>;
  apply: (snapshot: RunCapabilitySnapshot) => void;
  isCurrent: () => boolean;
}) {
  const controller = new AbortController();
  const canApply = () => !controller.signal.aborted && isCurrent();
  if (canApply()) apply(checkingRunCapabilities(instanceId));
  const settled = (async () => {
    if (!instanceId || !canApply()) return;
    try {
      const response = await load(instanceId, controller.signal);
      if (canApply()) apply(normalizeRunCapabilities(instanceId, response));
    } catch {
      if (canApply()) apply({ ...checkingRunCapabilities(instanceId), state: "unavailable" });
    }
  })();
  return { cancel: () => controller.abort(), settled };
}

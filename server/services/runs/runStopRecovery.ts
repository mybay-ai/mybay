import { findRecoveredUpstreamId, isStoppingRecoveryRecordSuccess, resolveStopRecoveryWindow } from "./runDispatchRecovery";
import { isImmediateStopCancellation, resolveTerminalProbeOutcome } from "./runProbeController";
import { convergeRunTerminalProbe, type RunTerminalConvergenceDependencies } from "./runTerminalConvergence";
import {
  HERMES_RUNTIME_CAPABILITIES,
  resolveRunCancellationCapability,
  resolveTerminalObservationCapability,
  type RuntimeCapabilityDescriptor,
} from "./runtimeCapabilityConsumers";
import type { RunsRequestOptions, RunsRequestResult } from "./runHermesTransport";

export interface RunStopRecoveryDependencies extends RunTerminalConvergenceDependencies {
  ownerId: string;
  requestRuns(options: RunsRequestOptions): Promise<RunsRequestResult>;
  recordDispatched(params: {
    runId: string;
    reconcilerId: string;
    upstreamRunId: string;
    startedAt: string;
  }): Promise<{ status: string; run_status: string | null }>;
  updateRun(runId: string, updates: Record<string, unknown>, ownerId: string): Promise<boolean>;
  markLeaseLost(runId: string): void;
  clearEvents(runId: string): void;
  hasLeaseBeenLost(runId: string): boolean;
  capabilities?: RuntimeCapabilityDescriptor;
  now?(): number;
}

export async function recoverStoppingRun(
  run: any,
  dependencies: RunStopRecoveryDependencies,
): Promise<void> {
  const now = dependencies.now?.() ?? Date.now();
  const failOnLeaseLoss = (success: boolean): boolean => {
    if (success) return false;
    dependencies.markLeaseLost(run.id);
    dependencies.clearEvents(run.id);
    return true;
  };

  if (!run.upstream_run_id) {
    dependencies.log?.({ operation: "STOPPING_NO_UPSTREAM", runId: run.id, instanceId: run.instance_id });
    if (dependencies.hasLeaseBeenLost(run.id)) return;
    if (Number(run.dispatch_attempts || 0) === 0) {
      await dependencies.completeRun(run.id, "cancelled", "", "CANCELLED_BY_USER");
      return;
    }

    const query = await dependencies.requestRuns({
      instanceId: run.instance_id,
      method: "GET",
      path: "/v1/runs",
      timeoutMs: 10_000,
    });
    const recoveredUpstreamId = query.ok && query.json ? findRecoveredUpstreamId(query.json, run.id) : null;
    if (recoveredUpstreamId) {
      const record = await dependencies.recordDispatched({
        runId: run.id,
        reconcilerId: dependencies.ownerId,
        upstreamRunId: recoveredUpstreamId,
        startedAt: new Date(now).toISOString(),
      });
      if (isStoppingRecoveryRecordSuccess(record.status)) {
        dependencies.log?.({
          operation: "STOPPING_UPSTREAM_RECOVERED",
          runId: run.id,
          instanceId: run.instance_id,
          upstreamRunId: recoveredUpstreamId,
        });
        return;
      }
    }

    const recovery = resolveStopRecoveryWindow(run.stop_attempts, run.stop_requested_at, now);
    if (recovery.timedOut) {
      await dependencies.completeRun(run.id, "failed", "", "STOP_CONFIRMATION_TIMEOUT");
      return;
    }
    failOnLeaseLoss(await dependencies.updateRun(run.id, {
      stop_attempts: recovery.stopAttempts + 1,
      stop_requested_at: run.stop_requested_at || new Date(now).toISOString(),
    }, dependencies.ownerId));
    return;
  }

  const capabilities = dependencies.capabilities || HERMES_RUNTIME_CAPABILITIES;
  const terminalObservation = resolveTerminalObservationCapability(capabilities);
  if (terminalObservation.supported === false) {
    await dependencies.completeRun(run.id, "failed", "", terminalObservation.errorCode);
    return;
  }

  const probeStartedAt = dependencies.now?.() ?? Date.now();
  const statusResult = await dependencies.requestRuns({
    instanceId: run.instance_id,
    method: "GET",
    path: `/v1/runs/${run.upstream_run_id}`,
    timeoutMs: 10_000,
  });
  const durationMs = (dependencies.now?.() ?? Date.now()) - probeStartedAt;
  const recovery = resolveStopRecoveryWindow(run.stop_attempts, run.stop_requested_at, now);

  if (statusResult.ok && statusResult.json) {
    const convergence = await convergeRunTerminalProbe(
      run,
      resolveTerminalProbeOutcome(statusResult.json, durationMs),
      "stop_recovery",
      dependencies,
    );
    if (convergence.terminal) return;
  } else if (statusResult.statusCode === 404) {
    if (recovery.timedOut) {
      await dependencies.completeRun(run.id, "failed", "", "STOP_CONFIRMATION_TIMEOUT");
      return;
    }
    failOnLeaseLoss(await dependencies.updateRun(run.id, {
      stop_attempts: recovery.stopAttempts + 1,
      stop_requested_at: run.stop_requested_at || new Date(now).toISOString(),
    }, dependencies.ownerId));
    return;
  }

  if (recovery.timedOut) {
    await dependencies.completeRun(run.id, "failed", "", "STOP_CONFIRMATION_TIMEOUT");
    return;
  }

  const cancellation = resolveRunCancellationCapability(capabilities);
  if (cancellation.supported === false) {
    await dependencies.completeRun(run.id, "failed", "", cancellation.errorCode);
    return;
  }

  const recorded = await dependencies.updateRun(run.id, {
    stop_attempts: recovery.stopAttempts + 1,
    stop_requested_at: run.stop_requested_at || new Date(now).toISOString(),
  }, dependencies.ownerId);
  if (failOnLeaseLoss(recorded)) return;

  const stopResult = await dependencies.requestRuns({
    instanceId: run.instance_id,
    method: "POST",
    path: `/v1/runs/${run.upstream_run_id}/stop`,
    timeoutMs: 10_000,
  });
  if (stopResult.ok && isImmediateStopCancellation(stopResult.json)) {
    if (!dependencies.hasLeaseBeenLost(run.id)) {
      await dependencies.completeRun(run.id, "cancelled", "", "CANCELLED_UPSTREAM");
    }
    return;
  }

  dependencies.log?.({
    operation: stopResult.ok ? "STOPPING_ACCEPTED_WAITING" : "STOPPING_FAILED_RETRYING",
    runId: run.id,
    instanceId: run.instance_id,
    statusCode: stopResult.statusCode,
  });
}

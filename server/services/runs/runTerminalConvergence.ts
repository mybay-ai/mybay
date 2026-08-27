import type { TerminalProbeOutcome } from "./runProbeController";

export type TerminalConvergenceResult =
  | { terminal: false; committed: false }
  | { terminal: true; committed: boolean; status: "completed" | "failed" | "cancelled" };

export interface RunTerminalConvergenceDependencies {
  completeRun(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    assistantContent: string,
    errorCode?: string,
    usage?: Record<string, unknown>,
    durationMs?: number | null,
    authorization?: { expectedUpstreamRunId?: string; runSnapshot?: unknown },
  ): Promise<boolean>;
  log?(entry: Record<string, unknown>): void;
}

export async function convergeRunTerminalProbe(
  run: any,
  probe: TerminalProbeOutcome | null,
  phase: "status_probe" | "stop_recovery",
  dependencies: RunTerminalConvergenceDependencies,
): Promise<TerminalConvergenceResult> {
  if (!probe) return { terminal: false, committed: false };

  let committed = false;
  if (probe.status === "completed") {
    committed = await dependencies.completeRun(
      run.id,
      "completed",
      probe.assistantContent,
      undefined,
      probe.usage,
      probe.durationMs,
      { expectedUpstreamRunId: String(run.upstream_run_id || ""), runSnapshot: run },
    );
  } else if (probe.status === "failed") {
    committed = await dependencies.completeRun(run.id, "failed", "", probe.error);
  } else {
    committed = await dependencies.completeRun(run.id, "cancelled", "", probe.errorCode);
  }

  dependencies.log?.({
    operation: committed ? "RUN_TERMINAL_CONVERGENCE_COMPLETED" : "RUN_TERMINAL_CONVERGENCE_DEFERRED",
    runId: run.id,
    instanceId: run.instance_id,
    upstreamRunId: run.upstream_run_id,
    finalStatus: probe.status,
    reconciliationPath: phase,
  });
  return { terminal: true, committed, status: probe.status };
}

import type { RunEventTracker } from "./runHermesEventInterpreter";

type InteractionSource = "immediate_post_dispatch" | "status_probe";

export interface PendingInteractionTarget {
  id: string;
  instance_id?: string;
  partial_output?: unknown;
}

export interface PendingInteractionRecoveryDependencies {
  getTracker(runId: string, initialPartialOutput?: unknown): RunEventTracker;
  consume(run: PendingInteractionTarget, event: Record<string, unknown>): void;
  log?(entry: Record<string, unknown>): void;
}

function readArray(payload: any, camelKey: string, snakeKey: string): any[] {
  if (Array.isArray(payload?.[camelKey])) return payload[camelKey];
  if (Array.isArray(payload?.[snakeKey])) return payload[snakeKey];
  return [];
}

export function publishPendingRuntimeInteractions(
  run: PendingInteractionTarget,
  payload: unknown,
  source: InteractionSource,
  dependencies: PendingInteractionRecoveryDependencies,
): number {
  const tracker = dependencies.getTracker(run.id, run.partial_output);
  let published = 0;
  const pendingApprovals = readArray(payload, "pendingApprovals", "pending_approvals");

  for (const approval of pendingApprovals) {
    const approvalId = String(
      approval?.permission_id || approval?.approval_id || approval?.id || approval?.request_id || "",
    ).trim();
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(approvalId)) continue;
    const dedupeKey = `interaction:approval:${approvalId}`;
    if (tracker.sentSteps.has(dedupeKey)) continue;
    tracker.sentSteps.set(dedupeKey, "pending");
    dependencies.log?.({
      operation: "PENDING_APPROVAL_RECOVERED",
      source,
      runId: run.id,
      instanceId: run.instance_id,
      approvalId,
    });
    dependencies.consume(run, {
      ...approval,
      event: "approval.request",
      approval_id: approvalId,
    });
    published += 1;
  }

  return published;
}

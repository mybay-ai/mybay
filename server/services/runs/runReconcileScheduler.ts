interface ScheduledRun {
  id: string;
  instance_id?: string | null;
  [key: string]: unknown;
}

interface SchedulerLeaseController {
  lostRunIds: Set<string>;
  claim(): Promise<ScheduledRun[]>;
  startRenewal(runs: ScheduledRun[]): () => void;
  hasLost(runId: string): boolean;
  release(runId: string): Promise<unknown>;
}

interface RunReconcileSchedulerDependencies {
  ownerId: string;
  isTestEnvironment(): boolean;
  createLeaseController(claimLimit: number): SchedulerLeaseController;
  emitClaimed(run: ScheduledRun): void;
  processRun(run: ScheduledRun, leaseLostRuns: Set<string>): Promise<void>;
  cleanupInactiveCaches(): void;
  clearStreams(): void;
  logStarted(intervalMs: number, ownerId: string): void;
  logError(message: string, detail?: string): void;
}

export interface StartRunReconcileSchedulerOptions {
  allowInTest?: boolean;
  cacheCleanupIntervalMs?: number;
  concurrency?: number;
}

export const DEFAULT_RUN_RECONCILER_CONCURRENCY = 4;
export const MAX_RUN_RECONCILER_CONCURRENCY = 16;

export function resolveRunReconcilerConcurrency(
  value: unknown = process.env.MYBAY_RUN_RECONCILER_CONCURRENCY,
): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RUN_RECONCILER_CONCURRENCY;
  return Math.max(1, Math.min(parsed, MAX_RUN_RECONCILER_CONCURRENCY));
}

export function resolveRunReconcilerClaimLimit(concurrency: number): number {
  return Math.max(10, Math.min(50, resolveRunReconcilerConcurrency(concurrency) * 3));
}

function instanceSchedulingKey(run: ScheduledRun): string {
  const instanceId = String(run.instance_id || "").trim();
  return instanceId || "__missing_instance__";
}

/** Bounded parallel execution across instances, strict serialization per instance. */
export async function processClaimedRunsByInstance<T extends ScheduledRun>(
  runs: readonly T[],
  concurrency: number,
  processRun: (run: T) => Promise<void>,
): Promise<void> {
  if (runs.length === 0) return;

  const queuesByInstance = new Map<string, T[]>();
  for (const run of runs) {
    const key = instanceSchedulingKey(run);
    const queue = queuesByInstance.get(key);
    if (queue) queue.push(run);
    else queuesByInstance.set(key, [run]);
  }

  const queues = [...queuesByInstance.values()];
  const workerCount = Math.min(resolveRunReconcilerConcurrency(concurrency), queues.length);
  let nextQueueIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const queueIndex = nextQueueIndex++;
      if (queueIndex >= queues.length) return;
      for (const run of queues[queueIndex]) await processRun(run);
    }
  }));
}

export interface RunReconcileScheduler {
  requestReconcile(): boolean;
  start(intervalMs?: number, options?: StartRunReconcileSchedulerOptions): Promise<void>;
  stop(): void;
}

export function createRunReconcileScheduler(
  dependencies: RunReconcileSchedulerDependencies
): RunReconcileScheduler {
  let reconcileTimer: NodeJS.Timeout | null = null;
  let cacheCleanupTimer: NodeJS.Timeout | null = null;
  let isCycleRunning = false;
  let runReconcileCycle: (() => Promise<void>) | null = null;
  let reconcileWakeScheduled = false;
  let reconcileWakePending = false;

  function requestReconcile(): boolean {
    if (!runReconcileCycle) return false;
    reconcileWakePending = true;
    if (reconcileWakeScheduled) return true;
    reconcileWakeScheduled = true;
    queueMicrotask(() => {
      reconcileWakeScheduled = false;
      if (!reconcileWakePending || !runReconcileCycle) return;
      reconcileWakePending = false;
      void runReconcileCycle();
    });
    return true;
  }

  async function start(
    intervalMs = 5000,
    options: StartRunReconcileSchedulerOptions = {}
  ): Promise<void> {
    if (reconcileTimer || (dependencies.isTestEnvironment() && !options.allowInTest)) return;
    const concurrency = resolveRunReconcilerConcurrency(options.concurrency);
    const claimLimit = resolveRunReconcilerClaimLimit(concurrency);
    dependencies.logStarted(intervalMs, dependencies.ownerId);

    runReconcileCycle = async () => {
      if (isCycleRunning) {
        reconcileWakePending = true;
        return;
      }
      isCycleRunning = true;
      const leaseController = dependencies.createLeaseController(claimLimit);
      const leaseLostRuns = leaseController.lostRunIds;

      try {
        const claimedRuns = await leaseController.claim();
        if (claimedRuns.length === 0) return;
        const stopLeaseRenewal = leaseController.startRenewal(claimedRuns);

        try {
          await processClaimedRunsByInstance(claimedRuns, concurrency, async (run) => {
            if (leaseLostRuns.has(run.id)) {
              dependencies.logError(
                `[RunsReconciler] Skipping run ${run.id} processing because lease was lost.`
              );
              return;
            }
            try {
              dependencies.emitClaimed(run);
              await dependencies.processRun(run, leaseLostRuns);
            } catch (error) {
              dependencies.logError(
                `[RunsReconciler] Exception processing run ${run.id}:`,
                error instanceof Error ? error.message : "unknown"
              );
            } finally {
              if (!leaseController.hasLost(run.id)) {
                await leaseController.release(run.id).catch(() => {});
              }
            }
          });
        } finally {
          stopLeaseRenewal();
        }
      } catch (error) {
        dependencies.logError(
          "[RunsReconciler] Reconciliation cycle exception:",
          error instanceof Error ? error.message : "unknown"
        );
      } finally {
        isCycleRunning = false;
        if (reconcileWakePending) requestReconcile();
      }
    };

    reconcileTimer = setInterval(() => { void runReconcileCycle?.(); }, intervalMs);
    reconcileTimer.unref?.();
    cacheCleanupTimer = setInterval(
      dependencies.cleanupInactiveCaches,
      options.cacheCleanupIntervalMs ?? 60000
    );
    cacheCleanupTimer.unref?.();
    void runReconcileCycle();
  }

  function stop(): void {
    if (reconcileTimer) clearInterval(reconcileTimer);
    reconcileTimer = null;
    if (cacheCleanupTimer) clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
    runReconcileCycle = null;
    reconcileWakeScheduled = false;
    reconcileWakePending = false;
    dependencies.clearStreams();
  }

  return { requestReconcile, start, stop };
}

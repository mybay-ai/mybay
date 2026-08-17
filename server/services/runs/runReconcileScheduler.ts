interface ScheduledRun {
  id: string;
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
  createLeaseController(): SchedulerLeaseController;
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
    dependencies.logStarted(intervalMs, dependencies.ownerId);

    runReconcileCycle = async () => {
      if (isCycleRunning) {
        reconcileWakePending = true;
        return;
      }
      isCycleRunning = true;
      const leaseController = dependencies.createLeaseController();
      const leaseLostRuns = leaseController.lostRunIds;

      try {
        const claimedRuns = await leaseController.claim();
        if (claimedRuns.length === 0) return;
        const stopLeaseRenewal = leaseController.startRenewal(claimedRuns);

        try {
          for (const run of claimedRuns) {
            if (leaseLostRuns.has(run.id)) {
              dependencies.logError(
                `[RunsReconciler] Skipping run ${run.id} processing because lease was lost.`
              );
              continue;
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
          }
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

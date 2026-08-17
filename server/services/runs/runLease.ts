export interface RunLeaseContext {
  runId: string;
  ownerId: string;
}

export interface RunLeaseRecord {
  reconciled_by?: string | null;
  lease_expires_at?: string | null;
}

export interface RunLeaseClaimedRun {
  id: string;
}

export interface RunLeaseRepository<TClaimedRun extends RunLeaseClaimedRun> {
  claimRuns(params: {
    reconcilerId: string;
    leaseSeconds: number;
    limit?: number;
  }): Promise<TClaimedRun[]>;
  renewRunLease(params: {
    runId: string;
    reconcilerId: string;
    leaseSeconds: number;
  }): Promise<boolean>;
  releaseRunLease(params: {
    runId: string;
    reconcilerId: string;
  }): Promise<boolean>;
}

export interface RunLeasePolicy {
  leaseSeconds: number;
  claimLimit: number;
  renewIntervalMs: number;
}

export const DEFAULT_RUN_LEASE_POLICY: Readonly<RunLeasePolicy> = Object.freeze({
  leaseSeconds: 60,
  claimLimit: 10,
  renewIntervalMs: 25_000
});

export function hasValidRunLease(
  run: RunLeaseRecord | null | undefined,
  ownerId: string,
  nowMs: number = Date.now()
): boolean {
  if (!run || typeof ownerId !== "string" || ownerId.trim() === "") return false;
  if (run.reconciled_by !== ownerId) return false;

  const expiresAtMs = new Date(run.lease_expires_at ?? "").getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export interface RunLeaseController<TClaimedRun extends RunLeaseClaimedRun> {
  readonly ownerId: string;
  readonly lostRunIds: Set<string>;
  claim(): Promise<TClaimedRun[]>;
  hasLost(runId: string): boolean;
  startRenewal(runs: readonly TClaimedRun[]): () => void;
  release(runId: string): Promise<boolean>;
}

function getErrorMessage(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "message" in error) {
    return (error as { message?: unknown }).message;
  }
  return undefined;
}

export function createRunLeaseController<TClaimedRun extends RunLeaseClaimedRun>(options: {
  repository: RunLeaseRepository<TClaimedRun>;
  ownerId: string;
  policy?: Readonly<RunLeasePolicy>;
  logger?: Pick<Console, "error">;
}): RunLeaseController<TClaimedRun> {
  const {
    repository,
    ownerId,
    policy = DEFAULT_RUN_LEASE_POLICY,
    logger = console
  } = options;
  const lostRunIds = new Set<string>();

  return {
    ownerId,
    lostRunIds,

    claim() {
      return repository.claimRuns({
        reconcilerId: ownerId,
        leaseSeconds: policy.leaseSeconds,
        limit: policy.claimLimit
      });
    },

    hasLost(runId: string) {
      return lostRunIds.has(runId);
    },

    startRenewal(runs: readonly TClaimedRun[]) {
      const renewalTimer = setInterval(async () => {
        for (const run of runs) {
          if (lostRunIds.has(run.id)) continue;
          try {
            const renewed = await repository.renewRunLease({
              runId: run.id,
              reconcilerId: ownerId,
              leaseSeconds: policy.leaseSeconds
            });
            if (!renewed) {
              logger.error(`[RunsReconciler] Lease renewal failed for run ${run.id}.`);
              lostRunIds.add(run.id);
            }
          } catch (renewError: unknown) {
            logger.error(
              `[RunsReconciler] Lease renewal exception for run ${run.id}:`,
              getErrorMessage(renewError)
            );
            lostRunIds.add(run.id);
          }
        }
      }, policy.renewIntervalMs);

      return () => clearInterval(renewalTimer);
    },

    release(runId: string) {
      return repository.releaseRunLease({
        runId,
        reconcilerId: ownerId
      });
    }
  };
}


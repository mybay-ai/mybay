import { randomUUID } from "crypto";

export const INSTANCE_OPERATION_IN_PROGRESS = "INSTANCE_OPERATION_IN_PROGRESS";

export type InstanceOperation =
  | "start"
  | "stop"
  | "restart"
  | "rebuild_proxy"
  | "redeploy"
  | "restore"
  | "delete"
  | "archive"
  | "upgrade"
  | "rollback";

export type InstanceOperationLease = {
  instanceId: string;
  operation: InstanceOperation;
  token: string;
  startedAt: string;
  expiresAt: number;
};

export type InstanceOperationAcquireResult =
  | { acquired: true; lease: InstanceOperationLease }
  | { acquired: false; active: InstanceOperationLease };

const DEFAULT_LEASE_MS = 15 * 60 * 1000;

export class InstanceOperationCoordinator {
  private readonly active = new Map<string, InstanceOperationLease>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createToken: () => string = randomUUID,
  ) {}

  tryAcquire(instanceId: string, operation: InstanceOperation, leaseMs = DEFAULT_LEASE_MS): InstanceOperationAcquireResult {
    const normalizedId = String(instanceId || "").trim();
    if (!normalizedId) throw new Error("Instance operation requires an instance ID.");
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Instance operation lease must be positive.");

    const existing = this.getActive(normalizedId);
    if (existing) return { acquired: false, active: existing };

    const startedAtMs = this.now();
    const lease: InstanceOperationLease = {
      instanceId: normalizedId,
      operation,
      token: this.createToken(),
      startedAt: new Date(startedAtMs).toISOString(),
      expiresAt: startedAtMs + leaseMs,
    };
    this.active.set(normalizedId, lease);
    return { acquired: true, lease };
  }

  getActive(instanceId: string): InstanceOperationLease | null {
    const normalizedId = String(instanceId || "").trim();
    const existing = this.active.get(normalizedId);
    if (!existing) return null;
    if (existing.expiresAt > this.now()) return existing;
    this.active.delete(normalizedId);
    return null;
  }

  release(lease: Pick<InstanceOperationLease, "instanceId" | "token">): boolean {
    const existing = this.active.get(lease.instanceId);
    if (!existing || existing.token !== lease.token) return false;
    this.active.delete(lease.instanceId);
    return true;
  }

  clearForTests(): void {
    this.active.clear();
  }
}

export const instanceOperationCoordinator = new InstanceOperationCoordinator();

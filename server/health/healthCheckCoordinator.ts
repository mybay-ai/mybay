import { dbAdapter } from "../db";

const activeHealthChecks = new Map<string, Promise<unknown>>();

export function clearInstanceHealthCheckCache(instanceId: string) {
  activeHealthChecks.delete(instanceId);
}

export function getActiveInstanceHealthCheck(instanceId: string) {
  return activeHealthChecks.get(instanceId);
}

export function setActiveInstanceHealthCheck(instanceId: string, pending: Promise<unknown>) {
  activeHealthChecks.set(instanceId, pending);
}

export async function runCoalescedInstanceHealthCheck(
  instanceId: string,
  factory: () => Promise<void>,
) {
  const active = activeHealthChecks.get(instanceId);
  if (active) return active;

  const pending = factory();
  activeHealthChecks.set(instanceId, pending);
  try {
    await pending;
  } finally {
    activeHealthChecks.delete(instanceId);
  }
}

export async function updateInstanceHealthStatus(
  updateInstanceStatusStmt: any,
  id: string,
  status: string,
) {
  if (!updateInstanceStatusStmt) return;
  if (typeof updateInstanceStatusStmt.run === "function") {
    await updateInstanceStatusStmt.run({ status, id }).catch(() => {});
  } else if (typeof updateInstanceStatusStmt === "function") {
    await updateInstanceStatusStmt(id, status).catch(() => {});
  } else {
    await dbAdapter.updateInstanceStatus(id, status).catch(() => {});
  }
}

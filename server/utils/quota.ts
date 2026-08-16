export const DEFAULT_FREE_USER_INSTANCE_LIMIT = parseInt(process.env.FREE_MAX_ACTIVE_INSTANCES || "1", 10);

export function resolveInstanceLimit(user: { role: string; instance_limit?: number | null }): number | null {
  if (user.role === 'admin') {
    return null; // Unlimited
  }
  return user.instance_limit ?? DEFAULT_FREE_USER_INSTANCE_LIMIT;
}

export const QUOTA_CONSUMING_STATUSES = new Set([
  "creating",
  "container_starting",
  "dashboard_ready",
  "gateway_starting",
  "gateway_ready",
  "running",
  "partial_running",
  "unhealthy",
  "stopped",
  "deploying",
  "initializing",
  "restarting",
  "failed",
  "starting",
  "pending",
  "provisioning",
  "error",
  "frontend_missing_build"
]);

export function isQuotaConsumingStatus(status: string): boolean {
  if (!status) return false;
  return QUOTA_CONSUMING_STATUSES.has(status.toLowerCase());
}

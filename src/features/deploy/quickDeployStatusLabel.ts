const LOCALIZED_QUICK_DEPLOY_STATUSES = new Set([
  "queued",
  "retry_wait",
  "deploying",
  "provisioning",
  "creating",
  "initializing",
  "container_starting",
  "gateway_starting",
  "gateway_syncing",
  "waiting_web_port",
  "health_checking",
  "partial_running",
]);

export function getQuickDeployStatusTranslationKey(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return LOCALIZED_QUICK_DEPLOY_STATUSES.has(normalized)
    ? `quickDeploy.delivery.statuses.${normalized}`
    : null;
}

export const APP_ROUTES = {
  DASHBOARD: "/app",
  INSTANCES: "/app/instances",
  INSTANCE_SETUP: "/app/instances/:id/setup",
  DEPLOY: "/app/deploy",
  TEMPLATES: "/app/templates",
  CREDENTIALS: "/app/credentials",
  GUIDES: "/app/guides",
  CHAT_WORKSPACE: "/app/chat",
};

export function buildInstanceFilesNavigationUrl(instanceId?: string): string {
  const baseUrl = `${APP_ROUTES.DASHBOARD}?tab=instance-files`;
  return instanceId ? `${baseUrl}&instanceId=${encodeURIComponent(instanceId)}` : baseUrl;
}

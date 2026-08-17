export function requiresDashboardCredentialsForRedeploy(config: any): boolean {
  const dashboardAccessEnabled = config?.enableDashboard !== false;
  const isWeb = config?.channel === "web" || !config?.channel;
  return dashboardAccessEnabled && isWeb;
}

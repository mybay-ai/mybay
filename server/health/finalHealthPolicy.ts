export type FinalHealthStatus = "running" | "gateway_starting" | "dashboard_ready" | "unhealthy";

export type FinalHealthPolicyInput = {
  dashboardAccessEnabled: boolean;
  proxyCheckPassed?: boolean;
  gatewayReady: boolean;
  chatRequired: boolean;
  chatReady: boolean;
  deploymentCheck: boolean;
};

export function shouldCheckDashboardProxy(dashboardAccessEnabled: boolean) {
  return dashboardAccessEnabled;
}

export function resolveFinalHealthStatus(input: FinalHealthPolicyInput): FinalHealthStatus {
  const runtimeReady = input.gatewayReady && (!input.chatRequired || input.chatReady);
  if (!runtimeReady) return input.deploymentCheck ? "unhealthy" : "gateway_starting";
  if (!input.dashboardAccessEnabled) return "running";
  if (input.proxyCheckPassed) return "running";
  return input.deploymentCheck ? "unhealthy" : "dashboard_ready";
}

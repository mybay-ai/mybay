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
  // Deployment health describes the local runtime and its configured access route only.
  // Chat readiness is reported independently so a running container is not mislabeled as
  // a failed deployment while its model/API is still initializing or needs configuration.
  const runtimeReady = input.gatewayReady;
  if (!runtimeReady) return input.deploymentCheck ? "unhealthy" : "gateway_starting";
  if (!input.dashboardAccessEnabled) return "running";
  if (input.proxyCheckPassed) return "running";
  return input.deploymentCheck ? "unhealthy" : "dashboard_ready";
}

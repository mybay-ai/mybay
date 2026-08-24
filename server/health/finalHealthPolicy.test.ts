import { describe, expect, it } from "vitest";
import { resolveFinalHealthStatus, shouldCheckDashboardProxy } from "./finalHealthPolicy";

describe("final health policy", () => {
  it("skips the dashboard proxy and completes a headless web deployment", () => {
    expect(shouldCheckDashboardProxy(false)).toBe(false);
    expect(resolveFinalHealthStatus({
      dashboardAccessEnabled: false,
      gatewayReady: true,
      chatRequired: true,
      chatReady: true,
      deploymentCheck: true,
    })).toBe("running");
  });

  it("still requires the runtime gateway for a headless deployment", () => {
    expect(resolveFinalHealthStatus({
      dashboardAccessEnabled: false,
      gatewayReady: false,
      chatRequired: true,
      chatReady: false,
      deploymentCheck: true,
    })).toBe("unhealthy");
  });

  it("does not turn a running runtime into deployment failure while chat initializes", () => {
    expect(resolveFinalHealthStatus({
      dashboardAccessEnabled: false,
      gatewayReady: true,
      chatRequired: true,
      chatReady: false,
      deploymentCheck: true,
    })).toBe("running");
  });

  it("turns a failed dashboard route into a terminal deployment failure", () => {
    expect(resolveFinalHealthStatus({
      dashboardAccessEnabled: true,
      proxyCheckPassed: false,
      gatewayReady: true,
      chatRequired: false,
      chatReady: false,
      deploymentCheck: true,
    })).toBe("unhealthy");
  });

  it("preserves diagnostic intermediate states for non-deployment checks", () => {
    expect(resolveFinalHealthStatus({
      dashboardAccessEnabled: true,
      proxyCheckPassed: false,
      gatewayReady: true,
      chatRequired: false,
      chatReady: false,
      deploymentCheck: false,
    })).toBe("dashboard_ready");
  });

  it.each([
    { dashboardAccessEnabled: false, gatewayReady: true, proxyCheckPassed: undefined, expected: "running" },
    { dashboardAccessEnabled: false, gatewayReady: false, proxyCheckPassed: undefined, expected: "unhealthy" },
    { dashboardAccessEnabled: true, gatewayReady: true, proxyCheckPassed: true, expected: "running" },
    { dashboardAccessEnabled: true, gatewayReady: true, proxyCheckPassed: false, expected: "unhealthy" },
    { dashboardAccessEnabled: true, gatewayReady: false, proxyCheckPassed: true, expected: "unhealthy" },
  ])("always returns a terminal status for deployment checks", ({ expected, ...input }) => {
    expect(resolveFinalHealthStatus({
      ...input,
      chatRequired: false,
      chatReady: false,
      deploymentCheck: true,
    })).toBe(expected);
  });
});

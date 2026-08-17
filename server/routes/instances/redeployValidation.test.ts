import { describe, expect, it } from "vitest";
import { requiresDashboardCredentialsForRedeploy } from "./redeployValidation";

describe("requiresDashboardCredentialsForRedeploy", () => {
  it("does not require Dashboard credentials when Dashboard access is disabled", () => {
    expect(requiresDashboardCredentialsForRedeploy({ channel: "web", enableDashboard: false })).toBe(false);
    expect(requiresDashboardCredentialsForRedeploy({ enableDashboard: false })).toBe(false);
  });

  it("requires Dashboard credentials for Web instances when Dashboard access is enabled", () => {
    expect(requiresDashboardCredentialsForRedeploy({ channel: "web", enableDashboard: true })).toBe(true);
    expect(requiresDashboardCredentialsForRedeploy({ channel: "web" })).toBe(true);
  });

  it("does not require Dashboard credentials for non-Web channels", () => {
    expect(requiresDashboardCredentialsForRedeploy({ channel: "telegram", enableDashboard: true })).toBe(false);
  });
});

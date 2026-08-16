import { describe, expect, it } from "vitest";
import type { AgentInstance } from "../../types";
import { getInstanceCapabilities } from "./instanceCapabilities";

const instance = (status: AgentInstance["status"], physical_status?: string): AgentInstance => ({
  id: "test-instance",
  name: "Test",
  path: "",
  status,
  physical_status,
  url: "",
  createdAt: ""
});

describe("getInstanceCapabilities", () => {
  it.each(["running", "partial_running", "gateway_ready", "dashboard_ready", "unhealthy"] as const)(
    "allows restart and stop for %s containers",
    (status) => {
      const capabilities = getInstanceCapabilities(instance(status));
      expect(capabilities.canRestart).toBe(true);
      expect(capabilities.canStop).toBe(true);
    }
  );

  it("allows stop but not restart while a running container is transitioning", () => {
    const capabilities = getInstanceCapabilities(instance("gateway_syncing", "running"));
    expect(capabilities.canRestart).toBe(false);
    expect(capabilities.canStop).toBe(true);
  });

  it("only offers start for a stopped container", () => {
    const capabilities = getInstanceCapabilities(instance("stopped", "stopped"));
    expect(capabilities.canStart).toBe(true);
    expect(capabilities.canRestart).toBe(false);
    expect(capabilities.canStop).toBe(false);
  });
});

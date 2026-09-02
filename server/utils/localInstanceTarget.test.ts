import { beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({
  getContainer: vi.fn(),
  getNetwork: vi.fn(),
}));

vi.mock("../lib/docker", () => ({ docker }));

import { invalidateLocalInstanceTarget, resolveLocalInstanceTarget } from "./localInstanceTarget";

function inspect(value: unknown) {
  return vi.fn().mockResolvedValue(value);
}

describe("local instance target resolution", () => {
  beforeEach(() => {
    invalidateLocalInstanceTarget();
    docker.getContainer.mockReset();
    docker.getNetwork.mockReset();
    delete process.env.MYBAY_CONTROL_PANEL_CONTAINER;
  });

  it("uses Docker DNS and caches a verified control-plane network target", async () => {
    const agentInspect = inspect({
      NetworkSettings: { Networks: { "mybay-net-instance-1": { IPAddress: "172.30.0.2" } } },
    });
    const controlInspect = inspect({
      NetworkSettings: { Networks: { "mybay-net-instance-1": { IPAddress: "172.30.0.3" } } },
    });
    docker.getContainer.mockImplementation((name: string) => ({
      inspect: name === "mybay-agent-instance-1" ? agentInspect : controlInspect,
    }));

    await expect(resolveLocalInstanceTarget("instance-1")).resolves.toEqual({
      hostname: "mybay-agent-instance-1",
      port: 8642,
      protocol: "http:",
    });
    await resolveLocalInstanceTarget("instance-1");

    expect(agentInspect).toHaveBeenCalledTimes(1);
    expect(controlInspect).toHaveBeenCalledTimes(1);
    expect(docker.getNetwork).not.toHaveBeenCalled();
  });

  it("coalesces concurrent Docker inspections and reconnects the control plane once", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const agentInspect = inspect({
      NetworkSettings: { Networks: { "mybay-net-instance-2": { IPAddress: "172.31.0.2" } } },
    });
    const controlInspect = inspect({ NetworkSettings: { Networks: {} } });
    docker.getContainer.mockImplementation((name: string) => ({
      id: name === "mybay-local-control-panel" ? "control-id" : "agent-id",
      inspect: name === "mybay-agent-instance-2" ? agentInspect : controlInspect,
    }));
    docker.getNetwork.mockReturnValue({ connect });

    const [first, second] = await Promise.all([
      resolveLocalInstanceTarget("instance-2"),
      resolveLocalInstanceTarget("instance-2"),
    ]);

    expect(first).toEqual(second);
    expect(agentInspect).toHaveBeenCalledTimes(1);
    expect(controlInspect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ Container: "control-id" });
  });

  it("falls back to the inspected bridge address for a host-side control plane", async () => {
    const missingControlPlane = Object.assign(new Error("missing"), { statusCode: 404 });
    docker.getContainer.mockImplementation((name: string) => ({
      inspect: name === "mybay-agent-instance-3"
        ? inspect({ NetworkSettings: { Networks: { bridge: { IPAddress: "172.32.0.2" } } } })
        : vi.fn().mockRejectedValue(missingControlPlane),
    }));

    await expect(resolveLocalInstanceTarget("instance-3")).resolves.toEqual({
      hostname: "172.32.0.2",
      port: 8642,
      protocol: "http:",
    });
  });

  it("refreshes the Docker target after explicit invalidation", async () => {
    const agentInspect = inspect({
      NetworkSettings: { Networks: { "mybay-net-instance-4": { IPAddress: "172.33.0.2" } } },
    });
    const controlInspect = inspect({
      NetworkSettings: { Networks: { "mybay-net-instance-4": { IPAddress: "172.33.0.3" } } },
    });
    docker.getContainer.mockImplementation((name: string) => ({
      inspect: name === "mybay-agent-instance-4" ? agentInspect : controlInspect,
    }));

    await resolveLocalInstanceTarget("instance-4");
    invalidateLocalInstanceTarget("instance-4");
    await resolveLocalInstanceTarget("instance-4");

    expect(agentInspect).toHaveBeenCalledTimes(2);
    expect(controlInspect).toHaveBeenCalledTimes(2);
  });
});

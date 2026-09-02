import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  containerInspect: vi.fn(),
  networkInspect: vi.fn(),
}));

vi.mock("../../lib/docker", () => ({
  docker: {
    getContainer: () => ({ inspect: state.containerInspect }),
    getNetwork: () => ({ inspect: state.networkInspect }),
  },
}));

vi.mock("../../infrastructure/traefik/traefikConfig", () => ({
  parseTraefikEnv: () => ({ isTraefik: false }),
}));

import { verifyNetworkSecurity } from "./dockerNetworkManager";

describe("verifyNetworkSecurity A2A topology", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.containerInspect.mockResolvedValue({
      NetworkSettings: {
        Networks: {
          "mybay-net-agent-1": {},
          "mybay-a2a-internal": {},
        },
      },
    });
    state.networkInspect.mockResolvedValue({
      Internal: true,
      Labels: {
        "com.mybay.managed": "true",
        "com.mybay.purpose": "a2a-collaboration",
      },
    });
  });

  it("accepts the managed internal collaboration network without contradictory warnings", async () => {
    const messages: string[] = [];
    const result = await verifyNetworkSecurity("agent-1", "mybay-agent-agent-1", {
      emit: (_event: string, data: any) => messages.push(data.message),
    });

    expect(result).toBe(true);
    expect(messages.join("\n")).toContain("受控内部网络");
    expect(messages.join("\n")).toContain("网络拓扑校验通过");
    expect(messages.join("\n")).not.toContain("网络隔离检测非理想状态");
    expect(messages.join("\n")).not.toContain("无任何直连链路");
  });
});

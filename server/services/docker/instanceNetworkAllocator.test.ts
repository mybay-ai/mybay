import { describe, expect, it, vi } from "vitest";
import { createInstanceNetworkWithFallback, isDockerAddressPoolExhausted, readConfiguredInstanceNetworkSubnets } from "./instanceNetworkAllocator";

describe("instance network allocation", () => {
  it("validates an explicit list of dedicated private subnets", () => {
    expect(readConfiguredInstanceNetworkSubnets("10.253.1.0/24, 172.30.8.0/24,10.253.1.0/24"))
      .toEqual(["10.253.1.0/24", "172.30.8.0/24"]);
    expect(() => readConfiguredInstanceNetworkSubnets("8.8.8.0/24")).toThrow(/canonical private IPv4/);
    expect(() => readConfiguredInstanceNetworkSubnets("10.253.1.1/24")).toThrow(/canonical private IPv4/);
  });

  it("uses the first non-overlapping configured subnet after Docker exhausts its default pools", async () => {
    const exhausted = new Error("all predefined address pools have been fully subnetted");
    const created = { id: "network-created" };
    const docker = {
      createNetwork: vi.fn().mockRejectedValueOnce(exhausted).mockResolvedValueOnce(created),
      listNetworks: vi.fn().mockResolvedValue([{ IPAM: { Config: [{ Subnet: "10.253.1.0/24" }] } }]),
      getNetwork: vi.fn(),
    } as any;

    await expect(createInstanceNetworkWithFallback(docker, "mybay-net-instance", ["10.253.1.0/24", "10.253.2.0/24"]))
      .resolves.toBe(created);
    expect(docker.createNetwork).toHaveBeenLastCalledWith(expect.objectContaining({
      Name: "mybay-net-instance",
      IPAM: { Config: [{ Subnet: "10.253.2.0/24" }] },
    }));
    expect(docker).not.toHaveProperty("removeNetwork");
  });

  it("fails closed when no dedicated fallback subnet is configured", async () => {
    const exhausted = new Error("all predefined address pools have been fully subnetted");
    const docker = { createNetwork: vi.fn().mockRejectedValue(exhausted) } as any;
    await expect(createInstanceNetworkWithFallback(docker, "mybay-net-instance", []))
      .rejects.toThrow(/MYBAY_INSTANCE_NETWORK_SUBNETS/);
    expect(isDockerAddressPoolExhausted(exhausted)).toBe(true);
  });
});

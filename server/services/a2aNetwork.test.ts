import { describe, expect, it, vi } from "vitest";
import { connectContainerToA2ANetwork } from "./a2aNetwork";

describe("A2A collaboration network", () => {
  it("creates an internal network and connects only the requested container", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const existing = { inspect: vi.fn().mockRejectedValue({ statusCode: 404 }), connect };
    const created = { connect };
    const docker: any = {
      getNetwork: vi.fn().mockReturnValue(existing),
      createNetwork: vi.fn().mockResolvedValue(created),
    };
    await connectContainerToA2ANetwork(docker, "container-1");
    expect(docker.createNetwork).toHaveBeenCalledWith(expect.objectContaining({ Internal: true, Attachable: true }));
    expect(connect).toHaveBeenCalledWith({ Container: "container-1" });
  });
});

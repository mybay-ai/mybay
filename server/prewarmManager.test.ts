import { beforeEach, describe, expect, it, vi } from "vitest";

const { updatePrewarmStatus, inspect, pull, followProgress } = vi.hoisted(() => ({
  updatePrewarmStatus: vi.fn().mockResolvedValue(undefined),
  inspect: vi.fn(),
  pull: vi.fn(),
  followProgress: vi.fn(),
}));
vi.mock("./db", () => ({ dbAdapter: { updatePrewarmStatus } }));
vi.mock("./lib/docker", () => ({
  docker: { getImage: () => ({ inspect }), pull, modem: { followProgress } }
}));

import { PrewarmManager } from "./prewarmManager";

describe("PrewarmManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pulls an uncached image with Dockerode and verifies it", async () => {
    inspect.mockRejectedValueOnce({ statusCode: 404 }).mockResolvedValueOnce({ Id: "sha256:test" });
    pull.mockResolvedValue({});
    followProgress.mockImplementation((_stream, done) => done(null));
    const manager = new PrewarmManager();
    await manager.addToQueue("v2026.7.7", "nousresearch/hermes-agent", "v2026.7.7");
    await vi.waitFor(() => expect(updatePrewarmStatus).toHaveBeenLastCalledWith("v2026.7.7", "cached", true, "nousresearch/hermes-agent"));
    expect(pull).toHaveBeenCalledWith("nousresearch/hermes-agent:v2026.7.7");
  });

  it("marks Docker unavailable as failed and never fabricates cached", async () => {
    inspect.mockRejectedValue({ code: "ECONNREFUSED" });
    const manager = new PrewarmManager();
    await manager.addToQueue("v2026.7.7", "nousresearch/hermes-agent", "v2026.7.7");
    await vi.waitFor(() => expect(updatePrewarmStatus).toHaveBeenCalledWith("v2026.7.7", "failed", false, "nousresearch/hermes-agent"));
    expect(pull).not.toHaveBeenCalled();
    expect(updatePrewarmStatus).not.toHaveBeenCalledWith("v2026.7.7", "cached", true, expect.anything());
  });
});

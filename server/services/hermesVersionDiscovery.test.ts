import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertMyBayVersion, updateAllVersionsLatestFlag } = vi.hoisted(() => ({
  upsertMyBayVersion: vi.fn(),
  updateAllVersionsLatestFlag: vi.fn(),
}));
vi.mock("../db", () => ({ dbAdapter: { upsertMyBayVersion, updateAllVersionsLatestFlag } }));

import { discoverHermesVersions } from "./hermesVersionDiscovery";

describe("Hermes version discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MY_BAY_INCLUDE_PRERELEASE;
  });

  it("normalizes, sorts and idempotently upserts stable releases", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { tag_name: "v2026.7.7", name: "Hermes Agent v0.20.1", prerelease: false, published_at: "2026-07-07T00:00:00Z" },
      { tag_name: "v2026.7.7.2", prerelease: false, published_at: "2026-07-08T00:00:00Z" },
      { tag_name: "v2026.8.0-rc.1", prerelease: true },
    ]), { status: 200 }));
    const result = await discoverHermesVersions(fetchImpl as any);
    expect(result.releases).toEqual(["v2026.7.7.2", "v2026.7.7"]);
    expect(upsertMyBayVersion).toHaveBeenCalledTimes(2);
    expect(upsertMyBayVersion.mock.calls[0][0].id).toContain("v2026.7.7.2");
    expect(upsertMyBayVersion.mock.calls[0][0].image).toBe("nousresearch/hermes-agent");
    expect(upsertMyBayVersion.mock.calls[1][0].version).toBe("v2026.7.7");
    expect(updateAllVersionsLatestFlag).toHaveBeenCalledWith("v2026.7.7.2");
  });

  it("discovers SemVer tags from tag_name without consulting the release title", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { tag_name: "v0.20.1", name: "Hermes Agent 2026.8.13", prerelease: false },
      { tag_name: "0.20.0", name: "Older release", prerelease: false },
    ]), { status: 200 }));
    const result = await discoverHermesVersions(fetchImpl as any);
    expect(result.releases).toEqual(["v0.20.1", "0.20.0"]);
    expect(updateAllVersionsLatestFlag).toHaveBeenCalledWith("v0.20.1");
  });

  it("persists the stable capability matrix for the latest release", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { tag_name: "v2026.8.31", prerelease: false, published_at: "2026-08-31T19:29:49Z" },
    ]), { status: 200 }));

    await discoverHermesVersions(fetchImpl as any);

    expect(upsertMyBayVersion).toHaveBeenCalledWith(expect.objectContaining({
      version: "v2026.8.31",
      capabilities: expect.arrayContaining([
        "a2a",
        "bot_mode",
        "peer_dm",
        "group_rooms",
        "cron_continuity",
        "subagent_steering",
      ]),
    }));
  });

  it("does not change local metadata when the upstream request fails", async () => {
    await expect(discoverHermesVersions(vi.fn().mockRejectedValue(new Error("offline")) as any)).rejects.toMatchObject({ code: "VERSION_DISCOVERY_FAILED" });
    expect(upsertMyBayVersion).not.toHaveBeenCalled();
    expect(updateAllVersionsLatestFlag).not.toHaveBeenCalled();
  });
});

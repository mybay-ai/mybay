import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyBayVersions } = vi.hoisted(() => ({ getMyBayVersions: vi.fn() }));
vi.mock("./db", () => ({ dbAdapter: { getMyBayVersions } }));

import { isVersionCompatibleWithFeishu, resolveLatestTag } from "./upgradeManager";

describe("official Hermes Feishu upgrades", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves latest to the newest compatible official version without requiring prewarm", async () => {
    getMyBayVersions.mockResolvedValue([
      { version: "v2026.7.7", image: "nousresearch/hermes-agent", image_tag: "v2026.7.7", capabilities: ["core", "feishu"], is_prewarmed: false },
      { version: "v2026.7.7.2", image: "nousresearch/hermes-agent", image_tag: "v2026.7.7.2", capabilities: ["core", "feishu"], is_prewarmed: false },
    ]);
    expect(await resolveLatestTag(true)).toBe("v2026.7.7.2");
  });

  it("blocks a target that lacks Feishu capability", () => {
    expect(isVersionCompatibleWithFeishu({ version: "v0.15.1", capabilities: ["core"] })).toBe(false);
    expect(isVersionCompatibleWithFeishu({ version: "v2026.7.7", capabilities: ["core", "feishu"] })).toBe(true);
  });
});

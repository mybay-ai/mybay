import { describe, expect, it } from "vitest";
import { normalizeAgentUpgradePhase } from "./agentUpgradePhase";

describe("normalizeAgentUpgradePhase", () => {
  it("preserves structured lifecycle phases", () => {
    expect(normalizeAgentUpgradePhase("pulling_image", "upgrading")).toBe("pulling_image");
    expect(normalizeAgentUpgradePhase("rolling_back", "failed")).toBe("rolling_back");
  });

  it("falls back to legacy upgrade statuses", () => {
    expect(normalizeAgentUpgradePhase(null, "upgrading")).toBe("queued");
    expect(normalizeAgentUpgradePhase(null, "success")).toBe("completed");
    expect(normalizeAgentUpgradePhase(null, "failed")).toBe("failed");
    expect(normalizeAgentUpgradePhase(null, null)).toBe("idle");
  });
});

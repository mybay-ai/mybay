import { describe, expect, it } from "vitest";
import {
  getA2AInternalUrl,
  isValidA2AAgentName,
  isValidA2ACapability,
  normalizeA2AAgentName,
  normalizeA2APeerCapabilities,
  normalizeA2APeerIds,
  supportsA2AByVersion,
} from "./a2aConfig";

describe("A2A control-plane policy", () => {
  it("normalizes safe names and peer ids", () => {
    expect(normalizeA2AAgentName("  Research   Bot ", "fallback")).toBe("Research Bot");
    expect(isValidA2AAgentName("Research Bot")).toBe(true);
    expect(isValidA2AAgentName("bad\nname")).toBe(false);
    expect(normalizeA2APeerIds(["peer-1", "self", "peer-1", "../bad"], "self")).toEqual(["peer-1"]);
  });

  it("gates A2A by a stable release or explicit metadata", () => {
    expect(supportsA2AByVersion("v2026.7.30")).toBe(false);
    expect(supportsA2AByVersion("v2026.8.3")).toBe(true);
    expect(supportsA2AByVersion("legacy", ["core", "a2a"])).toBe(true);
  });

  it("normalizes bounded capability tags only for selected peers", () => {
    expect(isValidA2ACapability("Research-Review")).toBe(true);
    expect(isValidA2ACapability("bad capability!")).toBe(false);
    expect(normalizeA2APeerCapabilities({
      "peer-1": [" Research ", "review", "research"],
      "peer-2": ["ignored"],
    }, ["peer-1"])).toEqual({ "peer-1": ["research", "review"] });
  });

  it("uses the private collaboration DNS name", () => {
    expect(getA2AInternalUrl("instance-1")).toBe("http://mybay-agent-instance-1:9900");
  });
});

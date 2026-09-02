import { describe, expect, it } from "vitest";
import {
  inferAgentVersionCapabilities,
  orderAgentVersionCapabilities,
  parseAgentVersionCapabilities,
} from "./agentVersionCapabilities";

describe("Agent version capability matrix", () => {
  it("parses legacy database shapes", () => {
    expect(parseAgentVersionCapabilities('["core","A2A"]')).toEqual(["core", "a2a"]);
    expect(parseAgentVersionCapabilities("core, peer_dm")).toEqual(["core", "peer_dm"]);
  });

  it("keeps pre-A2A releases conservative", () => {
    expect(inferAgentVersionCapabilities("v2026.7.30")).toEqual([]);
    expect(inferAgentVersionCapabilities("latest")).toEqual([]);
  });

  it("supports both calendar tags and package semver labels", () => {
    expect(inferAgentVersionCapabilities("v2026.8.3")).toEqual([
      "a2a",
      "outbound_webhooks",
      "agent_redirects",
    ]);
    expect(inferAgentVersionCapabilities("v0.20.0")).toEqual([
      "a2a",
      "outbound_webhooks",
      "agent_redirects",
    ]);
  });

  it("orders known capabilities before unknown extensions", () => {
    expect(orderAgentVersionCapabilities(["z_custom", "a2a", "core", "a2a"])).toEqual([
      "core",
      "a2a",
      "z_custom",
    ]);
  });
});

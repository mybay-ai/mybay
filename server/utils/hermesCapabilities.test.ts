import { describe, expect, it } from "vitest";
import { HERMES_NATIVE_FEISHU_MIN_VERSION, getHermesCapabilities, supportsFeishu } from "./hermesCapabilities";

describe("Hermes capabilities", () => {
  it("allows modern official Hermes for core and Feishu", () => {
    expect(supportsFeishu({ version: HERMES_NATIVE_FEISHU_MIN_VERSION })).toBe(true);
    expect(getHermesCapabilities({ version: HERMES_NATIVE_FEISHU_MIN_VERSION })).toEqual(["core", "feishu"]);
  });

  it("blocks an older official Hermes version without metadata", () => {
    expect(supportsFeishu({ version: "v0.15.1" })).toBe(false);
    expect(getHermesCapabilities({ version: "v0.15.1" })).toEqual(["core"]);
  });

  it("keeps explicit legacy metadata readable", () => {
    expect(supportsFeishu({ version: "v0.15.1-feishu" })).toBe(true);
    expect(supportsFeishu({ version: "v0.15.1", capabilities: ["core", "lark"] })).toBe(true);
  });

  it("infers the stable A2A release capabilities without dropping explicit metadata", () => {
    expect(getHermesCapabilities({ version: "v2026.8.3", capabilities: ["custom_connector"] })).toEqual([
      "core",
      "feishu",
      "a2a",
      "outbound_webhooks",
      "agent_redirects",
      "custom_connector",
    ]);
  });

  it("only advertises the complete Bot Mode surface at the v0.21 stable boundary", () => {
    expect(getHermesCapabilities({ version: "v2026.8.27" })).not.toContain("bot_mode");
    expect(getHermesCapabilities({ version: "v2026.8.31" })).toEqual(expect.arrayContaining([
      "a2a",
      "bot_mode",
      "peer_dm",
      "group_rooms",
      "cron_continuity",
      "subagent_steering",
      "browser_control",
      "gateway_control",
    ]));
    expect(getHermesCapabilities({ version: "v0.21.0" })).toContain("bot_mode");
  });
});

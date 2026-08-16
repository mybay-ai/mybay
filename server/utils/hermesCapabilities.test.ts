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
});

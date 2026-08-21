import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  FEISHU_RUNTIME_RECIPE_REVISION,
  requiresLocalFeishuRuntime,
  resolveLocalFeishuImageRef,
} from "./localFeishuRuntime";

describe("local Feishu runtime", () => {
  it("detects Feishu and Lark channel configurations", () => {
    expect(requiresLocalFeishuRuntime({ channel: "feishu" })).toBe(true);
    expect(requiresLocalFeishuRuntime({ configuredChannels: "telegram,lark" })).toBe(true);
    expect(requiresLocalFeishuRuntime({ skills: ["feishu_adapter"] })).toBe(true);
    expect(requiresLocalFeishuRuntime({ channel: "telegram" })).toBe(false);
  });

  it("derives a stable local image without replacing the selected Hermes version", () => {
    const first = resolveLocalFeishuImageRef("nousresearch/hermes-agent", "v2026.8.13");
    const second = resolveLocalFeishuImageRef("nousresearch/hermes-agent", "v2026.8.13");
    expect(first).toBe(second);
    expect(first).toMatch(/^mybay\/hermes-agent-feishu:v2026\.8\.13-[a-f0-9]{12}$/);
  });

  it("ships a pinned and self-verifying Feishu dependency recipe", () => {
    const dockerfile = fs.readFileSync(path.resolve(process.cwd(), "Dockerfile.feishu"), "utf8");
    expect(dockerfile).toContain('"lark-oapi==1.6.8"');
    expect(dockerfile).toContain('"qrcode==7.4.2"');
    expect(dockerfile).toContain("import aiohttp, lark_oapi, qrcode, websockets");
    expect(dockerfile).toContain(`MYBAY_FEISHU_RECIPE_REVISION=${FEISHU_RUNTIME_RECIPE_REVISION}`);
  });
});

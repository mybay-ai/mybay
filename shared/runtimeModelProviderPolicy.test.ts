import { describe, expect, it } from "vitest";
import { resolvePiRuntimeProvider, supportsQuickDeployRuntimeProvider } from "./runtimeModelProviderPolicy";

describe("runtime model provider policy", () => {
  it("allows only OpenAI OAuth alongside supported Codex API providers", () => {
    expect(supportsQuickDeployRuntimeProvider("codex", "openai-codex")).toBe(true);
    expect(supportsQuickDeployRuntimeProvider("codex", "xai-oauth")).toBe(false);
    expect(supportsQuickDeployRuntimeProvider("codex", "deepseek")).toBe(false);
  });
  it("normalizes Pi provider aliases used by the runtime adapter", () => {
    expect(resolvePiRuntimeProvider("openai-api")).toBe("openai");
    expect(resolvePiRuntimeProvider("gemini")).toBe("google");
    expect(resolvePiRuntimeProvider("deepseek")).toBe("deepseek");
  });

  it("keeps unsupported OAuth and custom providers out of Pi quick deploy", () => {
    expect(supportsQuickDeployRuntimeProvider("pi", "openai-codex")).toBe(false);
    expect(supportsQuickDeployRuntimeProvider("pi", "xai-oauth")).toBe(false);
    expect(supportsQuickDeployRuntimeProvider("pi", "custom-openai-compatible")).toBe(false);
    expect(supportsQuickDeployRuntimeProvider("pi", "openai")).toBe(true);
    expect(supportsQuickDeployRuntimeProvider("hermes", "custom-openai-compatible")).toBe(true);
  });
});

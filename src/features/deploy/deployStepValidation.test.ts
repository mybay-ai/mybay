import { describe, expect, it } from "vitest";
import { hasBasicStepError, hasModelStepError, requiresPredeployModelTest } from "./deployStepValidation";

describe("hasBasicStepError", () => {
  it("does not require Dashboard credentials when Dashboard access is disabled", () => {
    expect(hasBasicStepError({ name: "headless-agent", enableDashboard: false })).toBe(false);
  });

  it("still requires a name when Dashboard access is disabled", () => {
    expect(hasBasicStepError({ enableDashboard: false })).toBe(true);
  });

  it("requires valid Dashboard credentials when Dashboard access is enabled", () => {
    expect(hasBasicStepError({ name: "web-agent", enableDashboard: true })).toBe(true);
    expect(hasBasicStepError({
      name: "web-agent",
      enableDashboard: true,
      username: "admin",
      password: "password-123",
    })).toBe(false);
  });
});

describe("model step validation", () => {
  it("allows supported OAuth providers to continue without a predeploy API test", () => {
    expect(requiresPredeployModelTest("openai-codex")).toBe(false);
    expect(requiresPredeployModelTest("xai-oauth")).toBe(false);
    expect(hasModelStepError({ provider: "openai-codex", model: "gpt-5.5" }, false)).toBe(false);
    expect(hasModelStepError({ provider: "xai-oauth", model: "grok-4.5" }, false)).toBe(false);
  });

  it("still requires credentials and a successful test for API-key providers", () => {
    expect(hasModelStepError({ provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" }, false)).toBe(true);
    expect(hasModelStepError({
      provider: "together",
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      providerApiKey: "test-key"
    }, false)).toBe(true);
    expect(hasModelStepError({
      provider: "together",
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      providerApiKey: "test-key"
    }, true)).toBe(false);
  });

  it("requires a base URL for a custom OpenAI-compatible provider", () => {
    expect(hasModelStepError({ provider: "custom-openai-compatible", model: "my-model" }, true)).toBe(true);
  });
});

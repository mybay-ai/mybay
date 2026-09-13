import { describe, expect, it } from "vitest";
import { transitionDeployRuntime } from "./deployRuntimeTransition";
import { hasModelStepError } from "./deployStepValidation";
import { buildLocalDeploymentRequest } from "./localDeploymentRequestAdapter";

describe("Codex runtime transition", () => {
  it("clears old model credentials and requires OAuth authorization", () => {
    const original = { runtime_type: "hermes", provider: "deepseek", model: "deepseek-v4-flash", providerApiKey: "fixture", providerCredentialId: "old-credential" };
    const next = transitionDeployRuntime(original, "codex");
    expect(next.provider).toBe("openai-codex");
    expect(next.providerCredentialId).toBe("");
    expect(next.providerApiKey).toBe("");
    expect(next.enableDashboard).toBe(false);
    expect(hasModelStepError(next, true)).toBe(true);
    expect(original.providerApiKey).toBe("fixture");
  });
  it("rejects a provider outside the Codex Responses policy", () => {
    expect(hasModelStepError({ runtime_type: "codex", provider: "anthropic", model: "claude-test", providerApiKey: "fixture" }, true)).toBe(true);
  });
  it("clears Codex authentication when leaving the runtime", () => {
    const next = transitionDeployRuntime({ runtime_type: "codex", provider: "openai-codex", providerCredentialId: "oauth", codexAuthJson: "fixture" }, "pi");
    expect(next.providerCredentialId).toBe("");
    expect(next.codexAuthJson).toBeUndefined();
    expect(next.provider).toBe("openai");
  });
  it("preserves the authorized Codex provider in the deployment payload", () => {
    const draft = { ...transitionDeployRuntime({}, "codex"), providerCredentialId: "oauth-fixture" };
    const request = buildLocalDeploymentRequest({ draft, idempotencyKey: "test-key-123", permissionConfirmed: true });
    expect(request.body.provider).toBe("openai-codex");
    expect(request.body.codexAuthMode).toBe("api");
    expect(request.body.providerCredentialId).toBe("oauth-fixture");
  });
});

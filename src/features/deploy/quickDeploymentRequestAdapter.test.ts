import { describe, expect, it } from "vitest";
import { createQuickDeployDraft } from "./quickDeployConfig";
import { buildQuickDeployAdvancedInitialData } from "./quickDeployAdvancedHandoff";
import { buildQuickDeploymentRequest } from "./quickDeploymentRequestAdapter";
import { QuickDeployValidationError } from "./quickDeployTypes";

function validDraft() {
  const draft = createQuickDeployDraft({ suffix: "request", password: "password-123" });
  draft.name = "Quick Agent";
  draft.purpose = "Summarize my local documents";
  draft.modelStrategy = { mode: "saved_credential", credentialId: "credential-1", provider: "deepseek", model: "deepseek-v4-flash" };
  draft.selectedSkillIds = ["file_read"];
  draft.permissionConfirmed = true;
  return draft;
}

describe("quick deployment request adapter", () => {
  it("reuses the canonical local instance create request", () => {
    const request = buildQuickDeploymentRequest({
      draft: validDraft(),
      path: "quick-agent-request",
      idempotencyKey: "quick-deploy-request-1",
    });
    expect(request.path).toBe("/api/instances");
    expect(request.options.headers["Idempotency-Key"]).toBe("quick-deploy-request-1");
    expect(request.body).toMatchObject({
      runtime_type: "hermes",
      name: "Quick Agent",
      path: "quick-agent-request",
      channel: "web",
      allowMode: "disabled",
      enableDashboard: true,
      providerCredentialId: "credential-1",
      modelBillingMode: "byok",
      skills: ["file_read"],
      confirmed_skill_ids: ["file_read"],
    });
    expect(request.body).not.toHaveProperty("permissionConfirmed");
  });

  it("preserves BYOK values when handing off to the advanced wizard", () => {
    const draft = validDraft();
    draft.modelStrategy = { mode: "byok", provider: "custom-openai-compatible", model: "local-model", apiKey: "local-key", baseUrl: "http://model.local/v1", isCustomModel: true };
    expect(buildQuickDeployAdvancedInitialData(draft, "advanced-path")).toMatchObject({
      name: "Quick Agent",
      path: "advanced-path",
      provider: "custom-openai-compatible",
      model: "local-model",
      providerApiKey: "local-key",
      baseUrl: "http://model.local/v1",
      prompt: "Summarize my local documents",
    });
  });

  it("does not mutate the quick draft", () => {
    const draft = validDraft();
    const before = structuredClone(draft);
    buildQuickDeploymentRequest({ draft, path: "immutable-path", idempotencyKey: "quick-deploy-request-2" });
    expect(draft).toEqual(before);
  });

  it("rejects invalid drafts before reaching the local request adapter", () => {
    const draft = validDraft();
    draft.permissionConfirmed = false;
    expect(() => buildQuickDeploymentRequest({
      draft,
      path: "denied-path",
      idempotencyKey: "quick-deploy-request-3",
    })).toThrow(QuickDeployValidationError);
  });
});

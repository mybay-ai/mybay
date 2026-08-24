import { describe, expect, it } from "vitest";
import { buildLocalDeploymentRequest, LOCAL_INSTANCE_CREATE_PATH } from "./localDeploymentRequestAdapter";

describe("local deployment request adapter", () => {
  it("builds the existing instance create request with an idempotency header", () => {
    const request = buildLocalDeploymentRequest({
      draft: {
        name: "local-agent",
        channel: "web",
        provider: "deepseek",
        model: "deepseek-chat",
        providerApiKey: "manual-key",
        skills: ["web_search"],
      },
      idempotencyKey: "deploy-request-123",
      permissionConfirmed: true,
    });

    expect(request.path).toBe(LOCAL_INSTANCE_CREATE_PATH);
    expect(request.options).toEqual({ headers: { "Idempotency-Key": "deploy-request-123" } });
    expect(request.body).toMatchObject({
      name: "local-agent",
      channel: "web",
      modelBillingMode: "byok",
      confirmed_skill_ids: ["web_search"],
    });
  });

  it("applies the same whitelist and channel isolation as ordinary deployment", () => {
    const request = buildLocalDeploymentRequest({
      draft: {
        channel: "telegram",
        telegramBotToken: "telegram-secret",
        feishuAppSecret: "must-not-cross-boundary",
        platformModelId: "hosted-model",
        template_inputs_error: "ui-only",
        proxyMode: "preflight-only",
      } as any,
      idempotencyKey: "deploy-request-456",
      permissionConfirmed: true,
    });

    expect(request.body.telegramBotToken).toBe("telegram-secret");
    expect(request.body).not.toHaveProperty("feishuAppSecret");
    expect(request.body).not.toHaveProperty("platformModelId");
    expect(request.body).not.toHaveProperty("template_inputs_error");
    expect(request.body).not.toHaveProperty("proxyMode");
    expect(request.body).not.toHaveProperty("trust_permission_confirmed");
    expect(request.body).not.toHaveProperty("trust_permission_confirmed_at");
  });

  it("does not mutate the deployment form draft", () => {
    const draft = {
      channel: "feishu",
      feishuAppId: "cli_local",
      feishuAppSecret: "secret",
      skills: ["web_search"],
    };
    const before = structuredClone(draft);
    const request = buildLocalDeploymentRequest({
      draft,
      idempotencyKey: "deploy-request-789",
      permissionConfirmed: true,
    });

    expect(draft).toEqual(before);
    expect(request.body.skills).not.toBe(draft.skills);
    expect(request.body.confirmed_skill_ids).not.toBe(draft.skills);
  });

  it("produces the same request for any local UI using the same draft", () => {
    const input = {
      draft: { channel: "web", provider: "deepseek", providerCredentialId: "credential-1", skills: [] },
      idempotencyKey: "deploy-request-equivalent",
      permissionConfirmed: true,
    };
    expect(buildLocalDeploymentRequest(input)).toEqual(buildLocalDeploymentRequest({ ...input, draft: { ...input.draft } }));
  });

  it("fails closed when permission review or idempotency is missing", () => {
    expect(() => buildLocalDeploymentRequest({
      draft: { channel: "web" },
      idempotencyKey: "deploy-request-denied",
      permissionConfirmed: false,
    })).toThrow("LOCAL_DEPLOY_PERMISSION_CONFIRMATION_REQUIRED");
    expect(() => buildLocalDeploymentRequest({
      draft: { channel: "web" },
      idempotencyKey: "short",
      permissionConfirmed: true,
    })).toThrow("INVALID_IDEMPOTENCY_KEY");
  });
});

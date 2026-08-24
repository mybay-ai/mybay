import { describe, expect, it } from "vitest";
import { sanitizeDeployPayload } from "./sanitizeDeployPayload";

describe("sanitizeDeployPayload", () => {
  it("keeps only the explicit local deployment contract", () => {
    const payload = sanitizeDeployPayload({
      runtime_type: "hermes",
      name: "local-agent",
      path: "agent-local",
      username: "admin",
      password: "local-password",
      image: "nousresearch/hermes-agent",
      imageTag: "latest",
      port: "10101",
      enableDashboard: true,
      limitsCpu: "1",
      limitsMem: "1024MB",
      limitsDiskMb: 2048,
      provider: "deepseek",
      model: "deepseek-chat",
      providerApiKey: "sk-local",
      baseUrl: "https://api.deepseek.com/v1",
      channel: "web",
      skills: ["web_search"],
      prompt: "local prompt",
      platformModelId: "hosted-model",
      platformModelName: "Hosted Model",
      modelCreditMultiplier: 99,
      template_inputs_error: "ui-only",
      id: "ui-generated-id",
      proxyMode: "server-ui-state",
      unexpected: "must-not-cross-boundary",
    } as any);

    expect(payload).toMatchObject({
      runtime_type: "hermes",
      name: "local-agent",
      path: "agent-local",
      port: "10101",
      limitsDiskMb: 2048,
      provider: "deepseek",
      providerApiKey: "sk-local",
      channel: "web",
      prompt: "local prompt",
      modelBillingMode: "byok",
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("proxyMode");
    expect(payload).not.toHaveProperty("platformModelId");
    expect(payload).not.toHaveProperty("modelCreditMultiplier");
    expect(payload).not.toHaveProperty("template_inputs_error");
    expect(payload).not.toHaveProperty("unexpected");
  });

  it.each(["desktop", "lan", "server"])("keeps %s preflight mode server-owned", (deploymentMode) => {
    const payload = sanitizeDeployPayload({
      name: "mode-safe-agent",
      channel: "web",
      deploymentMode,
      proxyMode: deploymentMode === "server" ? "traefik" : "local",
      lanAddress: "192.168.1.10",
      serverDomain: "agent.example.test",
    } as any);
    expect(payload).toEqual({ name: "mode-safe-agent", channel: "web", modelBillingMode: "byok" });
  });

  it("keeps only the selected channel credentials", () => {
    const payload = sanitizeDeployPayload({
      channel: "feishu",
      feishuAppId: "cli_local",
      feishuAppSecret: "feishu-secret",
      feishuRegion: "feishu",
      telegramBotToken: "telegram-secret",
      slackBotToken: "slack-secret",
    } as any);

    expect(payload.feishuAppId).toBe("cli_local");
    expect(payload.feishuAppSecret).toBe("feishu-secret");
    expect(payload).not.toHaveProperty("telegramBotToken");
    expect(payload).not.toHaveProperty("slackBotToken");
  });

  it("maps Lark to the Feishu credential field group", () => {
    const payload = sanitizeDeployPayload({
      channel: "lark",
      feishuAppId: "cli_lark",
      feishuAppSecret: "lark-secret",
      feishuRegion: "lark",
    });
    expect(payload).toMatchObject({
      channel: "lark",
      feishuAppId: "cli_lark",
      feishuAppSecret: "lark-secret",
      feishuRegion: "lark",
    });
  });

  it("removes every channel secret for web and none deployments", () => {
    for (const channel of ["web", "none"]) {
      const payload = sanitizeDeployPayload({
        channel,
        telegramBotToken: "telegram-secret",
        webhookSecret: "webhook-secret",
        weixinToken: "weixin-secret",
      } as any);
      expect(payload).not.toHaveProperty("telegramBotToken");
      expect(payload).not.toHaveProperty("webhookSecret");
      expect(payload).not.toHaveProperty("weixinToken");
    }
  });

  it("supports both manual and saved BYOK credential selection", () => {
    expect(sanitizeDeployPayload({
      provider: "deepseek",
      providerApiKey: "manual-key",
      providerCredentialId: "",
    })).toMatchObject({ providerApiKey: "manual-key", providerCredentialId: "", modelBillingMode: "byok" });

    expect(sanitizeDeployPayload({
      provider: "deepseek",
      providerApiKey: "",
      providerCredentialId: "credential-1",
    })).toMatchObject({ providerApiKey: "", providerCredentialId: "credential-1", modelBillingMode: "byok" });
  });

  it("preserves local template inputs but not client-derived slugs or consent UI state", () => {
    const payload = sanitizeDeployPayload({
      template_id: "template-1",
      template_slug: "client-slug",
      blueprint_id: "blueprint-1",
      blueprint_slug: "client-blueprint-slug",
      template_inputs: { topic: "local" },
      template_consent_ok: true,
    });
    expect(payload).toMatchObject({
      template_id: "template-1",
      blueprint_id: "blueprint-1",
      template_inputs: { topic: "local" },
    });
    expect(payload).not.toHaveProperty("template_slug");
    expect(payload).not.toHaveProperty("blueprint_slug");
    expect(payload).not.toHaveProperty("template_consent_ok");
  });
});

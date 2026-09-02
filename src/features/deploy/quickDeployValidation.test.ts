import { describe, expect, it } from "vitest";
import { createQuickDeployDraft } from "./quickDeployConfig";
import { canSubmitQuickDeploy, validateQuickDeployDraft } from "./quickDeployValidation";

function validDraft() {
  const draft = createQuickDeployDraft({ suffix: "valid", password: "password-123" });
  draft.modelStrategy = { mode: "saved_credential", credentialId: "credential-1", provider: "deepseek", model: "deepseek-v4-flash" };
  draft.permissionConfirmed = true;
  return draft;
}

describe("quick deployment validation", () => {
  it("accepts the Hermes Web saved-credential happy path", () => {
    expect(validateQuickDeployDraft(validDraft())).toEqual([]);
    expect(canSubmitQuickDeploy(validDraft())).toBe(true);
  });

  it("requires a BYOK secret only for providers that need one", () => {
    const draft = validDraft();
    draft.modelStrategy = { mode: "byok", provider: "deepseek", model: "deepseek-v4-flash" };
    expect(validateQuickDeployDraft(draft)).toContainEqual(expect.objectContaining({ code: "apiKeyRequired" }));
    draft.modelStrategy = { mode: "byok", provider: "openai-codex", model: "gpt-5.5" };
    expect(validateQuickDeployDraft(draft)).not.toContainEqual(expect.objectContaining({ code: "apiKeyRequired" }));
    expect(validateQuickDeployDraft(draft)).toContainEqual(expect.objectContaining({ code: "oauthCredentialRequired" }));
  });

  it("accepts completed OpenAI and xAI OAuth credentials", () => {
    const draft = validDraft();
    draft.modelStrategy = { mode: "saved_credential", credentialId: "oauth-openai", provider: "openai-codex", model: "gpt-5.5" };
    expect(validateQuickDeployDraft(draft)).toEqual([]);
    draft.modelStrategy = { mode: "saved_credential", credentialId: "oauth-xai", provider: "xai-oauth", model: "grok-4.5" };
    expect(validateQuickDeployDraft(draft)).toEqual([]);
  });

  it("fails closed and routes unsupported runtime, channels, and sensitive skills to advanced setup", () => {
    const draft = validDraft() as any;
    draft.runtimeType = "opencode";
    draft.entrypoint = "telegram";
    draft.selectedSkillIds = ["file_read", "docker", "unknown-skill"];
    const issues = validateQuickDeployDraft(draft);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "unsupportedRuntime",
      "unsupportedEntrypoint",
      "skillRequiresAdvancedConfiguration",
    ]));
    expect(issues.filter((issue) => issue.requiresAdvanced)).toHaveLength(3);
  });

  it("requires explicit permission confirmation", () => {
    const draft = validDraft();
    draft.permissionConfirmed = false;
    expect(validateQuickDeployDraft(draft)).toContainEqual(expect.objectContaining({ code: "permissionConfirmationRequired" }));
  });

  it("requires credentials for each supported external quick-deploy channel", () => {
    const telegram = validDraft();
    telegram.channel = "telegram";
    expect(validateQuickDeployDraft(telegram)).toContainEqual(expect.objectContaining({ code: "telegramBotTokenRequired" }));
    telegram.telegramBotToken = "123456:telegram-token";
    expect(validateQuickDeployDraft(telegram)).toEqual([]);

    const feishu = validDraft();
    feishu.channel = "feishu";
    expect(validateQuickDeployDraft(feishu)).toContainEqual(expect.objectContaining({ code: "feishuCredentialsRequired" }));
    feishu.feishuAppId = "cli_local";
    feishu.feishuAppSecret = "feishu-secret";
    expect(validateQuickDeployDraft(feishu)).toEqual([]);

    const weixin = validDraft();
    weixin.channel = "weixin";
    expect(validateQuickDeployDraft(weixin)).toContainEqual(expect.objectContaining({ code: "weixinCredentialsRequired" }));
    weixin.weixinAccountId = "wx-account";
    weixin.weixinToken = "wx-token";
    expect(validateQuickDeployDraft(weixin)).toEqual([]);
  });

  it("routes channels outside the quick-deploy set to advanced setup", () => {
    const draft = validDraft() as any;
    draft.channel = "slack";
    expect(validateQuickDeployDraft(draft)).toContainEqual(expect.objectContaining({
      code: "unsupportedChannel",
      requiresAdvanced: true,
    }));
  });
});

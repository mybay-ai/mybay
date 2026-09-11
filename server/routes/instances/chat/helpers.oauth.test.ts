import { describe, expect, it } from "vitest";
import { encrypt } from "../../../crypto";
import { buildAssistContext, resolveQuickChatModelConfig } from "./helpers";

function codexAuth() {
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      account_id: "account-1",
    },
  });
}

describe("Codex OAuth direct chat configuration", () => {
  it("uses encrypted Codex account auth for direct chat", async () => {
    const result = await resolveQuickChatModelConfig(
      { runtime_type: "codex", model_name: "gpt-6-astra" },
      { provider: "openai", codexAuthMode: "chatgpt", model: "gpt-6-astra", codexAuthJson: encrypt(codexAuth()) },
    );

    expect(result).toMatchObject({
      provider: "openai-codex",
      model: "gpt-6-astra",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    });
    expect(JSON.parse(result.providerApiKey)).toMatchObject({
      auth_mode: "chatgpt",
      tokens: { access_token: "access-token", account_id: "account-1" },
    });
  });

  it("returns an OAuth-specific repair code when Codex account auth is unavailable", async () => {
    await expect(resolveQuickChatModelConfig(
      { runtime_type: "codex", model_name: "gpt-6-astra" },
      { provider: "openai", codexAuthMode: "chatgpt", model: "gpt-6-astra" },
    )).rejects.toMatchObject({
      status: 401,
      error: "CODEX_AUTH_REQUIRED",
    });
  });

  it("keeps Codex API provider configuration unchanged", async () => {
    const result = await resolveQuickChatModelConfig(
      { runtime_type: "codex", model_name: "deepseek-chat" },
      { provider: "deepseek", codexAuthMode: "api", model: "deepseek-chat", providerApiKey: encrypt("provider-key") },
    );

    expect(result).toMatchObject({ provider: "deepseek", model: "deepseek-chat", providerApiKey: "provider-key" });
  });

  it("describes Codex account diagnostics as OAuth and preserves the latest failure", async () => {
    const prompt = await buildAssistContext(
      "explain_last_error",
      { runtime_type: "codex", model_name: "gpt-6-astra", status: "running" },
      { provider: "openai", codexAuthMode: "chatgpt", model: "gpt-6-astra", codexAuthJson: encrypt(codexAuth()) },
      {},
      [{ role: "assistant", status: "completed", content: "later success" }],
      { role: "assistant", status: "failed", error_code: "API_KEY_MISSING", content: "" },
    );

    expect(prompt).toContain("供应商 (Provider): openai-codex");
    expect(prompt).toContain("基础 API 地址 (BaseUrl Host): chatgpt.com");
    expect(prompt).toContain("认证方式 (Authentication): ChatGPT OAuth");
    expect(prompt).toContain("最近失败消息的错误码 (Error Code): API_KEY_MISSING");
    expect(prompt).toContain("当前是否配置模型凭据 (HasModelCredential): true");
  });
});

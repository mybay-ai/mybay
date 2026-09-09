import { describe, expect, it } from "vitest";
import { applyCodexOAuthCredential, normalizeCodexAccountAuth, buildCodexRuntimeEnvironment, validateCodexConnection } from "./CodexRuntimeEnvironment";
import { redactSecretsDeep } from "../../../utils/sanitizer";
import { classifyInstanceFilePath } from "../../../services/instances/instanceFileSecurityService";

describe("Codex account isolation", () => {
  it("converts an owned OAuth credential into native account auth without an API route", () => {
    const config: Record<string, any> = { provider: "openai-codex", codexAuthMode: "api", providerCredentialId: "owned",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      providerApiKey: JSON.stringify({ provider: "openai-codex", auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", id_token: "identity" } }) };
    applyCodexOAuthCredential(config, "openai-codex");
    expect(validateCodexConnection(config).mode).toBe("chatgpt");
    expect(config.providerCredentialId).toBeUndefined();
    expect(config.providerApiKey).toBeUndefined();
    expect(config.baseUrl).toBeUndefined();
    expect(JSON.parse(config.codexAuthJson).tokens.refresh_token).toBe("refresh");
  });
  it("rejects mismatched credentials and incomplete OAuth tokens", () => {
    const config = { providerCredentialId: "owned", providerApiKey: JSON.stringify({ provider: "openai-codex", auth_mode: "chatgpt", tokens: { access_token: "access" } }) };
    expect(() => applyCodexOAuthCredential(config, "xai-oauth")).toThrow("CODEX_ACCOUNT_AUTH_INVALID");
    expect(() => applyCodexOAuthCredential(config, "openai-codex")).toThrow("CODEX_ACCOUNT_AUTH_INVALID");
  });
  it("rejects API-key accounts and malformed account imports", () => {
    for (const value of [null, "{}", "not json", JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "secret" })]) {
      expect(() => normalizeCodexAccountAuth(value)).toThrow("CODEX_ACCOUNT_AUTH_INVALID");
    }
  });
  it("keeps only native account fields and redacts the import from product responses", () => {
    const raw = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", id_token: "identity", account_id: "account", unexpected: "omit" }, arbitrary: "omit" });
    const result = JSON.parse(normalizeCodexAccountAuth(raw));
    expect(result.tokens.unexpected).toBeUndefined();
    expect(result.arbitrary).toBeUndefined();
    expect(JSON.stringify(redactSecretsDeep({ config: { codexAuthJson: raw } }))).not.toContain("refresh_token");
  });
  it("does not expose native account, transcripts or bridge journals as files", () => {
    for (const value of ["codex/auth.json", "codex/sessions/run.jsonl", "codex-bridge/state.json"]) {
      expect(classifyInstanceFilePath(value)).toBe("hidden");
    }
    expect(classifyInstanceFilePath("workspace/report.txt")).toBe("artifact");
  });
  it("rejects unsupported provider routes and missing internal authentication", () => {
    expect(() => buildCodexRuntimeEnvironment({ provider: "anthropic" })).toThrow("CODEX_PROVIDER_UNSUPPORTED");
    expect(() => buildCodexRuntimeEnvironment({ provider: "openai" })).toThrow("CODEX_BRIDGE_API_KEY_MISSING");
  });
});

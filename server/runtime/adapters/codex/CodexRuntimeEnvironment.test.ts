import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCodexOAuthCredential, normalizeCodexAccountAuth, buildCodexRuntimeEnvironment, validateCodexConnection, writeCodexRuntimeAccountAuth } from "./CodexRuntimeEnvironment";
import { redactSecretsDeep } from "../../../utils/sanitizer";
import { classifyInstanceFilePath } from "../../../services/instances/instanceFileSecurityService";

describe("Codex account isolation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("converts an owned OAuth credential into native account auth without an API route", () => {
    const config: Record<string, any> = { provider: "openai-codex", codexAuthMode: "api", providerCredentialId: "owned",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      providerApiKey: JSON.stringify({ provider: "openai-codex", auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", id_token: "identity" } }) };
    applyCodexOAuthCredential(config, "openai-codex");
    expect(validateCodexConnection(config).mode).toBe("chatgpt");
    expect(config.providerCredentialId).toBe("owned");
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

  it("rejects instance identifiers that could escape the managed instance root", () => {
    const mkdir = vi.spyOn(fs, "mkdirSync");
    expect(() => writeCodexRuntimeAccountAuth("../outside", JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "access", refresh_token: "refresh", id_token: "identity" },
    }))).toThrow("CODEX_INSTANCE_ID_INVALID");
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("preserves an existing Runtime-owned auth file when a bind mount rejects chown", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-codex-auth-"));
    const authDirectory = path.join(root, "data", "instances", "instance-1", "codex");
    const authPath = path.join(authDirectory, "auth.json");
    fs.mkdirSync(authDirectory, { recursive: true });
    fs.writeFileSync(authPath, "previous\n", { mode: 0o600 });
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const originalGetUid = Object.getOwnPropertyDescriptor(process, "getuid");
    Object.defineProperty(process, "getuid", { configurable: true, value: () => 0 });
    vi.spyOn(fs, "chownSync").mockImplementation(() => { throw Object.assign(new Error("unsupported"), { code: "EPERM" }); });
    try {
      writeCodexRuntimeAccountAuth("instance-1", JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", id_token: "identity" } }));
      expect(JSON.parse(fs.readFileSync(authPath, "utf8")).tokens.refresh_token).toBe("refresh");
      expect(fs.readdirSync(authDirectory).filter(name => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      if (originalGetUid) Object.defineProperty(process, "getuid", originalGetUid);
      else delete (process as NodeJS.Process & { getuid?: () => number }).getuid;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

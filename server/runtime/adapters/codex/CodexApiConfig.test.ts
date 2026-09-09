import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encrypt } from "../../../crypto";
import { validateCodexConnection, writeCodexRuntimeEnvironment } from "./CodexRuntimeEnvironment";

describe("Codex shared API credentials", () => {
  afterEach(() => vi.restoreAllMocks());
  it("writes native Responses provider config without putting the secret in TOML or importing an account", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-codex-api-"));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const result = writeCodexRuntimeEnvironment("isolated", { codexAuthMode: "api", provider: "custom-openai-compatible", model: "org/model", baseUrl: "https://gateway.example/v1", providerApiKey: encrypt("private-provider-key"), hermesApiKey: encrypt("bridge-key") });
    const home = path.join(root, "data/instances/isolated/codex");
    const config = fs.readFileSync(path.join(home, "config.toml"), "utf8");
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain('requires_openai_auth = false');
    expect(config).toContain('model = "org/model"');
    expect(config).not.toContain("private-provider-key");
    expect(fs.existsSync(path.join(home, "auth.json"))).toBe(false);
    expect(result.finalEnvMap.MYBAY_CODEX_PROVIDER_KEY).toBe("private-provider-key");
    const auth = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", id_token: "id" } });
    const switched = writeCodexRuntimeEnvironment("isolated", { provider: "openai", codexAuthJson: encrypt(auth), hermesApiKey: encrypt("bridge-key") });
    expect(switched.finalEnvMap.MYBAY_CODEX_PROVIDER_KEY).toBeUndefined();
    expect(fs.readFileSync(path.join(home, "config.toml"), "utf8")).not.toContain("gateway.example");
  });
  it("rejects mixed authentication and non-Responses presets", () => {
    expect(() => validateCodexConnection({ provider: "openai", providerApiKey: "key" })).toThrow("CODEX_PROVIDER_UNSUPPORTED");
    expect(() => validateCodexConnection({ codexAuthMode: "api", provider: "deepseek", model: "x", providerApiKey: "key" })).toThrow("CODEX_PROVIDER_UNSUPPORTED");
    expect(() => validateCodexConnection({ codexAuthMode: "api", provider: "custom-openai-compatible", model: "x", baseUrl: "https://user:secret@example.com", providerApiKey: "key" })).toThrow("CODEX_BASE_URL_INVALID");
  });
});

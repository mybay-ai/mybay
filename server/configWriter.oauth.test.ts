import { describe, expect, it } from "vitest";
import { buildHermesOAuthAuthStore } from "./configWriter";

describe("Hermes OAuth auth store", () => {
  it("writes both singleton and credential-pool forms used by Hermes Runtime", () => {
    const store = buildHermesOAuthAuthStore(null, "openai-codex", {
      label: "OpenAI Codex OAuth",
      base_url: "https://chatgpt.com/backend-api/codex",
      last_refresh: "2026-08-29T00:00:00.000Z",
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: "2026-08-30T00:00:00.000Z",
      },
    });

    expect(store.version).toBe(2);
    expect(store.active_provider).toBe("openai-codex");
    expect(store.providers["openai-codex"]).toMatchObject({
      auth_type: "oauth_external",
      credential_pool: "openai-codex",
      tokens: { access_token: "access-token", refresh_token: "refresh-token" },
    });
    expect(store.credential_pool["openai-codex"]).toEqual([
      expect.objectContaining({
        id: "openai-codex-mybay-local",
        source: "manual:device_code",
        access_token: "access-token",
        refresh_token: "refresh-token",
      }),
    ]);
  });

  it("rejects an incomplete OAuth credential", () => {
    expect(() => buildHermesOAuthAuthStore(null, "xai-oauth", {
      tokens: { access_token: "access-token" },
    })).toThrow("OAUTH_CREDENTIAL_INVALID");
  });
});

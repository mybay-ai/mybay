import { describe, expect, it } from "vitest";
import { buildLocalOAuthCredentialPayload, normalizeLocalOAuthProvider } from "./oauthProviders";

describe("local OAuth providers", () => {
  it("normalizes only the supported runtime OAuth providers", () => {
    expect(normalizeLocalOAuthProvider("openai-codex")).toBe("openai-codex");
    expect(normalizeLocalOAuthProvider("grok-oauth")).toBe("xai-oauth");
    expect(normalizeLocalOAuthProvider("deepseek")).toBeNull();
  });

  it("builds a Hermes-compatible encrypted credential payload", () => {
    const payload = buildLocalOAuthCredentialPayload("xai-oauth", {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    }, {
      token_endpoint: "https://auth.x.ai/oauth2/token",
      base_url: "https://api.x.ai/v1",
    });

    expect(payload).toMatchObject({
      provider: "xai-oauth",
      auth_type: "oauth_external",
      credential_pool: "xai-oauth",
      token_endpoint: "https://auth.x.ai/oauth2/token",
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
      },
    });
    expect(payload.tokens.expires_at).toEqual(expect.any(String));
    expect(payload.expires_at).toBe(payload.tokens.expires_at);
  });
});

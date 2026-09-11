import { describe, expect, it, vi } from "vitest";
import { refreshCodexOAuthPayload } from "./codexOAuthRefresh";

describe("refreshCodexOAuthPayload", () => {
  it("keeps the previous refresh token when the server only rotates the access token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "next-access", expires_in: 300 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const result = await refreshCodexOAuthPayload({
      provider: "openai-codex",
      auth_mode: "chatgpt",
      tokens: { access_token: "old-access", refresh_token: "old-refresh", id_token: "old-id" },
    }, fetchImpl);
    expect(result.tokens).toMatchObject({ access_token: "next-access", refresh_token: "old-refresh", id_token: "old-id" });
  });

  it("requires reauthorization for a permanently rejected refresh token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(refreshCodexOAuthPayload({ tokens: { refresh_token: "dead-refresh" } }, fetchImpl)).rejects.toMatchObject({
      code: "CODEX_AUTH_REQUIRED",
      statusCode: 400,
    });
  });
});

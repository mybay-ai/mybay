const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";

export type CodexOAuthPayload = {
  auth_mode?: string;
  provider?: string;
  tokens?: Record<string, unknown>;
  [key: string]: unknown;
};

export async function refreshCodexOAuthPayload(
  payload: CodexOAuthPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<CodexOAuthPayload> {
  const refreshToken = typeof payload?.tokens?.refresh_token === "string"
    ? payload.tokens.refresh_token.trim()
    : "";
  if (!refreshToken) {
    throw Object.assign(new Error("Codex OAuth refresh token is unavailable"), { code: "CODEX_AUTH_REQUIRED" });
  }

  const response = await fetchImpl(CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let body: any = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const permanent = [400, 401, 403].includes(response.status);
    throw Object.assign(
      new Error(permanent ? "Codex OAuth authorization must be renewed" : "Codex OAuth token refresh failed"),
      { code: permanent ? "CODEX_AUTH_REQUIRED" : "CODEX_AUTH_REFRESH_FAILED", statusCode: response.status },
    );
  }
  if (typeof body?.access_token !== "string" || !body.access_token.trim()) {
    throw Object.assign(new Error("Codex OAuth refresh response did not include an access token"), { code: "CODEX_AUTH_REFRESH_FAILED" });
  }

  const now = new Date();
  const expiresIn = Number(body.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : undefined;
  return {
    ...payload,
    auth_mode: "chatgpt",
    tokens: {
      ...(payload.tokens || {}),
      ...body,
      refresh_token: typeof body.refresh_token === "string" && body.refresh_token.trim()
        ? body.refresh_token
        : refreshToken,
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    },
    last_refresh: now.toISOString(),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  };
}

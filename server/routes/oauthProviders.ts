import crypto from "node:crypto";
import { Router } from "express";
import { authenticateToken } from "../middlewares/auth";
import { dbAdapter } from "../db";
import { encrypt } from "../crypto";

export type LocalOAuthProvider = "openai-codex" | "xai-oauth";

type LocalOAuthSession = {
  id: string;
  userId: string;
  provider: LocalOAuthProvider;
  expiresAt: number;
  pollIntervalMs: number;
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  tokenEndpoint?: string;
};

const router = Router();
const sessions = new Map<string, LocalOAuthSession>();

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_ISSUER = "https://auth.openai.com";
const CODEX_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`;
const XAI_ISSUER = "https://auth.x.ai";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";

export function normalizeLocalOAuthProvider(value: unknown): LocalOAuthProvider | null {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "openai-codex") return "openai-codex";
  if (["xai-oauth", "grok-oauth", "xai-grok-oauth"].includes(provider)) return "xai-oauth";
  return null;
}

export function buildLocalOAuthCredentialPayload(
  provider: LocalOAuthProvider,
  tokens: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
) {
  const now = new Date();
  const expiresIn = Number(tokens.expires_in || 0);
  const expiresAt = expiresIn > 0
    ? new Date(now.getTime() + expiresIn * 1000).toISOString()
    : undefined;
  return {
    version: 1,
    provider,
    auth_type: "oauth_external",
    credential_pool: provider,
    ...metadata,
    tokens: {
      ...tokens,
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    },
    obtained_at: now.toISOString(),
    last_refresh: now.toISOString(),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  };
}

function purgeExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  let body: any = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}

async function saveCredential(userId: string, provider: LocalOAuthProvider, payload: Record<string, unknown>) {
  const id = crypto.randomUUID();
  const baseUrl = provider === "openai-codex"
    ? "https://chatgpt.com/backend-api/codex"
    : "https://api.x.ai/v1";
  await dbAdapter.createCredential({
    id,
    name: provider === "openai-codex" ? "OpenAI Codex OAuth" : "xAI Grok OAuth",
    type: provider,
    key: encrypt(JSON.stringify(payload)),
    base_url: baseUrl,
    is_custom: false,
    verification_status: "verified",
    verified_at: new Date().toISOString(),
    user_id: userId,
    created_at: new Date().toISOString(),
  });
  return id;
}

router.post("/start", authenticateToken, async (req: any, res) => {
  purgeExpiredSessions();
  const provider = normalizeLocalOAuthProvider(req.body?.provider);
  if (!provider) return res.status(400).json({ success: false, code: "OAUTH_PROVIDER_UNSUPPORTED", error: "Unsupported OAuth provider" });

  try {
    let session: LocalOAuthSession;
    if (provider === "openai-codex") {
      const { response, body } = await fetchJson(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
      });
      if (!response.ok) {
        return res.status(502).json({ success: false, code: "OPENAI_DEVICE_CODE_REQUEST_FAILED", error: `OpenAI device code request failed (${response.status})` });
      }
      const deviceCode = String(body?.device_auth_id || "");
      const userCode = String(body?.user_code || "");
      if (!deviceCode || !userCode) {
        return res.status(502).json({ success: false, code: "OPENAI_DEVICE_CODE_RESPONSE_INVALID", error: "OpenAI device code response was incomplete" });
      }
      session = {
        id: crypto.randomUUID(), userId: req.user.id, provider,
        expiresAt: Date.now() + Number(body?.expires_in || 900) * 1000,
        pollIntervalMs: Math.max(3_000, Number(body?.interval || 5) * 1000),
        deviceCode, userCode,
        verificationUrl: `${CODEX_ISSUER}/codex/device`,
      };
    } else {
      const discovery = await fetchJson(`${XAI_ISSUER}/.well-known/openid-configuration`);
      if (!discovery.response.ok || !discovery.body?.token_endpoint) {
        return res.status(502).json({ success: false, code: "XAI_OAUTH_DISCOVERY_FAILED", error: "xAI OAuth discovery failed" });
      }
      const { response, body } = await fetchJson(`${XAI_ISSUER}/oauth2/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: XAI_CLIENT_ID, scope: XAI_SCOPE }).toString(),
      });
      if (!response.ok) {
        return res.status(502).json({ success: false, code: "XAI_DEVICE_CODE_REQUEST_FAILED", error: `xAI device code request failed (${response.status})` });
      }
      const deviceCode = String(body?.device_code || "");
      const userCode = String(body?.user_code || "");
      const verificationUrl = String(body?.verification_uri_complete || body?.verification_uri || "");
      if (!deviceCode || !userCode || !verificationUrl) {
        return res.status(502).json({ success: false, code: "XAI_DEVICE_CODE_RESPONSE_INVALID", error: "xAI device code response was incomplete" });
      }
      session = {
        id: crypto.randomUUID(), userId: req.user.id, provider,
        expiresAt: Date.now() + Number(body?.expires_in || 900) * 1000,
        pollIntervalMs: Math.max(3_000, Number(body?.interval || 5) * 1000),
        deviceCode, userCode, verificationUrl,
        tokenEndpoint: String(discovery.body.token_endpoint),
      };
    }

    sessions.set(session.id, session);
    return res.json({
      success: true,
      sessionId: session.id,
      provider: session.provider,
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      pollIntervalMs: session.pollIntervalMs,
      expiresAt: session.expiresAt,
    });
  } catch (error: any) {
    console.error("[Local OAuth] start failed:", error?.message || error);
    return res.status(502).json({ success: false, code: "OAUTH_START_FAILED", error: "OAuth authorization could not be started" });
  }
});

router.post("/poll", authenticateToken, async (req: any, res) => {
  const sessionId = String(req.body?.sessionId || "");
  const session = sessions.get(sessionId);
  if (!session || session.userId !== req.user.id || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return res.status(404).json({ success: false, code: "OAUTH_SESSION_NOT_FOUND", error: "OAuth session not found or expired" });
  }

  try {
    let payload: ReturnType<typeof buildLocalOAuthCredentialPayload>;
    if (session.provider === "openai-codex") {
      const codeResult = await fetchJson(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ device_auth_id: session.deviceCode, user_code: session.userCode }),
      });
      if ([403, 404].includes(codeResult.response.status)) {
        return res.json({ success: true, status: "pending", pollIntervalMs: session.pollIntervalMs });
      }
      if (!codeResult.response.ok) {
        return res.status(502).json({ success: false, code: "OPENAI_DEVICE_AUTH_FAILED", error: `OpenAI device authorization failed (${codeResult.response.status})` });
      }
      const authorizationCode = String(codeResult.body?.authorization_code || "");
      const codeVerifier = String(codeResult.body?.code_verifier || "");
      if (!authorizationCode || !codeVerifier) {
        return res.status(502).json({ success: false, code: "OPENAI_DEVICE_AUTH_RESPONSE_INVALID", error: "OpenAI device authorization response was incomplete" });
      }
      const tokenResult = await fetchJson(CODEX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authorizationCode,
          redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
          client_id: CODEX_CLIENT_ID,
          code_verifier: codeVerifier,
        }).toString(),
      });
      if (!tokenResult.response.ok) {
        return res.status(502).json({ success: false, code: "OPENAI_TOKEN_EXCHANGE_FAILED", error: `OpenAI token exchange failed (${tokenResult.response.status})` });
      }
      if (!tokenResult.body?.access_token || !tokenResult.body?.refresh_token) {
        return res.status(502).json({ success: false, code: "OPENAI_TOKEN_RESPONSE_INVALID", error: "OpenAI token response was incomplete" });
      }
      payload = buildLocalOAuthCredentialPayload("openai-codex", tokenResult.body, {
        auth_mode: "chatgpt",
        base_url: "https://chatgpt.com/backend-api/codex",
      });
    } else {
      const tokenResult = await fetchJson(String(session.tokenEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: session.deviceCode,
          client_id: XAI_CLIENT_ID,
        }).toString(),
      });
      if (!tokenResult.response.ok) {
        const oauthError = String(tokenResult.body?.error || "");
        if (["authorization_pending", "slow_down"].includes(oauthError)) {
          if (oauthError === "slow_down") session.pollIntervalMs += 5_000;
          return res.json({ success: true, status: "pending", pollIntervalMs: session.pollIntervalMs });
        }
        if (["access_denied", "expired_token"].includes(oauthError)) {
          sessions.delete(sessionId);
          return res.status(400).json({ success: false, code: "XAI_OAUTH_AUTHORIZATION_REJECTED", error: oauthError });
        }
        return res.status(502).json({ success: false, code: "XAI_OAUTH_AUTHORIZATION_FAILED", error: `xAI OAuth authorization failed (${tokenResult.response.status})` });
      }
      if (!tokenResult.body?.access_token || !tokenResult.body?.refresh_token) {
        return res.status(502).json({ success: false, code: "XAI_OAUTH_TOKEN_RESPONSE_INVALID", error: "xAI OAuth token response was incomplete" });
      }
      payload = buildLocalOAuthCredentialPayload("xai-oauth", tokenResult.body, {
        auth_mode: "oauth_device_code",
        base_url: "https://api.x.ai/v1",
        token_endpoint: session.tokenEndpoint,
      });
    }

    const credentialId = await saveCredential(session.userId, session.provider, payload);
    sessions.delete(sessionId);
    return res.json({ success: true, status: "complete", credentialId, provider: session.provider });
  } catch (error: any) {
    console.error("[Local OAuth] poll failed:", error?.message || error);
    return res.status(502).json({ success: false, code: "OAUTH_POLL_FAILED", error: "OAuth authorization could not be completed" });
  }
});

router.post("/cancel", authenticateToken, (req: any, res) => {
  const sessionId = String(req.body?.sessionId || "");
  const session = sessions.get(sessionId);
  if (session && session.userId === req.user.id) sessions.delete(sessionId);
  return res.json({ success: true });
});

export default router;

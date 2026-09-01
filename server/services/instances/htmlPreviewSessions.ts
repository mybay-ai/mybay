import crypto from "node:crypto";

export const HTML_PREVIEW_SESSION_TTL_MS = 10 * 60 * 1000;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const COOKIE_PREFIX = "mybay_html_preview_";

export type HtmlPreviewSession = {
  publicId: string;
  credentialHash: string;
  instanceId: string;
  ownerId: string;
  viewerRole: string;
  projectRoot: string;
  assetAliases?: Record<string, string>;
  expiresAt: number;
};

const sessions = new Map<string, HtmlPreviewSession>();

function randomSecret(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function safeSecretMatch(secret: string, expectedHash: string): boolean {
  if (!SECRET_PATTERN.test(secret) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function cleanupExpired(now = Date.now()): void {
  for (const [publicId, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(publicId);
  }
}

export function createHtmlPreviewSession(
  input: Omit<HtmlPreviewSession, "publicId" | "credentialHash" | "expiresAt">,
): { session: HtmlPreviewSession; credentialSecret: string } {
  const now = Date.now();
  cleanupExpired(now);
  const publicId = randomSecret(18);
  const credentialSecret = randomSecret(32);
  const session: HtmlPreviewSession = {
    ...input,
    publicId,
    credentialHash: hashSecret(credentialSecret),
    expiresAt: now + HTML_PREVIEW_SESSION_TTL_MS,
  };
  sessions.set(publicId, session);
  return { session, credentialSecret };
}

export function getHtmlPreviewCookieName(publicId: string): string | null {
  return PUBLIC_ID_PATTERN.test(publicId) ? COOKIE_PREFIX + publicId : null;
}

export function getAuthorizedHtmlPreviewSession(
  publicId: string,
  cookieHeader: string | undefined,
): HtmlPreviewSession | null {
  const cookieName = getHtmlPreviewCookieName(publicId);
  if (!cookieName || !cookieHeader) return null;
  cleanupExpired();
  const session = sessions.get(publicId);
  if (!session) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
    const secret = part.slice(separator + 1).trim();
    return safeSecretMatch(secret, session.credentialHash) ? session : null;
  }
  return null;
}

export function serializeHtmlPreviewCredentialCookie(
  session: HtmlPreviewSession,
  credentialSecret: string,
  secure: boolean,
): string {
  const cookieName = getHtmlPreviewCookieName(session.publicId);
  if (!cookieName || !SECRET_PATTERN.test(credentialSecret)) throw new Error("HTML_PREVIEW_CREDENTIAL_INVALID");
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  const path = `/api/instances/${encodeURIComponent(session.instanceId)}/files/html-preview-session/${session.publicId}/`;
  return [
    `${cookieName}=${credentialSecret}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    secure ? "SameSite=None" : "SameSite=Strict",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function serializeHtmlPreviewCredentialCookies(
  session: HtmlPreviewSession,
  credentialSecret: string,
  secure: boolean,
): string[] {
  const cookie = serializeHtmlPreviewCredentialCookie(session, credentialSecret, secure);
  // Sandboxed frames have an opaque origin. Keep credentials HttpOnly and
  // path-scoped, while supporting browsers that partition third-party cookies.
  return secure ? [cookie, cookie + "; Partitioned"] : [cookie];
}

export function clearHtmlPreviewSessionsForTests(): void {
  sessions.clear();
}

// The outer instance router must recognize the narrowly scoped credential too;
// sandboxed subresources must never need the main console login cookie.
export function isAuthorizedHtmlPreviewAssetRequest(method: string, requestPath: string, cookieHeader?: string): boolean {
  if (method !== "GET") return false;
  const match = /^\/([A-Za-z0-9_-]+)\/files\/html-preview-session\/([A-Za-z0-9_-]{20,40})\/(.+)$/.exec(requestPath);
  if (!match) return false;
  const session = getAuthorizedHtmlPreviewSession(match[2], cookieHeader);
  return Boolean(session && session.instanceId === match[1]);
}

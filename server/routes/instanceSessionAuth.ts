import { Router } from "express";
import { dbAdapter } from "../db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../utils/authSecrets";
import { sendApiError } from "../utils/apiErrorResponse";
import { ErrorCodes, instanceBridgeReasonToErrorCode, instanceReadinessReasonToErrorCode } from "../../shared/errorCodes";
import os from "os";
import docker from "../lib/docker";
import { buildDeploymentContext } from "../deploymentContext";
import crypto from "crypto";
import {
  normalizeBaseDomain,
  getPublicAppUrl,
  getInstancePublicProtocol,
  buildInstancePublicUrl,
  buildRedirectTarget,
  getInstanceRootDomain
} from "../utils/publicUrl";

const router = Router();

function safeDecodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(c => {
    const parts = c.trim().split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim();
      cookies[key] = safeDecodeCookieValue(val);
    }
  });
  return cookies;
}

function isValidHermesLoginCookieName(name: string): boolean {
  const lower = name.toLowerCase();
  
  // Excluded names (case-insensitive contains check)
  const excluded = ["csrf", "state", "redirect", "nonce", "flash"];
  for (const item of excluded) {
    if (lower.includes(item)) {
      return false;
    }
  }

  // Accepted names:
  // - hermes_session_* (contains "session")
  // - session
  // - auth_session
  // - any other name containing "session" or "auth"
  return lower.includes("session") || lower.includes("auth");
}

function hasHermesSessionCookie(cookies: Record<string, string>): boolean {
  for (const key of Object.keys(cookies)) {
    if (isValidHermesLoginCookieName(key)) {
      if (cookies[key] && cookies[key].trim().length > 0) {
        return true;
      }
    }
  }
  return false;
}

function isReservedAuthPath(pathname: string): boolean {
  const norm = pathname.toLowerCase().replace(/\/+$/, "");
  return (
    norm === "/login" ||
    norm === "/auth/login" ||
    norm === "/auth/password-login" ||
    norm.startsWith("/login/") ||
    norm.startsWith("/auth/login/") ||
    norm.startsWith("/auth/password-login/")
  );
}


const SENSITIVE_DASHBOARD_PATHS = [
  "/env",
  "/keys",
  "/system",
  "/config",
  "/logs",
  "/files"
];

const PLATFORM_MODEL_EXTRA_BLOCKED_PATHS = [
  "/models",
  "/channels",
  "/webhooks",
  "/gateway",
  "/mcp",
  "/tools",
  "/plugins",
  "/skills",
  "/pairing",
  "/profiles"
];

function normalizeDashboardPath(pathname: string): string {
  const raw = String(pathname || "/").split("?")[0].split("#")[0].toLowerCase();
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

function matchesProtectedDashboardPath(pathname: string, protectedPaths: string[]): boolean {
  const norm = normalizeDashboardPath(pathname);
  return protectedPaths.some((protectedPath) => {
    const base = normalizeDashboardPath(protectedPath);
    return norm === base || norm.startsWith(`${base}/`) || norm.startsWith(`/api${base}`) || norm.startsWith(`/v1${base}`);
  });
}

function isPrivilegedRole(role: any): boolean {
  return role === "admin" || role === "super_admin";
}

async function resolvePlatformUserFromRequest(req: any): Promise<any | null> {
  try {
    const authHeader = req.headers?.authorization;
    let token = authHeader && String(authHeader).startsWith("Bearer ") ? String(authHeader).slice(7).trim() : "";
    if (!token && req.headers?.cookie) {
      const match = String(req.headers.cookie).match(/(?:^|; )mybay_auth_token=([^;]*)/);
      if (match) token = safeDecodeCookieValue(match[1].trim());
    }
    if (!token || token === "null" || token === "undefined") return null;
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded?.id) return null;
    const user = await dbAdapter.getUserById(decoded.id);
    if (!user || user.status === "disabled") return null;
    return user;
  } catch {
    return null;
  }
}

function shouldBlockDashboardPathForUser(options: { pathname: string; config: any; role?: string | null }) {
  if (isPrivilegedRole(options.role)) return false;
  const baseBlocked = matchesProtectedDashboardPath(options.pathname, SENSITIVE_DASHBOARD_PATHS);
  if (baseBlocked) return true;
  const isPlatformModel = options.config?.modelBillingMode === "platform";
  if (isPlatformModel) {
    return matchesProtectedDashboardPath(options.pathname, PLATFORM_MODEL_EXTRA_BLOCKED_PATHS);
  }
  return false;
}
function buildConsoleLoginUrl(options: {
  slug: string;
  redirect: string;
  bridge?: boolean;
  reason?: string;
}): string {
  const publicAppUrl = getPublicAppUrl();
  let url = `${publicAppUrl}/instance-login?slug=${encodeURIComponent(options.slug)}&redirect=${encodeURIComponent(options.redirect)}`;
  if (options.bridge) {
    url += `&bridge=1`;
  }
  if (options.reason) {
    url += `&reason=${encodeURIComponent(options.reason)}`;
  }
  return url;
}

function splitCombinedSetCookie(raw: string): string[] {
  return raw.split(/,\s*(?=[^=;\s]+=)/i);
}

async function ensureConnectedToNetwork(networkName: string) {
  try {
    const hostname = os.hostname();
    const container = docker.getContainer(hostname);
    await container.inspect(); // Check if we are inside a docker container
    const network = docker.getNetwork(networkName);
    await network.connect({ Container: container.id }).catch((err: any) => {
      // Ignore "already connected" error
      if (err.statusCode !== 409 && !err.message?.includes("already exists")) {
        console.warn(`[Network Bridge Warning] Failed to connect core container to network ${networkName}:`, err.message || err);
      }
    });
  } catch (err: any) {
    // If not in docker or fails, skip gracefully
  }
}

function parseSetCookie(cookieStr: string): { name: string; value: string; maxAge?: string; httpOnly: boolean; secure: boolean } {
  const parts = cookieStr.split(";").map(p => p.trim());
  const mainPart = parts[0] || "";
  const eqIdx = mainPart.indexOf("=");
  const name = eqIdx > -1 ? mainPart.substring(0, eqIdx).trim() : mainPart;
  const value = eqIdx > -1 ? mainPart.substring(eqIdx + 1).trim() : "";

  let maxAge: string | undefined;
  let httpOnly = false;
  let secure = false;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const lower = p.toLowerCase();
    if (lower.startsWith("max-age=")) {
      maxAge = p.substring("max-age=".length).trim();
    } else if (lower === "httponly") {
      httpOnly = true;
    } else if (lower === "secure") {
      secure = true;
    }
  }

  return { name, value, maxAge, httpOnly, secure };
}

/**
 * Deprecated: Do not use for Hermes Web UI session bridge.
 * New bridge flow must use /__mybay/session-complete and Host-Only cookies.
 * This legacy Domain=.baseDomain flow can cause cross-instance cookie pollution.
 */
function rewriteHermesCookieLegacyDomainScoped(cookieStr: string, baseDomain: string, isProd: boolean): string | null {
  const { name, value, maxAge, httpOnly } = parseSetCookie(cookieStr);
  if (!name || !value) return null;
  
  const parts = [`${name}=${value}`];
  parts.push(`Domain=.${baseDomain}`);
  parts.push("Path=/");
  if (httpOnly) {
    parts.push("HttpOnly");
  }
  parts.push("SameSite=Lax");
  if (maxAge) {
    parts.push(`Max-Age=${maxAge}`);
  }
  if (isProd) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function rewriteHermesCookieHostOnly(cookieStr: string, isProd: boolean): string | null {
  const { name, value, maxAge, httpOnly } = parseSetCookie(cookieStr);
  if (!name || !value) return null;
  
  const parts = [`${name}=${value}`];
  parts.push("Path=/");
  if (httpOnly) {
    parts.push("HttpOnly");
  }
  parts.push("SameSite=Lax");
  if (maxAge) {
    parts.push(`Max-Age=${maxAge}`);
  }
  if (isProd) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

interface CompleteTicket {
  slug: string;
  hermesCookies: string[];
  redirectUrl: string;
  expiresAt: number;
  mybaySessionToken?: string;
}

const ticketStore = new Map<string, CompleteTicket>();

function cleanupTickets() {
  const now = Date.now();
  for (const [key, t] of ticketStore.entries()) {
    if (t.expiresAt < now) {
      ticketStore.delete(key);
    }
  }
}

export function createSessionCompleteTicket(slug: string, hermesCookies: string[], redirectUrl: string, mybaySessionToken?: string): string {
  cleanupTickets();
  const ticket = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 60 * 1000; // 60 seconds
  ticketStore.set(ticket, {
    slug,
    hermesCookies,
    redirectUrl,
    expiresAt,
    mybaySessionToken
  });
  return ticket;
}

function sanitizeCompletionRedirect(rawRedirect: string | undefined, expectedHost: string): string {
  if (!rawRedirect) return "/";
  const value = rawRedirect.trim();
  if (!value) return "/";
  if (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !value.includes("\\")
  ) {
    return value;
  }
  try {
    const url = new URL(value);
    const expectedHostNoPort = expectedHost.split(":")[0];
    const urlHostNoPort = url.host.split(":")[0];
    if (urlHostNoPort === expectedHostNoPort) {
      // Normalize protocol
      const expectedProtocol = getInstancePublicProtocol();
      url.protocol = expectedProtocol + ":";
      return url.toString();
    }
  } catch {}
  return "/";
}

export async function handleSessionComplete(req: any, res: any) {
  try {
    const ticket = req.query.ticket as string;
    const redirectParam = req.query.redirect as string;

    if (!ticket) {
      console.warn("[SessionComplete Warning] Missing ticket in query parameters");
      return res.status(400).send("Missing ticket");
    }

    cleanupTickets();
    const data = ticketStore.get(ticket);
    if (!data) {
      console.warn(`[SessionComplete Warning] Invalid or expired ticket requested: ticket=${ticket}`);
      return res.status(400).send("Invalid or expired ticket");
    }

    if (data.expiresAt < Date.now()) {
      console.warn(`[SessionComplete Warning] Ticket has expired: ticket=${ticket}, expiresAt=${data.expiresAt}`);
      return res.status(400).send("Ticket expired");
    }

    const host = String(req.headers.host || "");
    const hostStr = host.split(":")[0];
    const baseDomain = getInstanceRootDomain();

    let requestSlug = "";
    if (hostStr.endsWith(`.${baseDomain}`)) {
      requestSlug = hostStr.substring(0, hostStr.length - baseDomain.length - 1);
    } else {
      requestSlug = hostStr.split(".")[0];
    }

    console.log(`[SessionComplete Diagnostics] Processing session completion: hostStr=${hostStr}, requestSlug=${requestSlug}, ticketSlug=${data.slug}, hasSessionToken=${!!data.mybaySessionToken}`);

    if (requestSlug !== data.slug) {
      console.warn(`[SessionComplete Warning] Ticket slug mismatch: expected ${data.slug}, request host was ${hostStr}`);
      return res.status(403).send("Host mismatch");
    }

    const isProd = process.env.NODE_ENV === "production";
    const cookiesToSet: string[] = [];

    // Dynamically clear all valid login cookies we find, both in base domain and host-only.
    const cookiesToClear = new Set<string>(["hermes_session_at", "hermes_session_rt"]);
    if (Array.isArray(data.hermesCookies)) {
      data.hermesCookies.forEach(cookie => {
        const parsed = parseSetCookie(cookie);
        if (parsed.name && isValidHermesLoginCookieName(parsed.name)) {
          cookiesToClear.add(parsed.name);
        }
      });
    }
    const reqCookies = parseCookies(req.headers.cookie);
    Object.keys(reqCookies).forEach(name => {
      if (isValidHermesLoginCookieName(name)) {
        cookiesToClear.add(name);
      }
    });

    cookiesToClear.forEach(name => {
      cookiesToSet.push(`${name}=; Path=/; Domain=.${baseDomain}; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isProd ? '; Secure' : ''}; SameSite=Lax`);
      cookiesToSet.push(`${name}=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isProd ? '; Secure' : ''}; SameSite=Lax`);
    });

    // Extract and rewrite new hermes session cookies to Host-Only
    let hasAnyHermesCookieRewritten = false;
    const rewrittenCookieNames: string[] = [];
    if (Array.isArray(data.hermesCookies)) {
      data.hermesCookies.forEach(cookie => {
        const parsed = parseSetCookie(cookie);
        const name = parsed.name;
        if (name && isValidHermesLoginCookieName(name)) {
          const rewritten = rewriteHermesCookieHostOnly(cookie, isProd);
          if (rewritten) {
            cookiesToSet.push(rewritten);
            rewrittenCookieNames.push(name);
            hasAnyHermesCookieRewritten = true;
          }
        }
      });
    }

    console.log(`[SessionComplete Diagnostics] Attempted to rewrite Hermes cookies. Rewritten: ${JSON.stringify(rewrittenCookieNames)}`);

    if (!hasAnyHermesCookieRewritten) {
      console.error(`[SessionComplete Error] Ticket contains no valid hermes session cookies to set. Available raw cookies: ${JSON.stringify(data.hermesCookies)}`);
      return res.status(400).send("No valid hermes session cookies found in ticket");
    }

    // Set host-only platform session cookie to guarantee subdomain authentication success under all domain types
    if (data.mybaySessionToken) {
      const mybayCookie = `mybay_session_${requestSlug}=${encodeURIComponent(data.mybaySessionToken)}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}${isProd ? '; Secure' : ''}; SameSite=Lax`;
      cookiesToSet.push(mybayCookie);
      console.log(`[SessionComplete Diagnostics] Setting host-only platform session cookie: mybay_session_${requestSlug}=${data.mybaySessionToken.substring(0, 10)}...`);
    } else {
      console.warn(`[SessionComplete Diagnostics Warning] No mybaySessionToken found in ticket! Host-only session cookie skipped.`);
    }

    const safeRedirect = sanitizeCompletionRedirect(redirectParam || data.redirectUrl, hostStr);

    console.log(`[SessionComplete Diagnostics] Completion SUCCESSFUL! Final Summary:`, {
      host: hostStr,
      ticketSlug: data.slug,
      requestSlug,
      rewrittenHermesCookies: rewrittenCookieNames,
      mybaySessionTokenSet: !!data.mybaySessionToken,
      safeRedirect,
      totalSetCookieHeaderCount: cookiesToSet.length
    });

    // Delete the ticket only when we are fully validated and about to set headers & redirect
    ticketStore.delete(ticket);

    res.setHeader("Set-Cookie", cookiesToSet);
    return res.redirect(safeRedirect);

  } catch (err: any) {
    console.error(`[SessionComplete Error] Failed:`, err.message || err);
    return res.status(500).send("Session Complete Internal Error");
  }
}

export type HermesBridgeLoginOptions = {
  maxAttempts?: number;
  perRequestTimeoutMs?: number;
  totalDeadlineMs?: number;
};

class SimpleCookieJar {
  private cookies: Map<string, string> = new Map();

  addCookies(rawSetCookies: string[]) {
    for (const raw of rawSetCookies) {
      const parsed = parseSetCookie(raw);
      if (parsed.name && parsed.value) {
        this.cookies.set(parsed.name, parsed.value);
      }
    }
  }

  getCookieHeader(): string {
    const pairs: string[] = [];
    for (const [name, value] of this.cookies.entries()) {
      pairs.push(`${name}=${value}`);
    }
    return pairs.join("; ");
  }

  hasCookies(): boolean {
    return this.cookies.size > 0;
  }

  getCookieNames(): string[] {
    return Array.from(this.cookies.keys());
  }

  getHermesCookieNames(): string[] {
    return this.getCookieNames().filter(name => isValidHermesLoginCookieName(name));
  }

  getAllCookiesAsSetCookieStrings(): string[] {
    const arr: string[] = [];
    for (const [name, value] of this.cookies.entries()) {
      arr.push(`${name}=${value}; Path=/`);
    }
    return arr;
  }
}

export function buildHermesCandidateUrls(instance: any, config: any): { urls: string[], externalHost: string, networkName: string | undefined } {
  const ctx = buildDeploymentContext(instance, config);
  const internalWebPort = ctx.internalWebPort || 9119;
  const hostPort = ctx.hostPort || ctx.gatewayHostPort || ctx.dashboardHostPort;
  const networkName = ctx.networkName;
  const slug = ctx.subdomain.split(".")[0];
  const baseDomain = getInstanceRootDomain();
  const externalHost = `${slug}.${baseDomain}`;

  const urls: string[] = [
    `http://mybay-agent-${instance.id}:${internalWebPort}`,
  ];
  if (hostPort) {
    urls.push(`http://127.0.0.1:${hostPort}`);
  }
  urls.push(`https://${externalHost}`);
  urls.push(`http://${externalHost}`);

  return { urls, externalHost, networkName };
}

export async function performHermesBridgeLogin(
  instance: any,
  config: any,
  usernameToUse: string,
  passwordToUse: string,
  options?: HermesBridgeLoginOptions
): Promise<{ success: boolean; cookies: string[]; reason: string; lastErr?: any; status?: number }> {
  const { urls, externalHost, networkName } = buildHermesCandidateUrls(instance, config);

  const maxAttempts = options?.maxAttempts ?? 2;
  const perRequestTimeoutMs = options?.perRequestTimeoutMs ?? 2500;
  const totalDeadlineMs = options?.totalDeadlineMs ?? 12000;
  const startTime = Date.now();

  let lastReason = "password_login_endpoint_failed";
  let lastErr: any = null;
  let lastStatus = 502;
  const reasons: string[] = [];

  if (networkName) {
    try {
      await ensureConnectedToNetwork(networkName);
    } catch (netErr: any) {
      console.warn(`[Hermes Bridge] Network connection pre-check failed:`, netErr.message || netErr);
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= totalDeadlineMs) {
      console.log(`[Hermes Bridge] Total deadline of ${totalDeadlineMs}ms exceeded. Aborting bridge.`);
      lastReason = "network_not_ready";
      break;
    }

    console.log(`[Hermes Bridge Retry] Attempt ${attempt}/${maxAttempts} ...`);

    for (const baseUrl of urls) {
      const innerElapsed = Date.now() - startTime;
      if (innerElapsed >= totalDeadlineMs) {
        lastReason = "network_not_ready";
        break;
      }

      try {
        // 1. Check status first
        console.log(`[Hermes Bridge] Checking status at ${baseUrl}/api/status`);
        const statusController = new AbortController();
        const statusTimeout = setTimeout(() => statusController.abort(), perRequestTimeoutMs);
        let statusRes: any;
        try {
          statusRes = await fetch(`${baseUrl}/api/status`, {
            headers: {
              "Host": externalHost,
              "X-Forwarded-Host": externalHost,
              "X-Forwarded-Proto": "https",
              "X-Forwarded-Port": "443",
              "X-Real-IP": "127.0.0.1"
            },
            signal: statusController.signal
          });
          clearTimeout(statusTimeout);
          console.log(`[Hermes Bridge Status Response] URL: ${baseUrl}/api/status, Status Code: ${statusRes.status}`);
        } catch (err: any) {
          clearTimeout(statusTimeout);
          console.warn(`[Hermes Bridge Status Error] URL: ${baseUrl}/api/status failed: ${err.message || err}`);
          throw err;
        }

        let isNewVersionCompat = false;
        let statusJson: any = null;

        if (statusRes.ok) {
          statusJson = await statusRes.json().catch(() => null);
          if (!statusJson) {
            console.warn(`[Hermes Bridge] API Status did not return valid JSON. Auth chain is not ready.`);
            reasons.push("invalid_json_response");
            lastStatus = statusRes.status;
            continue;
          }

          console.log(`[Hermes Bridge Status Body] auth_required: ${statusJson.auth_required}, auth_providers: ${JSON.stringify(statusJson.auth_providers)}`);
          if (statusJson.auth_required !== true || !Array.isArray(statusJson.auth_providers) || !statusJson.auth_providers.includes("basic")) {
            console.log(`[Hermes Bridge] API Status indicates basic auth is not required or not available.`);
            reasons.push("basic_auth_not_enabled");
            lastStatus = statusRes.status;
            continue;
          }
        } else if (statusRes.status === 404) {
          console.log(`[Hermes Bridge] API Status returned 404. Proceeding in new version compat mode.`);
          isNewVersionCompat = true;
        } else {
          console.warn(`[Hermes Bridge] API Status returned non-OK status: ${statusRes.status}. Auth chain is not ready.`);
          reasons.push(`status_not_ok_${statusRes.status}`);
          lastStatus = statusRes.status;
          continue;
        }

        // 1b. Probe password-login endpoint availability to ensure it is registered and interactive
        console.log(`[Hermes Bridge] Probing password login endpoint at ${baseUrl}/auth/password-login`);
        const probeController = new AbortController();
        const probeTimeout = setTimeout(() => probeController.abort(), perRequestTimeoutMs);
        let probeRes: any;
        try {
          probeRes = await fetch(`${baseUrl}/auth/password-login`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Host": externalHost,
              "X-Forwarded-Host": externalHost,
              "X-Forwarded-Proto": "https",
              "X-Forwarded-Port": "443",
              "X-Real-IP": "127.0.0.1"
            },
            body: JSON.stringify({
              username: "dummy_probe_user_not_real",
              password: "dummy_probe_password"
            }),
            signal: probeController.signal
          });
          clearTimeout(probeTimeout);
          console.log(`[Hermes Bridge Probe Response] Status Code: ${probeRes.status}`);
        } catch (err: any) {
          clearTimeout(probeTimeout);
          console.warn(`[Hermes Bridge Probe Error] Failed to probe password-login endpoint: ${err.message || err}`);
          reasons.push("auth_chain_not_ready");
          lastStatus = 502;
          continue;
        }

        // A valid password-login handler should return 401, 403, 400, 422, or 429 for a dummy probe login.
        // 422 indicates the endpoint is active and executing schema validation on our payload, meaning it is ready.
        // If it returns other statuses (like 404, 200, 302, 5xx, or other errors), the endpoint is NOT yet ready/registered.
        const allowedProbeStatuses = [400, 401, 403, 422, 429];
        if (!allowedProbeStatuses.includes(probeRes.status)) {
          console.warn(`[Hermes Bridge] Password-login endpoint returned ${probeRes.status} (not 400, 401, 403, 422, or 429). Auth chain is not ready.`);
          reasons.push(`probe_returned_${probeRes.status}`);
          lastStatus = probeRes.status;
          continue;
        }

        // 2. Perform login
        const cookieJar = new SimpleCookieJar();
        const allRawSetCookies: string[] = [];

        // Gather any cookies from the statusRes call
        let statusCookies: string[] = [];
        if (statusRes.headers) {
          if (typeof (statusRes.headers as any).getSetCookie === "function") {
            statusCookies = (statusRes.headers as any).getSetCookie();
          } else {
            const raw = statusRes.headers.get("set-cookie");
            if (raw) {
              statusCookies = splitCombinedSetCookie(raw);
            }
          }
        }
        cookieJar.addCookies(statusCookies);
        allRawSetCookies.push(...statusCookies);

        // Fetch login page GET first to establish session/CSRF cookies in cookieJar
        console.log(`[Hermes Bridge] Fetching login page GET to initialize cookie jar at ${baseUrl}/auth/password-login`);
        const initController = new AbortController();
        const initTimeout = setTimeout(() => initController.abort(), perRequestTimeoutMs);
        try {
          const initRes = await fetch(`${baseUrl}/auth/password-login`, {
            method: "GET",
            headers: {
              "Host": externalHost,
              "X-Forwarded-Host": externalHost,
              "X-Forwarded-Proto": "https",
              "X-Forwarded-Port": "443",
              "X-Real-IP": "127.0.0.1",
              ...(cookieJar.hasCookies() ? { "Cookie": cookieJar.getCookieHeader() } : {})
            },
            signal: initController.signal
          });
          clearTimeout(initTimeout);

          let initCookies: string[] = [];
          if (initRes.headers) {
            if (typeof (initRes.headers as any).getSetCookie === "function") {
              initCookies = (initRes.headers as any).getSetCookie();
            } else {
              const raw = initRes.headers.get("set-cookie");
              if (raw) {
                initCookies = splitCombinedSetCookie(raw);
              }
            }
          }
          cookieJar.addCookies(initCookies);
          allRawSetCookies.push(...initCookies);
          console.log(`[Hermes Bridge Init Response] GET status: ${initRes.status}, current cookie header: ${cookieJar.getCookieHeader() || "empty"}`);
        } catch (initErr: any) {
          clearTimeout(initTimeout);
          console.warn(`[Hermes Bridge Init Warning] GET ${baseUrl}/auth/password-login failed (skipping): ${initErr.message || initErr}`);
        }

        // Check provider to submit
        let providerToUse = "basic";
        if (statusJson && Array.isArray(statusJson.auth_providers)) {
          if (statusJson.auth_providers.includes("basic")) {
            providerToUse = "basic";
          } else if (statusJson.auth_providers.length > 0) {
            providerToUse = statusJson.auth_providers[0] || "basic";
          }
        }

        // Perform login request with JSON payload and manual redirect tracking
        let currentUrl = `${baseUrl}/auth/password-login`;
        let method = "POST";
        let contentType = "application/json";
        let loginBody: string | undefined = JSON.stringify({
          provider: providerToUse,
          username: usernameToUse,
          password: passwordToUse,
          next: "/"
        });

        let resObj: any = null;
        let redirectHop = 0;
        const maxRedirectHops = 2;
        let responseBodySnippet = "none";

        while (redirectHop <= maxRedirectHops) {
          const loginController = new AbortController();
          const loginTimeout = setTimeout(() => loginController.abort(), perRequestTimeoutMs);

          const headers: Record<string, string> = {
            "Host": externalHost,
            "X-Forwarded-Host": externalHost,
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Port": "443",
            "X-Real-IP": "127.0.0.1",
            ...(cookieJar.hasCookies() ? { "Cookie": cookieJar.getCookieHeader() } : {})
          };

          if (method === "POST" && contentType) {
            headers["Content-Type"] = contentType;
          }

          let loginFields: string[] = [];
          if (loginBody) {
            try {
              if (contentType.includes("json")) {
                loginFields = Object.keys(JSON.parse(loginBody));
              } else {
                loginFields = Array.from(new URLSearchParams(loginBody).keys());
              }
            } catch (e) {}
          }
          console.log(`[Hermes Bridge Login Step] Attempting: ${method} ${currentUrl}`);
          console.log(`[Hermes Bridge Login Request Info] Content-Type: ${contentType || "none"}, Payload fields: [${loginFields.join(", ")}], Cookies to send: ${cookieJar.getCookieHeader() || "none"}`);

          try {
            resObj = await fetch(currentUrl, {
              method,
              headers,
              body: method === "POST" ? loginBody : undefined,
              redirect: "manual",
              signal: loginController.signal
            });
            clearTimeout(loginTimeout);
          } catch (err: any) {
            clearTimeout(loginTimeout);
            console.warn(`[Hermes Bridge Login Step Error] ${method} ${currentUrl} failed: ${err.message || err}`);
            throw err;
          }

          // Read response body snippet
          try {
            const bodyText = await resObj.text();
            responseBodySnippet = bodyText.substring(0, 500);
          } catch (bodyErr: any) {
            responseBodySnippet = `Error reading body: ${bodyErr.message || bodyErr}`;
          }

          // Collect cookies from response
          let stepCookies: string[] = [];
          if (resObj.headers) {
            if (typeof (resObj.headers as any).getSetCookie === "function") {
              stepCookies = (resObj.headers as any).getSetCookie();
            } else {
              const raw = resObj.headers.get("set-cookie");
              if (raw) {
                stepCookies = splitCombinedSetCookie(raw);
              }
            }
          }
          cookieJar.addCookies(stepCookies);
          allRawSetCookies.push(...stepCookies);

          const receivedCookieNames = stepCookies.map(c => parseSetCookie(c).name || "").filter(Boolean);
          const matchedHermesCookieNames = receivedCookieNames.filter(name => isValidHermesLoginCookieName(name));
          const loc = resObj.headers ? (resObj.headers.get("location") || "none") : "none";

          console.log(`[Hermes Bridge Step Response] Status: ${resObj.status}, Location: ${loc}`);
          console.log(`[Hermes Bridge Step Response Details] Received cookies at this step: [${receivedCookieNames.join(", ")}], Matched Hermes: [${matchedHermesCookieNames.join(", ")}]`);
          console.log(`[Hermes Bridge Step Response Body Snippet] ${responseBodySnippet}`);

          if (resObj.status === 422) {
            let reqFields: string[] = [];
            if (method === "POST" && loginBody) {
              try {
                if (contentType.includes("json")) {
                  reqFields = Object.keys(JSON.parse(loginBody));
                } else {
                  reqFields = Array.from(new URLSearchParams(loginBody).keys());
                }
              } catch (e) {
                reqFields = ["error_parsing_body"];
              }
            }
            const respContentType = resObj.headers ? (resObj.headers.get("content-type") || "none") : "none";
            console.warn(`[Hermes Bridge Validation Error 422] Received 422 from ${currentUrl}. ` +
                         `Request Content-Type: ${contentType}, Request Fields: [${reqFields.join(", ")}], ` +
                         `Response Content-Type: ${respContentType}, Response Body: ${responseBodySnippet}`);
          }

          // Check for redirect
          const isRedirect = [301, 302, 303, 307, 308].includes(resObj.status);
          if (isRedirect && loc !== "none") {
            redirectHop++;
            let nextUrl = loc;
            if (!nextUrl.startsWith("http://") && !nextUrl.startsWith("https://")) {
              const base = new URL(currentUrl);
              nextUrl = new URL(nextUrl, base.origin).toString();
            }
            console.log(`[Hermes Bridge Redirect Flow] Hop ${redirectHop}/${maxRedirectHops}: Redirecting to ${nextUrl}`);
            currentUrl = nextUrl;
            
            if (resObj.status === 303 || resObj.status === 301 || resObj.status === 302) {
              method = "GET";
              contentType = "";
              loginBody = undefined;
            }
            continue;
          }

          // No redirect, stop following
          break;
        }

        lastStatus = resObj.status;

        if (resObj.status === 429) {
          console.warn(`[Hermes Bridge] Rate limited by upstream (429).`);
          return { success: false, cookies: [], reason: "hermes_rate_limited", status: 429 };
        }

        if (resObj.status === 401 || resObj.status === 403) {
          console.warn(`[Hermes Bridge] Upstream rejected credentials (${resObj.status}). Aborting retries.`);
          return { success: false, cookies: [], reason: "invalid_credentials", status: resObj.status };
        }

        const finalHermesCookieNames = cookieJar.getHermesCookieNames();
        console.log(`[Hermes Bridge Final State] Accumulated Cookies: [${cookieJar.getCookieNames().join(", ")}], Hermes Matches: [${finalHermesCookieNames.join(", ")}]`);

        if (finalHermesCookieNames.length > 0) {
          console.log(`[Hermes Bridge Success] Attempt ${attempt} URL ${baseUrl} succeeded with status ${resObj.status}.`);
          return {
            success: true,
            cookies: allRawSetCookies,
            reason: "ok",
            status: resObj.status
          };
        } else {
          console.warn(`[Hermes Bridge Failed] Attempt ${attempt} URL ${baseUrl} did not yield valid Hermes session cookies (HTTP status: ${resObj.status}).`);
          reasons.push("missing_hermes_session_cookie");
        }
      } catch (fetchErr: any) {
        const isTransientNetwork = 
          fetchErr.name === "AbortError" || 
          fetchErr.code === "ENOTFOUND" || 
          fetchErr.code === "ECONNREFUSED" || 
          fetchErr.code === "ECONNRESET" ||
          fetchErr.message?.includes("fetch failed") ||
          fetchErr.message?.includes("timeout") ||
          fetchErr.message?.includes("network");

        if (isTransientNetwork) {
          console.warn(`[Hermes Bridge Transient Network Error] Attempt ${attempt} URL ${baseUrl} failed: ${fetchErr.message || fetchErr}`);
          reasons.push("network_not_ready");
          lastErr = fetchErr;
        } else {
          console.warn(`[Hermes Bridge Request Error] Attempt ${attempt} URL ${baseUrl} error: ${fetchErr.message || fetchErr}`);
          reasons.push("password_login_endpoint_failed");
          lastErr = fetchErr;
        }
      }
    }
    
    // Add small delay before next attempt
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const bestReason = reasons.length > 0 ? selectBestReason(reasons) : lastReason;

  return {
    success: false,
    cookies: [],
    reason: bestReason,
    lastErr,
    status: lastStatus
  };
}


// 1. GET /api/instances/auth-check
router.get("/auth-check", async (req, res) => {
  try {
    const host = req.headers["x-forwarded-host"] || req.headers["host"] || "";
    if (!host) {
      return res.status(400).send("Bad Request: Missing Host header");
    }

    const hostStr = String(host).split(":")[0];
    const baseDomain = getInstanceRootDomain();
    
    // Extract subdomain slug
    let slug = "";
    if (hostStr.endsWith(`.${baseDomain}`)) {
      slug = hostStr.substring(0, hostStr.length - baseDomain.length - 1);
    } else {
      slug = hostStr.split(".")[0];
    }

    if (!slug || slug === "www" || hostStr === baseDomain) {
      // Direct access to core or main app, allow public / default routing
      return res.status(200).send("OK");
    }

    const checkUri = String(req.headers["x-forwarded-uri"] || req.originalUrl || "/");

    // Parse X-Forwarded-Uri pathname early
    let checkPathname = "/";
    try {
      const parsedUrl = new URL(checkUri, "http://localhost");
      checkPathname = parsedUrl.pathname;
    } catch (e) {
      checkPathname = checkUri.split("?")[0];
    }

    // Protection against infinite redirection loops if the session-complete route is not correctly bypassed.
    // We bypass early before database lookups to prevent unnecessary queries and handle rapid routing setups.
    if (checkPathname === "/__mybay/session-complete") {
      console.log(`[ForwardAuth-Check] Permitting /__mybay/session-complete directly via early 200 OK bypass.`);
      return res.status(200).send("OK");
    }

    // Lookup instance in database
    const instance = await dbAdapter.getInstanceByPath(slug);
    if (!instance) {
      return res.status(404).send("mybay_instance_not_found");
    }

    if (instance.archived) {
      return res.status(403).send("mybay_instance_archived");
    }

    let config: any = {};
    try {
      config = JSON.parse(instance.config_json || "{}");
    } catch (parseErr) {
      console.error(`[AuthCheck Error] Invalid config_json for instance slug: ${slug}`);
      return res.status(500).send("mybay_invalid_config_json");
    }

    // Safety Diagnostic Logging
    const resolvedHost = hostStr;
    const resolvedSlug = slug;
    const publicAppUrl = getPublicAppUrl();
    const instancePublicUrl = buildInstancePublicUrl(slug, config.host_port || config.port);
    const xForwardedProto = req.headers["x-forwarded-proto"];
    const xForwardedHost = req.headers["x-forwarded-host"];
    const cfVisitor = req.headers["cf-visitor"];
    const nodeEnv = process.env.NODE_ENV;

    console.log(`[ForwardAuth-Check Safety Log]`, {
      resolvedHost,
      resolvedSlug,
      publicAppUrl,
      instancePublicUrl,
      xForwardedProto,
      xForwardedHost,
      cfVisitor,
      nodeEnv
    });

    // If the instance does not have password protection, allow public access
    if (!config.webPasswordHash) {
      return res.status(200).send("OK");
    }

    const logoutPaths = ["/logout", "/auth/logout", "/auth/session/logout"];

    // 1. Handle Logout Paths FIRST: always redirect to MyBay logout endpoint
    if (logoutPaths.includes(checkPathname)) {
      const defaultRedirect = `${buildInstancePublicUrl(slug, config.host_port || config.port)}/`;
      const loginRedirectUrl = buildConsoleLoginUrl({
        slug,
        redirect: defaultRedirect
      });
      const logoutRedirectUrl = `${publicAppUrl}/api/public/instances/session-logout?slug=${encodeURIComponent(slug)}&redirect=${encodeURIComponent(loginRedirectUrl)}`;
      console.log(`[ForwardAuth-Check] Redirecting logout path: resolvedHost=${resolvedHost}, resolvedSlug=${resolvedSlug}, publicAppUrl=${publicAppUrl}, instancePublicUrl=${instancePublicUrl}, redirectTarget=${logoutRedirectUrl}, x-forwarded-proto=${xForwardedProto}, x-forwarded-host=${xForwardedHost}, cf-visitor=${cfVisitor}, NODE_ENV=${nodeEnv}`);
      return res.redirect(logoutRedirectUrl);
    }

    // Verify cookies
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[`mybay_session_${slug}`];

    console.log(`[ForwardAuth-Check Diagnostics] Cookie state for slug=${slug}:`, {
      cookieNames: Object.keys(cookies),
      mybaySessionTokenPresent: !!token,
      hermesCookiesPresent: hasHermesSessionCookie(cookies)
    });

    let isLoggedIn = false;
    let decodedSession: any = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded && decoded.slug === slug && decoded.instanceId === instance.id) {
          isLoggedIn = true;
          decodedSession = decoded;
        }
      } catch (jwtErr) {
        // Token invalid or expired, proceed to authenticate
      }
    }

    const hasHermes = hasHermesSessionCookie(cookies);

    // Check request content types (HTML page vs AJAX/WebSocket/SSE/REST API/Assets)
    const accept = String(req.headers["accept"] || "");
    const isHtmlRequest =
      accept.includes("text/html") ||
      checkPathname === "/" ||
      checkPathname.endsWith(".html") ||
      isReservedAuthPath(checkPathname);

    // 2. Intercept any visits to Hermes native reserved auth paths
    if (isReservedAuthPath(checkPathname)) {
      const instanceRootUrl = `${buildInstancePublicUrl(slug, config.host_port || config.port)}/`;

      if (isLoggedIn) {
        const redirectUrl = buildConsoleLoginUrl({
          slug,
          redirect: instanceRootUrl,
          bridge: true,
          reason: "hermes_login_intercepted"
        });
        console.log(`[ForwardAuth-Check] hermes_login_intercepted: path=${checkPathname}, slug=${slug}, publicAppUrl=${publicAppUrl}, instancePublicUrl=${instancePublicUrl}, redirectTarget=${redirectUrl}, x-forwarded-proto=${xForwardedProto}, x-forwarded-host=${xForwardedHost}, cf-visitor=${cfVisitor}, NODE_ENV=${nodeEnv}`);
        return res.redirect(redirectUrl);
      } else {
        const redirectUrl = buildConsoleLoginUrl({
          slug,
          redirect: instanceRootUrl
        });
        console.log(`[ForwardAuth-Check] reserved auth path for anonymous user: path=${checkPathname}, slug=${slug}, publicAppUrl=${publicAppUrl}, instancePublicUrl=${instancePublicUrl}, redirectTarget=${redirectUrl}, x-forwarded-proto=${xForwardedProto}, x-forwarded-host=${xForwardedHost}, cf-visitor=${cfVisitor}, NODE_ENV=${nodeEnv}`);
        return res.redirect(redirectUrl);
      }
    }

    // 3. For all other paths, check authentication status
    if (isLoggedIn) {
      if (hasHermes) {
        const platformUser = await resolvePlatformUserFromRequest(req);
        const sessionRole = platformUser?.role || decodedSession?.mybayRole || decodedSession?.role || null;
        if (shouldBlockDashboardPathForUser({ pathname: checkPathname, config, role: sessionRole })) {
          console.warn(`[ForwardAuth-Check] Dashboard path blocked: slug=${slug}, path=${checkPathname}, role=${sessionRole || "anonymous"}, billingMode=${config?.modelBillingMode || "byok"}`);
          return res.status(403).json({
            error: "mybay_dashboard_path_forbidden",
            message: "This Hermes Dashboard area is restricted by MyBay security policy."
          });
        }
        console.log(`[ForwardAuth-Check] Session active: user=mybay_session_${slug} hermes_session=active`);
        return res.status(200).send("OK");
      }

      // If MyBay is logged in, but Hermes session is missing
      if (isHtmlRequest) {
        const redirectUrl = buildConsoleLoginUrl({
          slug,
          redirect: buildRedirectTarget(slug, checkUri),
          bridge: true,
          reason: "missing_hermes_session"
        });
        console.log(`[ForwardAuth-Check] Session missing: redirecting to MyBay login with bridge=1: resolvedHost=${resolvedHost}, resolvedSlug=${resolvedSlug}, publicAppUrl=${publicAppUrl}, instancePublicUrl=${instancePublicUrl}, redirectTarget=${redirectUrl}, x-forwarded-proto=${xForwardedProto}, x-forwarded-host=${xForwardedHost}, cf-visitor=${cfVisitor}, NODE_ENV=${nodeEnv}`);
        return res.redirect(redirectUrl);
      } else {
        console.log(`[ForwardAuth-Check] Non-HTML request blocked: uri=${checkUri} status=401`);
        return res.status(401).json({
          error: "mybay_hermes_session_required",
          message: "Agent Web login session is not ready"
        });
      }
    }

    // 4. If not logged in
    if (isHtmlRequest) {
      const consoleLoginUrl = buildConsoleLoginUrl({
        slug,
        redirect: buildRedirectTarget(slug, checkUri)
      });
      console.log(`[ForwardAuth-Check] Session missing: redirecting to MyBay login: resolvedHost=${resolvedHost}, resolvedSlug=${resolvedSlug}, publicAppUrl=${publicAppUrl}, instancePublicUrl=${instancePublicUrl}, redirectTarget=${consoleLoginUrl}, x-forwarded-proto=${xForwardedProto}, x-forwarded-host=${xForwardedHost}, cf-visitor=${cfVisitor}, NODE_ENV=${nodeEnv}`);
      return res.redirect(consoleLoginUrl);
    } else {
      console.log(`[ForwardAuth-Check] Non-HTML request blocked: uri=${checkUri} status=401`);
      // DO NOT write WWW-Authenticate header to avoid browser native basic-auth popups!
      return res.status(401).json({ 
         error: "Unauthorized", 
         message: "Please log in to access this instance's Web UI layer." 
      });
    }
  } catch (err: any) {
    console.error(`[AuthCheck Error] Failed to process forwardauth request:`, err);
    return res.status(500).send("Internal Server Error");
  }
});

// 2. POST /api/public/instances/session-login
router.post("/session-login", async (req: any, res) => {
  try {
    const { slug, username, password } = req.body;
    if (!slug || !username || !password) {
      return sendApiError(res, { status: 400, code: ErrorCodes.MISSING_LOGIN_PARAMETERS, legacyError: "Missing required parameters", message: "缺少参数 (slug, username, password)" });
    }

    const instance = await dbAdapter.getInstanceByPath(slug);
    if (!instance) {
      return sendApiError(res, { status: 404, code: ErrorCodes.INSTANCE_NOT_FOUND, legacyError: "mybay_instance_not_found", message: "实例不存在" });
    }

    let config: any = {};
    try {
      config = JSON.parse(instance.config_json || "{}");
    } catch (parseErr) {
      console.error(`[SessionLogin Error] Invalid config_json for instance slug: ${slug}`);
      return sendApiError(res, { status: 500, code: ErrorCodes.INSTANCE_CONFIG_INVALID, legacyError: "mybay_invalid_config_json", message: "实例配置解析失败" });
    }

    if (!config.webPasswordHash) {
      return res.json({ success: true, message: "该实例未配置访问保护密码，可直接访问。" });
    }

    const configUser = config.username || "admin";
    const isUserOk = username === configUser;
    const isPassOk = bcrypt.compareSync(password, config.webPasswordHash);

    if (!isUserOk || !isPassOk) {
      return sendApiError(res, { status: 401, code: ErrorCodes.INVALID_INSTANCE_CREDENTIALS, legacyError: "访问凭证不匹配，登录授权失败。", message: "访问凭证不匹配，登录授权失败。" });
    }

    const platformUser = await resolvePlatformUserFromRequest(req);

    // Generate signed session cookie
    const token = jwt.sign(
      { instanceId: instance.id, slug, mybayUserId: platformUser?.id || null, mybayRole: platformUser?.role || "user" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const baseDomain = getInstanceRootDomain();
    const isProd = process.env.NODE_ENV === "production";
    const cookieStr = `mybay_session_${slug}=${encodeURIComponent(token)}; Path=/; Domain=.${baseDomain}; HttpOnly; Max-Age=${7 * 24 * 60 * 60}${isProd ? '; Secure' : ''}; SameSite=Lax`;
    
    const cookiesToSet = [cookieStr];

    const enableDashboard = config.enableDashboard ?? true;
    const sessionBridgeEnabled = process.env.HERMES_SESSION_BRIDGE_ENABLED !== "false";
    if (enableDashboard !== false && sessionBridgeEnabled) {
      // --- PROGRAMMATIC HERMES SESSION SSO BRIDGE ---
      const startBridgeTime = Date.now();

      // --- READINESS GATE IN LOGIN ---
      const readiness = await checkInstanceReadiness(instance, config);
      if (!readiness.ready) {
        console.log(JSON.stringify({
          event: "hermes_bridge_attempt",
          source: "session-login",
          instanceId: instance.id,
          slug,
          bridgeStatus: 423,
          reason: readiness.reason,
          setCookieCount: 0,
          durationMs: Date.now() - startBridgeTime
        }));
        res.setHeader("Set-Cookie", [cookieStr]);
        return res.json({
          success: false,
          authorized: true,
          dashboardLoginSucceeded: false,
          bridgeFailed: true,
          mybaySession: true,
          bridgeRequired: true,
          directAccessAllowed: false,
          bridge: {
            success: false,
            retryable: isRetryableReadinessReason(readiness.reason),
            reason: readiness.reason
          },
          code: instanceReadinessReasonToErrorCode(readiness.reason),
          params: { reason: readiness.reason },
          error: "bridge_failed",
          message: `访问授权已通过，但 Agent 安全身份链尚未就绪 (原因: ${readiness.reason})，请稍后。`
        });
      }

      let bridgeSuccess = false;
      let hermesCookiesCount = 0;
      let bridgeStatus = 500;
      let reason = "unknown";
      let fetchedCookies: string[] = [];

      const { tryResolvePlainInstancePassword } = await import("../crypto");
      const plainPassword = tryResolvePlainInstancePassword(config);

      if (!plainPassword) {
        console.log(JSON.stringify({
          event: "hermes_bridge_attempt",
          source: "session-login",
          instanceId: instance.id,
          slug,
          bridgeStatus: 400,
          reason: "missing_plain_instance_password",
          setCookieCount: 0,
          durationMs: Date.now() - startBridgeTime
        }));
        res.setHeader("Set-Cookie", [cookieStr]);
        return res.json({
          success: false,
          authorized: true,
          dashboardLoginSucceeded: false,
          bridgeFailed: true,
          mybaySession: true,
          bridgeRequired: true,
          directAccessAllowed: false,
          bridge: {
            success: false,
            retryable: false,
            reason: "missing_plain_instance_password"
          },
          code: ErrorCodes.INSTANCE_PASSWORD_UNAVAILABLE,
          params: { reason: "missing_plain_instance_password" },
          error: "bridge_failed",
          message: "访问授权已通过，但无法同步 Agent Web 登录态：缺少或无法解密实例访问密码。"
        });
      }
      {
        // Local basic bridge login
        const usernameToUse = username || config.username || "admin";
        const result = await performHermesBridgeLogin(instance, config, usernameToUse, plainPassword, {
          maxAttempts: 2,
          perRequestTimeoutMs: 2500,
          totalDeadlineMs: 10000
        });
        bridgeStatus = result.status || 502;
        reason = result.reason;
        if (result.success) {
          bridgeSuccess = true;
          fetchedCookies = result.cookies;
        }
      }

      const durationMs = Date.now() - startBridgeTime;

      if (bridgeSuccess && fetchedCookies.length > 0) {
        const reqRedirect = req.body.redirect || "/";
        const ticket = createSessionCompleteTicket(slug, fetchedCookies, reqRedirect, token);
        const instancePublicUrl = buildInstancePublicUrl(slug, config.host_port || config.port);
        const completionUrl = `${instancePublicUrl}/__mybay/session-complete?ticket=${ticket}&redirect=${encodeURIComponent(reqRedirect)}`;

        console.log(JSON.stringify({
          event: "hermes_bridge_success",
          source: "session-login",
          instanceId: instance.id,
          slug,
          setCookieCount: fetchedCookies.length,
          durationMs
        }));

        res.setHeader("Set-Cookie", [cookieStr]);
        return res.json({
          success: true,
          authorized: true,
          dashboardLoginSucceeded: true,
          bridgeFailed: false,
          mybaySession: true,
          bridgeRequired: true,
          directAccessAllowed: true,
          bridge: {
            success: true,
            completionUrl
          },
          message: "访问授权成功！"
        });
      } else {
        if (reason === "ok") {
          reason = "missing_hermes_session_cookie";
        }

        console.log(JSON.stringify({
          event: "hermes_bridge_attempt",
          source: "session-login",
          instanceId: instance.id,
          slug,
          bridgeStatus,
          reason,
          setCookieCount: 0,
          durationMs
        }));

        const nonRetryableReasons = [
          "invalid_credentials",
          "basic_auth_not_enabled",
          "hermes_rate_limited",
          "missing_plain_instance_password"
        ];
        const isRetryable = !nonRetryableReasons.includes(reason);

        // Do not return 502 or error. Just set the mybay session cookie and return 200/202 with retryable info.
        res.setHeader("Set-Cookie", [cookieStr]);
        return res.json({
          success: false,
          authorized: true,
          dashboardLoginSucceeded: false,
          bridgeFailed: true,
          mybaySession: true,
          bridgeRequired: true,
          directAccessAllowed: false,
          bridge: {
            success: false,
            retryable: isRetryable,
            reason: reason
          },
          code: instanceBridgeReasonToErrorCode(reason),
          params: { reason },
          error: "bridge_failed",
          message: "访问授权已通过，但同步 Agent Web 登录态失败。"
        });
      }
    }
    // --- END PROGRAMMATIC HERMES SESSION SSO BRIDGE ---

    res.setHeader("Set-Cookie", cookiesToSet);
    return res.json({ success: true, mybaySession: true, bridgeRequired: false, directAccessAllowed: true, message: "访问授权成功！" });
  } catch (err: any) {
    console.error(`[SessionLogin Error] Failed:`, err.message || err);
    return sendApiError(res, { status: 500, code: ErrorCodes.INSTANCE_LOGIN_INTERNAL_ERROR, legacyError: "mybay_login_internal_error", message: "实例登录服务发生内部错误" });
  }
});

// POST /api/public/instances/session-bridge
router.post("/session-bridge", async (req: any, res) => {
  const startBridgeTime = Date.now();
  let slug = "";
  try {
    slug = req.body.slug;
    if (!slug) {
      return sendApiError(res, { status: 400, code: ErrorCodes.MISSING_SLUG, legacyError: "Missing slug", message: "缺少参数 (slug)" });
    }

    const instance = await dbAdapter.getInstanceByPath(slug);
    if (!instance) {
      return sendApiError(res, { status: 404, code: ErrorCodes.INSTANCE_NOT_FOUND, legacyError: "mybay_instance_not_found", message: "实例不存在" });
    }

    // Verify cookies
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[`mybay_session_${slug}`];

    let isLoggedIn = false;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded && decoded.slug === slug && decoded.instanceId === instance.id) {
          isLoggedIn = true;
        }
      } catch (jwtErr) {
        // Token invalid or expired
      }
    }

    if (!isLoggedIn) {
      return sendApiError(res, { status: 401, code: ErrorCodes.INSTANCE_SESSION_UNAUTHORIZED, legacyError: "未授权的访问会话或会话已过期。", message: "未授权的访问会话或会话已过期。" });
    }

    let config: any = {};
    try {
      config = JSON.parse(instance.config_json || "{}");
    } catch (parseErr) {
      return sendApiError(res, { status: 500, code: ErrorCodes.INSTANCE_CONFIG_INVALID, legacyError: "mybay_invalid_config_json", message: "实例配置解析失败" });
    }

    const username = config.username || "admin";
    const { tryResolvePlainInstancePassword } = await import("../crypto");
    const plainPassword = tryResolvePlainInstancePassword(config);

    if (!plainPassword) {
      console.log(JSON.stringify({
        event: "hermes_bridge_attempt",
        source: "session-bridge",
        instanceId: instance.id,
        slug,
        bridgeStatus: 400,
        reason: "missing_plain_instance_password",
        setCookieCount: 0,
        durationMs: Date.now() - startBridgeTime
      }));
      return res.json({
        success: false,
        code: ErrorCodes.INSTANCE_PASSWORD_UNAVAILABLE,
        params: { reason: "missing_plain_instance_password" },
        bridgeFailed: true,
        bridge: {
          success: false,
          retryable: false,
          reason: "missing_plain_instance_password"
        }
      });
    }

    // --- READINESS GATE IN BRIDGE ---
    const readiness = await checkInstanceReadiness(instance, config);
    if (!readiness.ready) {
      console.log(JSON.stringify({
        event: "hermes_bridge_attempt",
        source: "session-bridge",
        instanceId: instance.id,
        slug,
        bridgeStatus: 423,
        reason: readiness.reason,
        setCookieCount: 0,
        durationMs: Date.now() - startBridgeTime
      }));
      return res.json({
        success: false,
        bridgeFailed: true,
        bridge: {
          success: false,
          retryable: isRetryableReadinessReason(readiness.reason),
          reason: readiness.reason
        },
        code: instanceReadinessReasonToErrorCode(readiness.reason),
        params: { reason: readiness.reason },
        error: "bridge_failed",
        message: `同步 Agent Web 登录态失败：Agent 安全身份链尚未就绪 (原因: ${readiness.reason})。`
      });
    }

    let bridgeSuccess = false;
    let hermesCookiesCount = 0;
    let bridgeStatus = 500;
    let reason = "unknown";
    let fetchedCookies: string[] = [];
      {
      // Local basic bridge login
      const result = await performHermesBridgeLogin(instance, config, username, plainPassword, {
        maxAttempts: 2,
        perRequestTimeoutMs: 2500,
        totalDeadlineMs: 12000
      });
      bridgeStatus = result.status || 502;
      reason = result.reason;
      if (result.success) {
        bridgeSuccess = true;
        fetchedCookies = result.cookies;
      }
    }

    const baseDomain = getInstanceRootDomain();
    const durationMs = Date.now() - startBridgeTime;

    if (bridgeSuccess && fetchedCookies.length > 0) {
      const reqRedirect = req.body.redirect || "/";
      const ticket = createSessionCompleteTicket(slug, fetchedCookies, reqRedirect, token);
      const instancePublicUrl = buildInstancePublicUrl(slug, config.host_port || config.port);
      const completionUrl = `${instancePublicUrl}/__mybay/session-complete?ticket=${ticket}&redirect=${encodeURIComponent(reqRedirect)}`;

      console.log(JSON.stringify({
        event: "hermes_bridge_success",
        source: "session-bridge",
        instanceId: instance.id,
        slug,
        setCookieCount: fetchedCookies.length,
        durationMs
      }));

      return res.json({
        success: true,
        bridgeFailed: false,
        bridge: {
          success: true,
          completionUrl
        }
      });
    } else {
      if (reason === "ok") {
        reason = "missing_hermes_session_cookie";
      }
      console.log(JSON.stringify({
        event: "hermes_bridge_attempt",
        source: "session-bridge",
        instanceId: instance.id,
        slug,
        bridgeStatus,
        reason,
        setCookieCount: 0,
        durationMs
      }));

      const nonRetryableReasons = [
        "invalid_credentials",
        "basic_auth_not_enabled",
        "hermes_rate_limited",
        "missing_plain_instance_password"
      ];
      const isRetryable = !nonRetryableReasons.includes(reason);

      return res.json({
        success: false,
        code: instanceBridgeReasonToErrorCode(reason),
        params: { reason },
        bridgeFailed: true,
        bridge: {
          success: false,
          retryable: isRetryable,
          reason
        }
      });
    }

  } catch (err: any) {
    console.error(`[SessionBridge Error] Failed:`, err.message || err);
    return res.status(500).json({
      success: false,
      code: ErrorCodes.INSTANCE_LOGIN_INTERNAL_ERROR,
      params: { reason: "internal_error" },
      bridge: {
        success: false,
        retryable: true,
        reason: "internal_error"
      }
    });
  }
});

function buildExpiredCookies(slug: string, baseDomain: string, reqCookieHeaderValue: string | undefined, isProd: boolean): string[] {
  const cookiesToClear = new Set<string>(["hermes_session_at", "hermes_session_rt"]);
  const reqCookies = parseCookies(reqCookieHeaderValue);
  Object.keys(reqCookies).forEach(name => {
    if (isValidHermesLoginCookieName(name)) {
      cookiesToClear.add(name);
    }
  });

  const expiredCookies = [
    `mybay_session_${slug}=; Path=/; Domain=.${baseDomain}; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isProd ? '; Secure' : ''}; SameSite=Lax`
  ];
  cookiesToClear.forEach(name => {
    expiredCookies.push(`${name}=; Path=/; Domain=.${baseDomain}; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isProd ? '; Secure' : ''}; SameSite=Lax`);
    expiredCookies.push(`${name}=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isProd ? '; Secure' : ''}; SameSite=Lax`);
  });
  return expiredCookies;
}

// 3. POST /api/public/instances/session-logout
router.post("/session-logout", async (req: any, res) => {
  try {
    const { slug } = req.body;
    if (!slug) {
      return res.status(400).json({ error: "Missing slug" });
    }

    const baseDomain = getInstanceRootDomain();
    const isProd = process.env.NODE_ENV === "production";
    
    const expiredCookies = buildExpiredCookies(slug, baseDomain, req.headers.cookie, isProd);
    
    res.setHeader("Set-Cookie", expiredCookies);
    return res.json({ success: true });
  } catch (err: any) {
    console.error(`[SessionLogout Error] Failed:`, err.message || err);
    return res.status(500).json({ error: "mybay_logout_internal_error" });
  }
});

function sanitizeLogoutRedirect(rawRedirect: string | undefined, baseDomain: string, fallback: string): string {
  if (!rawRedirect) return fallback;
  try {
    const url = new URL(rawRedirect);
    if (url.hostname !== baseDomain) return fallback;
    if (url.pathname !== "/instance-login") return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

// 4. GET /api/public/instances/session-logout
router.get("/session-logout", async (req: any, res) => {
  try {
    const slug = req.query.slug as string;
    const redirect = req.query.redirect as string;
    
    if (!slug) {
      return res.status(400).send("Missing slug");
    }

    const baseDomain = getInstanceRootDomain();
    const isProd = process.env.NODE_ENV === "production";
    
    const expiredCookies = buildExpiredCookies(slug, baseDomain, req.headers.cookie, isProd);
    
    res.setHeader("Set-Cookie", expiredCookies);

    const consoleProto = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const defaultFallback = `${getPublicAppUrl()}/instance-login?slug=${encodeURIComponent(slug)}`;

    const safeRedirect = sanitizeLogoutRedirect(redirect, baseDomain, defaultFallback);
    return res.redirect(safeRedirect);
  } catch (err: any) {
    console.error(`[SessionLogout GET Error] Failed:`, err.message || err);
    return res.status(500).send("Logout Internal Error");
  }
});

// Helper function to check if the instance's dashboard auth chain is ready
export function getReasonScore(reason: string): number {
  if (!reason) return 6;
  if (
    reason === "basic_auth_not_enabled" ||
    reason === "missing_hermes_session_cookie" ||
    reason === "hermes_rate_limited" ||
    reason === "invalid_credentials"
  ) {
    return 1;
  }
  if (reason.startsWith("probe_returned_")) {
    const statusStr = reason.substring("probe_returned_".length);
    const status = parseInt(statusStr, 10);
    if (status !== 404 && !(status >= 500 && status < 600)) {
      return 2;
    }
    return 3;
  }
  if (reason.startsWith("status_not_ok_")) {
    const statusStr = reason.substring("status_not_ok_".length);
    const status = parseInt(statusStr, 10);
    if (status >= 500 && status < 600) {
      return 3;
    }
    return 2;
  }
  if (reason === "invalid_json_response") return 4;
  return 5;
}

export function selectBestReason(reasons: string[]): string {
  if (reasons.length === 0) return "no_url_tested";
  let best = reasons[0];
  let bestScore = getReasonScore(best);
  for (let i = 1; i < reasons.length; i++) {
    const score = getReasonScore(reasons[i]);
    if (score < bestScore) {
      best = reasons[i];
      bestScore = score;
    }
  }
  return best;
}

export async function checkHermesAuthChainReadiness(instance: any, config: any): Promise<{ ready: boolean; reason: string }> {
  const { urls, externalHost, networkName } = buildHermesCandidateUrls(instance, config);

  if (networkName) {
    try {
      await ensureConnectedToNetwork(networkName);
    } catch (netErr: any) {
      console.warn(`[Readiness Check] Network connection pre-check failed:`, netErr.message || netErr);
    }
  }

  const reasons: string[] = [];

  for (const baseUrl of urls) {
    try {
      // 1. Check status first
      console.log(`[Readiness Check] Querying ${baseUrl}/api/status`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      let res: any;
      try {
        res = await fetch(`${baseUrl}/api/status`, {
          headers: {
            "Host": externalHost,
            "X-Forwarded-Host": externalHost,
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Port": "443",
            "X-Real-IP": "127.0.0.1"
          },
          signal: controller.signal
        });
        clearTimeout(timeout);
      } catch (err: any) {
        clearTimeout(timeout);
        reasons.push(err.message || err);
        continue;
      }

      let statusCheckPassed = false;
      if (res.ok) {
        const statusJson = await res.json().catch(() => null);
        if (!statusJson) {
          reasons.push("invalid_json_response");
        } else if (statusJson.auth_required !== true || !Array.isArray(statusJson.auth_providers) || !statusJson.auth_providers.includes("basic")) {
          reasons.push("basic_auth_not_enabled");
        } else {
          statusCheckPassed = true;
        }
      } else if (res.status === 401 || res.status === 404) {
        // 401 is treated as "service is active and guarded by auth", so we allow proceeding to probe password-login
        // 404 is treated as a new version compatibility mode that removed /api/status, allowing proceeding to probe password-login
        statusCheckPassed = true;
      } else {
        reasons.push(`status_not_ok_${res.status}`);
      }

      if (!statusCheckPassed) {
        continue;
      }

      // 2. Probe /auth/password-login
      console.log(`[Readiness Check] Probing ${baseUrl}/auth/password-login`);
      const probeController = new AbortController();
      const probeTimeout = setTimeout(() => probeController.abort(), 2000);
      let probeRes: any;
      try {
        probeRes = await fetch(`${baseUrl}/auth/password-login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Host": externalHost,
            "X-Forwarded-Host": externalHost,
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Port": "443",
            "X-Real-IP": "127.0.0.1"
          },
          body: JSON.stringify({
            username: "dummy_probe_user_not_real",
            password: "dummy_probe_password"
          }),
          signal: probeController.signal
        });
        clearTimeout(probeTimeout);
      } catch (err: any) {
        clearTimeout(probeTimeout);
        reasons.push(`probe_failed_${err.message || err}`);
        continue;
      }

      // Only allow 400, 401, 403, 422, 429 from password-login endpoint to indicate readiness.
      // 422 indicates the endpoint exists and is performing request validation, which confirms it is ready.
      const allowedProbeStatuses = [400, 401, 403, 422, 429];
      if (!allowedProbeStatuses.includes(probeRes.status)) {
        reasons.push(`probe_returned_${probeRes.status}`);
        continue;
      }

      // Explicitly matched (400, 401, 403, 422, 429) indicating password-login endpoint is active and authenticated basic auth chain exists
      return { ready: true, reason: "ok" };
    } catch (err: any) {
      reasons.push(err.message || err);
    }
  }

  const bestReason = selectBestReason(reasons);
  return { ready: false, reason: bestReason };
}

// Check readiness against the local Hermes runtime.
export async function checkInstanceReadiness(instance: any, config: any): Promise<{ ready: boolean; reason: string }> {
  return checkHermesAuthChainReadiness(instance, config);
}
// Helper to determine if a readiness failure reason is transient/retryable
export function isRetryableReadinessReason(reason: string): boolean {
  if (!reason) return false;

  const nonRetryableReasons = [
    "basic_auth_not_enabled",
    "missing_plain_instance_password",
    "invalid_config",
  ];

  if (nonRetryableReasons.includes(reason)) {
    return false;
  }

  if (
    reason.startsWith("status_not_ok_") ||
    reason.startsWith("probe_failed_") ||
    reason === "network_not_ready" ||
    reason === "invalid_json_response"
  ) {
    return true;
  }

  if (reason.startsWith("probe_returned_")) {
    const statusStr = reason.substring("probe_returned_".length);
    const status = parseInt(statusStr, 10);
    if (status === 404 || (status >= 500 && status < 600)) {
      return true;
    }
    return false;
  }

  const lowerReason = reason.toLowerCase();
  if (
    lowerReason.includes("fetch failed") ||
    lowerReason.includes("timeout") ||
    lowerReason.includes("refused") ||
    lowerReason.includes("econnrefused") ||
    lowerReason.includes("aborted") ||
    lowerReason.includes("etimedout") ||
    lowerReason.includes("enotfound") ||
    lowerReason.includes("ehostunreach")
  ) {
    return true;
  }

  return false;
}

// 5. GET /api/public/instances/readiness/:slug
router.get("/readiness/:slug", async (req: any, res) => {
  const { slug } = req.params;
  if (!slug) {
    return sendApiError(res, { status: 400, code: ErrorCodes.MISSING_SLUG, legacyError: "Missing slug", message: "Missing slug", extra: { ready: false } });
  }
  try {
    const instance = await dbAdapter.getInstanceByPath(slug);
    if (!instance) {
      return sendApiError(res, { status: 404, code: ErrorCodes.INSTANCE_NOT_FOUND, legacyError: "mybay_instance_not_found", message: "Instance not found", extra: { ready: false } });
    }

    let config: any = {};
    try {
      config = JSON.parse(instance.config_json || "{}");
    } catch {
      return res.json({ ready: false, code: ErrorCodes.INSTANCE_CONFIG_INVALID, params: { reason: "invalid_config" }, reason: "invalid_config", retryable: false, canManualFallback: false });
    }

    const { tryResolvePlainInstancePassword } = await import("../crypto");
    const plainPassword = tryResolvePlainInstancePassword(config);

    if (!plainPassword) {
      return res.json({ ready: false, code: ErrorCodes.INSTANCE_PASSWORD_UNAVAILABLE, params: { reason: "missing_plain_instance_password" }, reason: "missing_plain_instance_password", retryable: false, canManualFallback: false });
    }

    const result = await checkInstanceReadiness(instance, config);
    const retryable = isRetryableReadinessReason(result.reason);
    return res.json({
      ...result,
      ...(result.ready ? {} : { code: instanceReadinessReasonToErrorCode(result.reason), params: { reason: result.reason } }),
      retryable,
      canManualFallback: retryable
    });
  } catch (err: any) {
    console.error(`[Readiness Route Error] Failed:`, err.message || err);
    return sendApiError(res, { status: 500, code: ErrorCodes.INSTANCE_READINESS_INTERNAL_ERROR, legacyError: "internal_error", message: "Readiness check failed", extra: { ready: false } });
  }
});

export default router;

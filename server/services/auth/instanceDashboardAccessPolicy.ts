import jwt from "jsonwebtoken";
import { dbAdapter } from "../../db";
import { JWT_SECRET } from "../../utils/authSecrets";
import { getPublicAppUrl } from "../../utils/publicUrl";
import { safeDecodeCookieValue } from "./hermesCookiePolicy";

export function isReservedAuthPath(pathname: string): boolean {
  const norm = pathname.toLowerCase().replace(/\/+$/, "");
  return norm === "/login" || norm === "/auth/login" || norm === "/auth/password-login"
    || norm.startsWith("/login/") || norm.startsWith("/auth/login/") || norm.startsWith("/auth/password-login/");
}

const SENSITIVE_DASHBOARD_PATHS = ["/env", "/keys", "/system", "/config", "/logs", "/files"];
const PLATFORM_MODEL_EXTRA_BLOCKED_PATHS = ["/models", "/channels", "/webhooks", "/gateway", "/mcp", "/tools", "/plugins", "/skills", "/pairing", "/profiles"];

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

export async function resolvePlatformUserFromRequest(req: any): Promise<any | null> {
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
    return !user || user.status === "disabled" ? null : user;
  } catch { return null; }
}

export function shouldBlockDashboardPathForUser(options: { pathname: string; config: any; role?: string | null }) {
  if (options.role === "admin" || options.role === "super_admin") return false;
  if (matchesProtectedDashboardPath(options.pathname, SENSITIVE_DASHBOARD_PATHS)) return true;
  return options.config?.modelBillingMode === "platform" && matchesProtectedDashboardPath(options.pathname, PLATFORM_MODEL_EXTRA_BLOCKED_PATHS);
}

export function buildConsoleLoginUrl(options: { slug: string; redirect: string; bridge?: boolean; reason?: string }): string {
  let url = `${getPublicAppUrl()}/instance-login?slug=${encodeURIComponent(options.slug)}&redirect=${encodeURIComponent(options.redirect)}`;
  if (options.bridge) url += "&bridge=1";
  if (options.reason) url += `&reason=${encodeURIComponent(options.reason)}`;
  return url;
}

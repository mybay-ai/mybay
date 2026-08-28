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
import { getReasonScore, selectBestReason } from "../services/auth/instanceReadinessReasonPolicy";
import {
  hasHermesSessionCookie,
  isValidHermesLoginCookieName,
  parseCookies,
  parseSetCookie,
  rewriteHermesCookieHostOnly,
  splitCombinedSetCookie,
} from "../services/auth/hermesCookiePolicy";
import {
  buildConsoleLoginUrl,
  isReservedAuthPath,
  resolvePlatformUserFromRequest,
  shouldBlockDashboardPathForUser,
} from "../services/auth/instanceDashboardAccessPolicy";
import {
  createSessionCompleteTicket,
  deleteSessionCompleteTicket,
  getSessionCompleteTicket,
} from "../services/auth/sessionCompleteTicketStore";


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

    const data = getSessionCompleteTicket(ticket);
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
    deleteSessionCompleteTicket(ticket);

    res.setHeader("Set-Cookie", cookiesToSet);
    return res.redirect(safeRedirect);

  } catch (err: any) {
    console.error(`[SessionComplete Error] Failed:`, err.message || err);
    return res.status(500).send("Session Complete Internal Error");
  }
}

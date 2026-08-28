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

export { getReasonScore, selectBestReason } from "../services/auth/instanceReadinessReasonPolicy";

const router = Router();

import {
  buildHermesCandidateUrls,
  ensureConnectedToNetwork,
  performHermesBridgeLogin,
} from "./instanceHermesBridge";
import type { HermesBridgeLoginOptions } from "./instanceHermesBridge";

export { createSessionCompleteTicket } from "../services/auth/sessionCompleteTicketStore";

export { handleSessionComplete } from "./instanceSessionCompletion";

export {
  buildHermesCandidateUrls,
  performHermesBridgeLogin,
} from "./instanceHermesBridge";
export type { HermesBridgeLoginOptions } from "./instanceHermesBridge";

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
import {
  checkInstanceReadiness,
  isRetryableReadinessReason,
} from "./instanceSessionReadiness";

export {
  checkHermesAuthChainReadiness,
  checkInstanceReadiness,
  isRetryableReadinessReason,
} from "./instanceSessionReadiness";

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

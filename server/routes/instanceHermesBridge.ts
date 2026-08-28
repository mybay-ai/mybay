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


export async function ensureConnectedToNetwork(networkName: string) {
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

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
import { buildHermesCandidateUrls, ensureConnectedToNetwork } from "./instanceHermesBridge";
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

import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext, rebuildProxyConfig } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { RouterDependencies } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt } from "../../crypto";
import bcrypt from "bcryptjs";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";

import { sanitizeErrorMessage, sanitizeInstance } from "../../utils/sanitizer";
import { userResourcePoliciesRepo } from "../../repositories/userResourcePoliciesRepo";
import { buildInstancePublicUrl } from "../../utils/publicUrl";
import { DEFAULT_USER_DISK_LIMIT_MB } from "../../constants/resourceLimits";
import { FEATURE_KEYS, getEffectiveEntitlements, getInstanceLimit } from "../../services/entitlements";
import { getDeploymentModeConfig } from "../../services/deploymentMode";

function entitlementFeatureEnabled(value: any, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return ["true", "1", "yes", "enabled"].includes(String(value).toLowerCase());
}

export function filterVisibleInstances(rows: any[]): any[] {
  return rows.filter((row: any) => row.status !== "deleted");
}

export function createListRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.get("/can-create", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rows = await dbAdapter.getInstances(req.user.id, req.user.role);
      const activeInstances = rows.filter((row: any) => isQuotaConsumingStatus(row.status));
      
      const entitlements = await getEffectiveEntitlements(req.user);
      const limit = await getInstanceLimit(req.user, resolveInstanceLimit(req.user));
      const isUnlimited = limit === null;
      const isLimitReached = !isUnlimited && activeInstances.length >= limit;
      const externalChannelsAllowed = entitlements.privileged || entitlementFeatureEnabled(entitlements.features[FEATURE_KEYS.EXTERNAL_CHANNELS], false);
      
      res.json({
        canCreate: !isLimitReached,
        plan: entitlements.planCode || (req.user.role === 'admin' ? "Pro/Admin" : "Free"),
        subscriptionPlan: entitlements.planCode,
        features: entitlements.features,
        externalChannelsAllowed,
        limit: limit,
        used: activeInstances.length,
        reason: isLimitReached ? "INSTANCE_LIMIT_REACHED" : null,
        existingInstances: activeInstances.map((i: any) => {
          const resolvedUrl = i.url || (i.path ? buildInstancePublicUrl(i.path) : null);
          return {
            id: i.id,
            name: i.name,
            status: i.status,
            url: resolvedUrl
          };
        })
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to check quota" });
    }
  });

  router.get("/me/quota", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { getUserQuotaDetails } = require("../../services/entitlements");
      const quota = await getUserQuotaDetails(req.user);
      res.json({
        ...quota,
        // Keep activeInstances/maxActiveInstances for compatibility with any legacy client usage
        activeInstances: quota.instanceUsed,
        maxActiveInstances: quota.instanceLimit,
        isUnlimited: quota.instanceLimit === null
      });
    } catch (e: any) {
      console.error("[Quota Error]", e);
      res.status(500).json({ error: "Quota fetch fail" });
    }
  });

  router.get("/usage-summary", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { getUserQuotaDetails } = require("../../services/entitlements");
      const quota = await getUserQuotaDetails(req.user);
      
      const rows = await dbAdapter.getInstances(req.user.id, req.user.role);
      const runningInstances = rows.filter((row: any) => row.status === 'running' || row.status === 'partial_running');

      res.setHeader("Cache-Control", "no-store");
      res.json({
        ...quota,
        runningInstances: runningInstances.length,
        // Keep storageUsedMb/storageLimitMb for compatibility with legacy stats
        storageUsedMb: quota.allocatedDiskMb,
        storageLimitMb: quota.totalDiskQuotaMb
      });
    } catch (e: any) {
      console.error("[Usage Summary Error]", e);
      res.status(500).json({ error: "Failed to fetch usage summary" });
    }
  });

  router.get("/", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    let rows: any[];
    try {
      rows = await dbAdapter.getInstances(req.user.id, req.user.role);
      const deploymentAccess = await getDeploymentModeConfig();
      
      const instances = await Promise.all(filterVisibleInstances(rows).map(async (row: any) => {
        const tEnv = parseTraefikEnv(process.env);
        const sanitized = sanitizeInstance(row, "list");
        let configForUrl: any = {};
        try {
          configForUrl = typeof row.config_json === "string" ? JSON.parse(row.config_json) : (row.config_json || {});
        } catch (e) {}
        const pathSlug = sanitized.path || row.path || configForUrl.path || configForUrl.slug;
        const localPort = configForUrl.host_port || configForUrl.port;
        const generatedUrl = pathSlug ? buildInstancePublicUrl(pathSlug, localPort, {
          mode: configForUrl.deployment_mode || deploymentAccess.mode,
          host: configForUrl.instance_access_host || deploymentAccess.accessHost,
        }) : null;
        const resolvedUrl = tEnv.isLocal ? generatedUrl : (sanitized.url || sanitized.public_url || row.url || row.public_url || generatedUrl);
        const cleanupTask = row.desired_state === "deleted" ? await dbAdapter.getLatestCleanupTaskForInstance(row.id) : null;
        
        return {
          ...sanitized,
          url: resolvedUrl,
          public_url: resolvedUrl,
          proxyMode: deploymentAccess.mode === "desktop" ? "local" : deploymentAccess.mode === "lan" ? "lan" : tEnv.proxyMode,
          deploymentMode: deploymentAccess.mode,
          showDebugProxyCommands: process.env.SHOW_DEBUG_PROXY_COMMANDS === "true" && (req.user.role === 'admin' || req.user.username === 'developer'),
          traefikNetwork: tEnv.traefikNetwork,
          cleanupStatus: cleanupTask?.status || null,
          cleanupStep: cleanupTask?.current_step || null,
          cleanupErrorCode: cleanupTask?.error_code || null,
          cleanupErrorMessage: cleanupTask?.error_message ? sanitizeErrorMessage(cleanupTask.error_message) : null,
          cleanupNextRetryAt: cleanupTask?.next_retry_at || null,
        };
      }));
      res.json(instances);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch instances" });
    }
  });

  return router;
}

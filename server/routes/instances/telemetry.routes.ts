import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext, rebuildProxyConfig } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { checkInstanceStorageQuota } from "../../services/instances/instanceStorageQuotaService";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion, resolveInstanceDataDir } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { RouterDependencies } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload, checkAccessBridgeCompatibility } from "./helpers";
import { encrypt } from "../../crypto";
import bcrypt from "bcryptjs";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";

import { getUpgradeLogs } from "../../upgradeManager";
import { redactSecretsDeep, sanitizeErrorMessage } from "../../utils/sanitizer";

export function createTelemetryRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.get("/:id/upgrade-logs", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const logs = await getUpgradeLogs(req.params.id);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err.message) });
    }
  });

  router.get("/:id/audit-logs", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: You do not have permission to view these logs" });
      }
      
      const logs = await dbAdapter.getAuditLogs(req.params.id);
      res.json(redactSecretsDeep(logs));
    } catch (e) {
      res.status(500).json({ error: "Server error" });
    }
  });

  router.get("/:id/stats", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Instance not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Check cache after authority checks
      const cacheKey = req.params.id;
      const cached = containerStatsCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < 4500)) {
        return res.json(cached.data);
      }

      const eligibleStatuses = new Set([
        "creating",
        "container_starting",
        "dashboard_ready",
        "gateway_starting",
        "gateway_ready",
        "running",
        "partial_running",
        "unhealthy",
        "stopped"
      ]);

      if (!eligibleStatuses.has((instance.status || "").toLowerCase())) {
        const accessBridgeCompatibility = await checkAccessBridgeCompatibility(instance).catch(() => ({ required: false, compatible: true }));
        return res.json({ cpu: 0, memory: 0, memoryPercent: 0, status: instance.status, uptime: 0, accessBridgeCompatibility });
      }

      const accessBridgeCompatibility = await checkAccessBridgeCompatibility(instance).catch(() => ({ required: false, compatible: true }));
      const ctx = buildDeploymentContext(instance);
      const container = docker.getContainer(ctx.dashboardContainerName);

      let isContainerRunning = false;
      let dockerStartedAt: string | null = null;
      let containerInspectPassed = false;
      let overlaySizeRwBytes: number | null = null;

      let config: any = {};
      try {
        config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
      } catch (e) {}

      try {
        const inspectState: any = await (container.inspect as any)({ size: true }).catch(() => container.inspect());
        containerInspectPassed = true;
        isContainerRunning = inspectState.State?.Running;
        if (inspectState.SizeRw !== undefined) {
          overlaySizeRwBytes = inspectState.SizeRw;
        }
        if (inspectState.State?.StartedAt) {
          dockerStartedAt = inspectState.State.StartedAt;
        }
      } catch (inspectErr: any) {
        // Container not created yet, which is expected during 'creating' phase
        console.warn(`[Stats API Warn] Inspect failed for instance ${req.params.id}: ${inspectErr.message}`);
      }

      if (!containerInspectPassed || !isContainerRunning) {
        // Calculate storage stats even if container is stopped
        const storageCheckedAt = new Date().toISOString();
        const instanceDir = resolveInstanceDataDir(instance);
        const quota = await checkInstanceStorageQuota(instance, instanceDir);

        const stoppedResponse = {
          cpu: 0,
          memory: 0,
          memoryPercent: 0,
          status: instance.status,
          dockerStartedAt: dockerStartedAt,
          isRunning: false,
          uptime: 0,
          overlaySizeRwBytes: null,
          ...quota,
          storageCheckedAt,
          accessBridgeCompatibility
        };
        containerStatsCache.set(cacheKey, { data: stoppedResponse, timestamp: Date.now() });
        return res.json(stoppedResponse);
      }

      // Container is running physically, retrieve real stats
      try {
        const stats = await container.stats({ stream: false });
        
        // Calculate CPU percentage
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
        const onlineCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
        
        let cpuPercent = 0;
        if (systemDelta > 0 && cpuDelta > 0) {
          cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100.0;
        }

        // Calculate Memory usage in MB
        const memUsage = stats.memory_stats.usage || 0;
        const memLimit = stats.memory_stats.limit || 1;
        const memPercent = (memUsage / memLimit) * 100.0;
        const memMB = Math.round(memUsage / (1024 * 1024));

        // Calculate storage stats
        const storageCheckedAt = new Date().toISOString();
        const instanceDir = resolveInstanceDataDir(instance);
        const quota = await checkInstanceStorageQuota(instance, instanceDir);

        const responseData = {
          cpu: parseFloat(cpuPercent.toFixed(1)),
          memory: memMB,
          memoryPercent: parseFloat(memPercent.toFixed(1)),
          status: instance.status,
          dockerStartedAt: dockerStartedAt,
          isRunning: true,
          overlaySizeRwBytes,
          ...quota,
          storageCheckedAt,
          accessBridgeCompatibility
        };

        containerStatsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
        return res.json(responseData);
      } catch (err: any) {
        console.error(`[Stats API Error] Failed to fetch docker stats for instance ${req.params.id}:`, err);
        return res.status(500).json({
          error: "DOCKER_STATS_ERROR",
          message: `获取容器底层运行指标失败: ${sanitizeErrorMessage(err.message)}`,
          status: instance.status,
          dockerStartedAt: dockerStartedAt,
          isRunning: false
        });
      }
    } catch (error: any) {
      console.error(`[Stats Routing Crash] Stats API crashed for request:`, error);
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: sanitizeErrorMessage(error.message) });
    }
  });

  return router;
}

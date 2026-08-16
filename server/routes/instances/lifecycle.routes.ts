import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import { executeDeployment, buildDeploymentContext } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { RouterDependencies, invalidateContainerStatsCache } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt } from "../../crypto";
import bcrypt from "bcryptjs";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { rebuildProxyConfig } from "../../deployment"; // Used maybe? Assumed in configWriter
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../../utils/ip";
import { sanitizeErrorMessage } from "../../utils/sanitizer";

const deleteLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // max 30 deletions / archives per 1 minute to allow bulk deletes
  keyGenerator: (req: any) => `inst_delete:ip:${getClientIp(req)}:user:${req.user?.id || 'anon'}`,
  message: { error: "操作过于频繁，请稍候再试。" }
});

const renameLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3, // max 3 renames per minute
  keyGenerator: (req: any) => `inst_rename:ip:${getClientIp(req)}:user:${req.user?.id || 'anon'}`,
  message: { error: "操作过于频繁，请稍候再试。" }
});

export function createLifecycleRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.delete("/:id", authenticateToken, deleteLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const isArchive = req.query.archive === 'true';
    console.log(`${isArchive ? 'Archiving' : 'Deleting'} instance:`, req.params.id);
    
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      if (!isArchive) {
        await dbAdapter.updateInstanceRecord(instance.id, {
          desired_state: "deleted",
          status: "deleting",
          health_status: "unknown",
          delete_requested_at: new Date().toISOString(),
        });
        await dbAdapter.cancelDeploymentTasksForInstance(instance.id);
        const cleanupTask = await dbAdapter.createCleanupTask(instance.id, "delete");
        await dbAdapter.insertAuditLog({ instance_id: instance.id, action: "delete_requested", user_id: req.user.id, timestamp: new Date().toISOString(), details: "Deletion requested; cleanup saga queued." });
        io.emit("instances_updated", { id: instance.id, status: "deleting" });
        return res.status(202).json({
          instanceId: instance.id,
          cleanupTaskId: cleanupTask.id,
          status: "deleting",
        });
      }

      await dbAdapter.updateInstanceRecord(instance.id, {
        desired_state: "archived",
        status: "archiving",
        health_status: "unknown",
        archive_requested_at: new Date().toISOString(),
      });
      await dbAdapter.cancelDeploymentTasksForInstance(instance.id);
      const cleanupTask = await dbAdapter.createCleanupTask(instance.id, "archive");
      await dbAdapter.insertAuditLog({
        instance_id: instance.id, action: "archive_requested", user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Archive requested; persistent cleanup saga queued.",
      });
      io.emit("instances_updated", { id: instance.id, status: "archiving", action: "archive" });
      return res.status(202).json({
        instanceId: instance.id,
        cleanupTaskId: cleanupTask.id,
        status: "archiving",
      });
    } catch (e: any) {
      console.error("Instance operation error:", e);
      res.status(500).json({ error: "Operation failed: " + sanitizeErrorMessage(e.message || String(e)) });
    }
  });

  router.patch("/:id/rename", authenticateToken, renameLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { name } = req.body;

      if (typeof name !== "string") {
        return res.status(400).json({ error: "实例名称参数不合法" });
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        return res.status(400).json({ error: "实例名称不能为空" });
      }

      if (trimmedName.length > 50) {
        return res.status(400).json({ error: "实例名称长度不能超过 50 个字符" });
      }

      const instance: any = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ error: "未找到指定的实例" });
      }

      // Check permissions: owner or admin
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "您没有权限修改此实例的名称" });
      }

      const oldName = instance.name;

      // Update name in DB
      await dbAdapter.updateInstanceName(id, trimmedName);

      // Create audit log
      try {
        await dbAdapter.insertAuditLog({
          instance_id: id,
          action: "rename_instance",
          user_id: req.user.id,
          timestamp: new Date().toISOString(),
          details: `实例重命名：旧名称 "${oldName}" -> 新名称 "${trimmedName}"`
        });
      } catch (auditErr) {
        console.error("Failed to insert rename audit log:", auditErr);
      }

      // Invalidate cache and notify
      try {
        invalidateContainerStatsCache(id);
        io.emit("instances_updated", { id, name: trimmedName });
      } catch (wsErr) {
        console.error("WebSocket or cache invalidation error:", wsErr);
      }

      res.json({ success: true, name: trimmedName });
    } catch (err: any) {
      console.error("Instance rename error:", err);
      res.status(500).json({ error: "重命名实例失败，请稍后重试。" });
    }
  });

  return router;
}

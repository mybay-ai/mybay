import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { buildVersionFamilies } from "../../repositories/versionsRepo";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext } from "../../deployment";
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
import { rebuildProxyConfig } from "../../deployment"; // Used maybe? Assumed in configWriter
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";

export function createVersionsRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.get("/agent-versions", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const raw = await dbAdapter.getMyBayVersions();
      const families = buildVersionFamilies(raw).slice(0, 3);
      const mapped = families.map((v: any) => {
        const capabilities = v.capabilities || ["core"];
        const hasFeishu = capabilities.includes("feishu") || !!v.feishuVariant;
        return {
          tag: v.tag,
          version: v.version,
          desc: v.changelog || "No release notes available.",
          releaseAt: v.published_at ? v.published_at.substring(0, 10) : "",
          capabilities,
          feishu_capable: hasFeishu,
          is_prewarmed: v.is_prewarmed,
          prewarm_status: v.prewarm_status,
          coreVariant: v.coreVariant,
          feishuVariant: v.feishuVariant
        };
      });
      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/bulk-upgrade", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { instanceIds, tag } = req.body;
      if (!instanceIds || !Array.isArray(instanceIds) || instanceIds.length === 0) {
        return res.status(400).json({ error: "请提供需要批量升级的实例 ID 列表。" });
      }
      if (!tag) {
        return res.status(400).json({ error: "请提供目标镜像 tag 版本。" });
      }
      const { validateBulkUpgrade, bulkUpgrade } = require("../../upgradeManager");
      
      const validation = await validateBulkUpgrade(instanceIds, tag);
      if (!validation.success) {
        return res.status(400).json({ 
          error: validation.error, 
          code: validation.code || "INCOMPATIBLE_AGENT_VERSION" 
        });
      }

      bulkUpgrade(instanceIds, tag, req.user.id, req.user.role, io);
      res.json({ success: true, message: "已在后台启动实例批量升级队列，并发限制为 2 台，请查看实例状态。" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/:id/upgrade", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { tag } = req.body;
      if (!tag) {
        return res.status(400).json({ error: "请提供目标镜像 tag 版本。" });
      }
      const { validateUpgradeTag, upgradeInstance } = require("../../upgradeManager");
      
      const validation = await validateUpgradeTag(req.params.id, tag);
      if (!validation.success) {
        return res.status(400).json({ 
          error: validation.error, 
          code: validation.code || "INCOMPATIBLE_AGENT_VERSION" 
        });
      }

      const resolvedTag = validation.resolvedTag || tag;
      upgradeInstance(req.params.id, resolvedTag, req.user.id, req.user.role, io);
      res.json({ success: true, message: "已在后台启动升级任务，详情请查看更新日志。", resolvedTag });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/:id/rollback", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { rollbackInstance } = require("../../upgradeManager");
      const result = await rollbackInstance(req.params.id, req.user.id, req.user.role, io);
      if (result.success) {
        res.json({ success: true, message: "已成功出发异步回滚任务，请查看历史详情日志。" });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

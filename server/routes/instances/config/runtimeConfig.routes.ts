import { Router, Response } from "express";
import { dbAdapter } from "../../../db";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { sanitizeConfig } from "../../../utils/sanitizer";

function canManageAllowMode(instance: any, req: AuthenticatedRequest) {
  return instance.user_id === req.user.id || instance.owner_id === req.user.id || req.user.role === "admin";
}

function canReadOrUpdateRuntimeConfig(instance: any, req: AuthenticatedRequest) {
  return instance.user_id === req.user.id || req.user.role === "admin";
}

export function createRuntimeConfigRoutes() {
  const router = Router();

  router.post("/:id/allow-mode", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (!canManageAllowMode(instance, req)) return res.status(403).json({ error: "Forbidden: Access denied" });

      const { allowMode } = req.body;
      if (!["bind_later", "allowlist", "allow_all", "disabled"].includes(allowMode)) {
        return res.status(400).json({ error: "Invalid allowMode" });
      }
      const config = JSON.parse(instance.config_json || "{}");
      config.allowMode = allowMode;
      config.gatewayAllowAllUsers = allowMode === "allow_all";
      await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));

      const { writePhysicalConfigs } = await import("../../../configWriter");
      const { hydrateA2ARuntimePeers } = await import("../../../services/a2aRuntimeConfig");
      await hydrateA2ARuntimePeers(instance.id, config);
      writePhysicalConfigs(instance.id, config);
      const { docker } = await import("../../../lib/docker");
      try {
        await dbAdapter.insertAuditLog({
          instance_id: instance.id,
          action: "restart_container",
          user_id: req.user.id,
          timestamp: new Date().toISOString(),
          details: "Restart container for allowMode config update",
        }).catch(() => console.error);
        await docker.getContainer(`mybay-agent-${instance.id}`).restart();
      } catch (error) {
        console.warn("[AllowMode] Failed to restart container:", error);
      }
      res.json({ success: true, allowMode, config: sanitizeConfig(config) });
    } catch (error: any) {
      console.error("[Config API] Save error:", error);
      res.status(500).json({ error: "保存配置失败，服务器内部异常" });
    }
  });

  router.get("/:id/runtime-context", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (!canReadOrUpdateRuntimeConfig(instance, req)) return res.status(403).json({ error: "Forbidden: Access denied" });
      const configJson = JSON.parse(instance.config_json || "{}");
      const { parseInstanceRuntimeContext } = await import("../../../services/instanceRuntimeContext");
      res.json(parseInstanceRuntimeContext(instance, configJson, configJson.businessConfig || {}));
    } catch (error: any) {
      console.error("[Config API] Get runtime context error:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.get("/:id/business-config", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (!canReadOrUpdateRuntimeConfig(instance, req)) return res.status(403).json({ error: "Forbidden: Access denied" });
      const config = JSON.parse(instance.config_json || "{}");
      res.json({ businessConfig: config.businessConfig || {} });
    } catch (error: any) {
      console.error("[Config API] Get business config error:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.put("/:id/business-config", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (!canReadOrUpdateRuntimeConfig(instance, req)) return res.status(403).json({ error: "Forbidden: Access denied" });
      const config = JSON.parse(instance.config_json || "{}");
      config.businessConfig = { ...config.businessConfig, ...req.body.businessConfig };
      await dbAdapter.updateInstanceConfig(req.params.id, JSON.stringify(config));
      try {
        const { refreshInstanceWorkflowReadiness } = await import("../../../services/workflowReadinessService");
        await refreshInstanceWorkflowReadiness(req.params.id, config);
      } catch (error: any) {
        console.warn("[Business Config] Failed to synchronize workflow readiness:", error.message || String(error));
      }
      await dbAdapter.insertAuditLog({
        instance_id: req.params.id,
        action: "update_business_config",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Updated instance business configuration",
      });
      res.json({ success: true, businessConfig: config.businessConfig });
    } catch (error: any) {
      console.error("[Config API] Put business config error:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  return router;
}

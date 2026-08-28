import { Router, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { dbAdapter } from "../../db";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { isAdvancedResourceConfigEnabled } from "../../utils/advancedResourceConfigFeature";
import { getClientIp } from "../../utils/ip";
import { sanitizeErrorMessage } from "../../utils/sanitizer";

function isAdmin(req: AuthenticatedRequest) {
  return req.user.role === "admin" || req.user.role === "super_admin";
}

const settingsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: AuthenticatedRequest) => req.user?.id
    ? `system-settings:user:${req.user.id}`
    : `system-settings:ip:${ipKeyGenerator(req.ip)}`,
  message: { error: "系统设置操作过于频繁，请稍后重试" },
});

export function createSystemSettingsRoutes() {
  const router = Router();

  router.get("/settings", settingsLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "权限不足，仅管理员可读取系统设置" });
    try {
      const adminDockerSocketEnabled = await dbAdapter.getSystemSettingBoolean("admin_docker_socket_enabled", false);
      return res.json({
        admin_docker_socket_enabled: adminDockerSocketEnabled,
        ENABLE_DOCKER_SOCKET_SKILL: process.env.ENABLE_DOCKER_SOCKET_SKILL === "true",
      });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(error.message) || "获取系统设置失败" });
    }
  });

  router.patch("/settings", settingsLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "权限不足，仅管理员可修改系统设置" });
    const { admin_docker_socket_enabled } = req.body;
    if (admin_docker_socket_enabled === undefined) return res.status(400).json({ error: "请提供 admin_docker_socket_enabled 状态" });
    if (typeof admin_docker_socket_enabled !== "boolean") {
      return res.status(400).json({ error: "参数格式错误：admin_docker_socket_enabled 必须为明确的布尔值 (true 或 false)" });
    }

    try {
      const oldValue = await dbAdapter.getSystemSettingBoolean("admin_docker_socket_enabled", false);
      const newValue = admin_docker_socket_enabled;
      await dbAdapter.setSystemSettingBoolean("admin_docker_socket_enabled", newValue);
      await dbAdapter.insertAuditLog({
        action: "admin_docker_socket_enabled_updated",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: `Admin updated admin_docker_socket_enabled from ${oldValue} to ${newValue}. IP: ${getClientIp(req)}, UA: ${req.headers["user-agent"] || ""}`,
      }).catch((error) => console.error("[AuditLog] Failed to insert:", error));
      return res.json({
        admin_docker_socket_enabled: newValue,
        old_value: oldValue,
        new_value: newValue,
        ENABLE_DOCKER_SOCKET_SKILL: process.env.ENABLE_DOCKER_SOCKET_SKILL === "true",
      });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(error.message) || "更新系统设置失败" });
    }
  });

  router.get("/local-resource-policy", settingsLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    if (!isAdvancedResourceConfigEnabled()) return res.status(404).json({ error: "Advanced resource configuration is disabled" });
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin role required" });
    const { getLocalResourcePolicy } = await import("../../services/localResourcePolicy");
    return res.json(getLocalResourcePolicy());
  });

  router.patch("/local-resource-policy", settingsLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    if (!isAdvancedResourceConfigEnabled()) return res.status(404).json({ error: "Advanced resource configuration is disabled" });
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin role required" });

    const body = req.body || {};
    const maxInstanceCount = body.maxInstanceCount === null || String(body.maxInstanceCount).toLowerCase() === "unlimited"
      ? null
      : Number(body.maxInstanceCount);
    const policy = {
      maxInstanceCount,
      defaultCpu: Number(body.defaultCpu),
      maxCpu: Number(body.maxCpu),
      defaultMemoryMb: Number(body.defaultMemoryMb),
      maxMemoryMb: Number(body.maxMemoryMb),
      defaultDiskMb: Number(body.defaultDiskMb),
    };
    if (
      (policy.maxInstanceCount !== null && (!Number.isInteger(policy.maxInstanceCount) || policy.maxInstanceCount <= 0))
      || !Number.isFinite(policy.defaultCpu) || policy.defaultCpu <= 0
      || !Number.isFinite(policy.maxCpu) || policy.maxCpu <= 0
      || !Number.isFinite(policy.defaultMemoryMb) || policy.defaultMemoryMb <= 0
      || !Number.isFinite(policy.maxMemoryMb) || policy.maxMemoryMb <= 0
      || !Number.isFinite(policy.defaultDiskMb) || policy.defaultDiskMb <= 0
      || policy.defaultCpu > policy.maxCpu
      || policy.defaultMemoryMb > policy.maxMemoryMb
    ) return res.status(400).json({ error: "Invalid resource policy values" });

    try {
      const { saveLocalResourcePolicy } = await import("../../services/localResourcePolicy");
      const saved = await saveLocalResourcePolicy(policy);
      await dbAdapter.insertAuditLog({
        action: "local_resource_policy_updated",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: `Admin updated local resource policy: ${JSON.stringify(saved)}`,
      }).catch(() => {});
      return res.json(saved);
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(error.message) || "Failed to save local resource policy" });
    }
  });

  return router;
}

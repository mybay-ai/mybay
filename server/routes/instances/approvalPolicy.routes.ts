import { Router, type Response } from "express";
import { dbAdapter } from "../../db";
import { authenticateToken, type AuthenticatedRequest } from "../../middlewares/auth";
import { requestRunsAPI } from "../../services/runsReconciler";
import type { RouterDependencies } from "./index";

function canManageInstance(req: AuthenticatedRequest, instance: any) {
  return instance.user_id === req.user.id || req.user.role === "admin" || req.user.role === "super_admin";
}

function isPiInstance(instance: any) {
  let config: any = {};
  try { config = JSON.parse(instance.config_json || "{}"); } catch { /* malformed config is handled as non-Pi */ }
  return String(instance.runtime_type || config.runtime_type || "hermes").trim().toLowerCase() === "pi";
}

export function createApprovalPolicyRoutes(_deps: RouterDependencies) {
  const router = Router();

  router.get("/:id/approval-policy", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND", error: "Instance not found" });
      if (!canManageInstance(req, instance)) return res.status(403).json({ code: "FORBIDDEN", error: "Forbidden" });
      if (!isPiInstance(instance)) return res.status(409).json({ code: "PI_RUNTIME_REQUIRED", error: "PI_RUNTIME_REQUIRED" });
      const result = await requestRunsAPI({ instanceId: instance.id, method: "GET", path: "/v1/approval-policy", timeoutMs: 5000 }, instance);
      if (!result.ok) return res.status(result.statusCode || 502).json({ code: "APPROVAL_POLICY_UNAVAILABLE", error: result.error || "APPROVAL_POLICY_UNAVAILABLE" });
      return res.json(result.json || { alwaysApprovedTools: [], guardedTools: [] });
    } catch (error: any) {
      console.error("Pi approval policy read failed:", error);
      return res.status(500).json({ code: "APPROVAL_POLICY_READ_FAILED", error: "APPROVAL_POLICY_READ_FAILED" });
    }
  });

  router.delete("/:id/approval-policy", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND", error: "Instance not found" });
      if (!canManageInstance(req, instance)) return res.status(403).json({ code: "FORBIDDEN", error: "Forbidden" });
      if (!isPiInstance(instance)) return res.status(409).json({ code: "PI_RUNTIME_REQUIRED", error: "PI_RUNTIME_REQUIRED" });
      const tool = String(req.body?.tool || "").trim().toLowerCase();
      if (!["bash", "powershell", "write", "edit"].includes(tool)) return res.status(400).json({ code: "INVALID_APPROVAL_TOOL", error: "INVALID_APPROVAL_TOOL" });
      const result = await requestRunsAPI({ instanceId: instance.id, method: "DELETE", path: "/v1/approval-policy", body: { tool }, timeoutMs: 5000 }, instance);
      if (!result.ok) return res.status(result.statusCode || 502).json({ code: "APPROVAL_POLICY_UPDATE_FAILED", error: result.error || "APPROVAL_POLICY_UPDATE_FAILED" });
      await dbAdapter.insertAuditLog({
        instance_id: instance.id,
        action: "revoke_pi_tool_approval",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: `Revoked persistent Pi approval for ${tool}`,
      }).catch((auditError) => console.warn("Pi approval policy audit log failed:", auditError));
      return res.json(result.json || { success: true, tool });
    } catch (error: any) {
      console.error("Pi approval policy update failed:", error);
      return res.status(500).json({ code: "APPROVAL_POLICY_UPDATE_FAILED", error: "APPROVAL_POLICY_UPDATE_FAILED" });
    }
  });

  return router;
}

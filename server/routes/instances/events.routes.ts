import { Router, Response } from "express";
import { dbAdapter } from "../../db";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { redactSecretsDeep } from "../../utils/sanitizer";
import type Docker from "dockerode";
import fs from "fs";
import { buildDeploymentContext } from "../../deploymentContext";
import { buildInstanceDiagnosticReport } from "../../utils/instanceDiagnostics";

export function createEventsRoutes(deps: { docker: Docker }) {
  const router = Router();

  router.get("/:id/events", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND" });
      const isPrivileged = req.user.role === "admin" || req.user.role === "super_admin";
      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id && !isPrivileged) {
        return res.status(403).json({ success: false, error: "FORBIDDEN" });
      }

      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 200)) : 100;
      const [deploymentEvents, auditLogs] = await Promise.all([
        dbAdapter.listDeploymentEventsByInstance(req.params.id),
        dbAdapter.getAuditLogs(req.params.id),
      ]);
      const events = [...deploymentEvents, ...auditLogs.map((log: any) => ({
        ...log,
        step: log.step || log.action || "audit",
        status: log.status || "info",
        message: log.message || log.details || "",
        created_at: log.created_at || log.timestamp,
      }))]
        .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, limit);
      return res.json({ success: true, events: redactSecretsDeep(events) });
    } catch (error: any) {
      console.error("[Events API] Instance events error:", error);
      return res.status(500).json({ success: false, error: "INSTANCE_EVENTS_FAILED" });
    }
  });

  router.get("/:id/diagnostics", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND" });
      const isPrivileged = req.user.role === "admin" || req.user.role === "super_admin";
      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id && !isPrivileged) {
        return res.status(403).json({ success: false, error: "FORBIDDEN" });
      }

      const context = buildDeploymentContext(instance);
      let inspect: any = null;
      let inspectError: string | null = null;
      try {
        inspect = await deps.docker.getContainer(context.containerName).inspect();
      } catch (error: any) {
        inspectError = error?.message || "Container inspection failed";
      }

      let disk: { totalBytes: number; freeBytes: number; path: string } | null = null;
      try {
        const targetPath = fs.existsSync(instance.data_volume_path) ? instance.data_volume_path : process.cwd();
        const stats = fs.statfsSync(targetPath);
        disk = { path: targetPath, totalBytes: Number(stats.blocks) * Number(stats.bsize), freeBytes: Number(stats.bavail) * Number(stats.bsize) };
      } catch {}

      return res.json({ success: true, report: buildInstanceDiagnosticReport({ instance, context, inspect, inspectError, disk }) });
    } catch (error: any) {
      console.error("[Diagnostics API] Report error:", error);
      return res.status(500).json({ success: false, error: "INSTANCE_DIAGNOSTICS_FAILED" });
    }
  });


  return router;
}

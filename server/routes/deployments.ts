import { Router, Response } from "express";
import { dbAdapter } from "../db";
import { authenticateToken, AuthenticatedRequest } from "../middlewares/auth";
import { sanitizeErrorMessage } from "../utils/sanitizer";
import { listInstancePortCandidates } from "../utils";

const progressByStep: Record<string, number> = {
  queued: 5,
  preparing: 12,
  port_reserved: 20,
  network_creating: 28,
  network_ready: 38,
  image_pulling: 48,
  image_ready: 58,
  container_creating: 68,
  container_created: 76,
  container_starting: 84,
  health_checking: 92,
  ready: 100,
};

export function createDeploymentsRouter() {
  const router = Router();

  router.get("/:taskId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const task = await dbAdapter.getDeploymentTaskById(req.params.taskId);
    if (!task) return res.status(404).json({ error: "Deployment task not found." });
    const instance = await dbAdapter.getInstanceById(task.instance_id);
    if (instance && instance.user_id !== req.user.id && !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const status = task.status === "queued" ? "queued" : task.status;
    res.json({
      id: task.id,
      instanceId: task.instance_id,
      instanceStatus: instance?.status || "deleted",
      healthStatus: instance?.health_status || "unknown",
      status,
      currentStep: task.current_step || "queued",
      progress: task.status === "success" ? 100 : progressByStep[task.current_step] || 0,
      errorCode: task.error_code || null,
      errorMessage: task.error_message || null,
      errorDetail: task.error_detail ? sanitizeErrorMessage(task.error_detail) : null,
      failedAt: task.failed_at || null,
      attempt: Number(task.attempt || 0),
      maxAttempts: Number(task.max_attempts || 3),
      cancelRequested: Boolean(task.cancel_requested),
    });
  });

  router.post("/:taskId/retry", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const task = await dbAdapter.getDeploymentTaskById(req.params.taskId);
    if (!task) return res.status(404).json({ error: "Deployment task not found." });
    const instance = await dbAdapter.getInstanceById(task.instance_id);
    if (!instance) return res.status(404).json({ error: "Instance not found." });
    if (instance.user_id !== req.user.id && !["admin", "super_admin"].includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    if (task.status !== "failed") return res.status(409).json({ error: "Only failed deployments can be retried." });

    await dbAdapter.releasePortReservation(instance.id);
    const port = await dbAdapter.reservePortForInstance(instance.id, listInstancePortCandidates());
    if (!port) return res.status(503).json({ code: "PORT_CONFLICT", error: "No host port is currently available." });
    const config = JSON.parse(instance.config_json || "{}");
    config.host_port = port;
    config.port = String(port);
    await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
    const payload = task.payload_json || {};
    payload.secureData = { ...(payload.secureData || {}), host_port: port, port: String(port) };
    payload.instance = { ...(payload.instance || instance), config_json: JSON.stringify(config), host_port: port };
    await dbAdapter.updateDeploymentTask(task.id, { status: "retry_wait", next_retry_at: new Date().toISOString(), current_step: "queued", max_attempts: Math.max(Number(task.max_attempts || 3), Number(task.attempt || 0) + 3), error_code: null, error_message: null, error_detail: null, failed_at: null, cancel_requested: false, completed_at: null, payload_json: payload });
    await dbAdapter.updateInstanceRecord(instance.id, { status: "provisioning", desired_state: "running", error_code: null, deployment_error: null });
    res.status(202).json({ instanceId: instance.id, deploymentTaskId: task.id, status: "retry_wait", statusUrl: `/api/deployments/${task.id}` });
  });

  return router;
}

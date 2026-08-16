import { randomUUID } from "crypto";
import { dbAdapter } from "../db";
import { executeDeployment } from "../dockerDeployment";
import { compensateDeployment, executeCleanupTask } from "../services/instanceCleanup";
import { classifyDockerError } from "../dockerErrorClassifier";
import { Server as SocketIOServer } from "socket.io";
import { buildPasswordConfigSummary } from "../utils/passwordConfigSummary";
import { deploymentEventsRepo } from "../repositories/deploymentEventsRepo";
import { isEncryptionKeyConfigured, getEncryptionKeyFingerprint } from "../crypto";
import { listInstancePortCandidates } from "../utils";

export async function schedulePortConflictRetry(claimedTask: any, instance: any, io: SocketIOServer, errorMessage: string, errorDetail = errorMessage) {
  if (Number(claimedTask.attempt || 0) >= Number(claimedTask.max_attempts || 3)) return false;

  const latestInstance = await dbAdapter.getInstanceById(instance.id);
  if (!latestInstance || latestInstance.desired_state === "deleted" || ["deleting", "deleted"].includes(latestInstance.status)) return false;
  await deploymentEventsRepo.create({
    instance_id: instance.id, owner_id: latestInstance.user_id || "system",
    step: "port_conflict_detected", status: "failed", message: errorMessage,
    metadata: { taskId: claimedTask.id, attempt: claimedTask.attempt, errorCode: "PORT_CONFLICT", detail: errorDetail },
  }).catch(() => {});

  await compensateDeployment(latestInstance, io);
  await deploymentEventsRepo.create({
    instance_id: instance.id, owner_id: latestInstance.user_id || "system",
    step: "compensation_completed", status: "success",
    message: "Failed deployment attempt was compensated before port reassignment.",
    metadata: { taskId: claimedTask.id, attempt: claimedTask.attempt },
  }).catch(() => {});

  const config = typeof latestInstance.config_json === "string"
    ? JSON.parse(latestInstance.config_json || "{}")
    : { ...(latestInstance.config_json || {}) };
  const previousPort = Number(config.host_port || config.port || 0);
  const candidates = listInstancePortCandidates().filter((port) => port !== previousPort);
  const port = await dbAdapter.reservePortForInstance(instance.id, candidates);
  if (!port) return false;

  config.host_port = port;
  config.port = String(port);
  await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));

  const payload = claimedTask.payload_json || {};
  payload.secureData = { ...(payload.secureData || {}), host_port: port, port: String(port) };
  payload.instance = { ...(payload.instance || latestInstance), config_json: JSON.stringify(config), host_port: port };

  await dbAdapter.updateDeploymentTask(claimedTask.id, {
    status: "retry_wait",
    worker_id: null,
    locked_at: null,
    lease_until: null,
    heartbeat_at: null,
    next_retry_at: new Date().toISOString(),
    current_step: "queued",
    error_code: "PORT_CONFLICT",
    error_message: errorMessage,
    error_detail: errorDetail,
    completed_at: null,
    payload_json: payload,
  });
  await dbAdapter.updateInstanceRecord(instance.id, {
    status: "provisioning",
    desired_state: "running",
    error_detail: null,
    health_status: "unknown",
    error_code: null,
    error_message: null,
    deployment_error: null,
    compensated_at: null,
  });
  await deploymentEventsRepo.create({
    instance_id: instance.id, owner_id: latestInstance.user_id || "system",
    step: "port_changed", status: "success",
    message: `Host port changed from ${previousPort || "unknown"} to ${port}.`,
    metadata: { taskId: claimedTask.id, previousPort, port },
  }).catch(() => {});
  await deploymentEventsRepo.create({
    instance_id: instance.id,
    owner_id: latestInstance.user_id || "system",
    step: "retry_scheduled",
    status: "info",
    message: `Port ${previousPort || "unknown"} conflicted; retry scheduled on port ${port}.`,
    metadata: { taskId: claimedTask.id, attempt: claimedTask.attempt, previousPort, port, errorCode: "PORT_CONFLICT" },
  }).catch(() => {});
  io.emit("instances_updated", { id: instance.id, status: "provisioning" });
  return true;
}


export function startLocalDeployWorker(io: SocketIOServer) {
  const isProd = process.env.NODE_ENV === "production";
  const keyConfigured = isEncryptionKeyConfigured();

  if (isProd && !keyConfigured) {
    console.error("[Deploy Worker] CRITICAL: Cannot start deploy worker in production environment because ENCRYPTION_KEY is missing or invalid. Deployment tasks will NOT be processed on this node.");
    return;
  }

  console.log("[Deploy Worker] Starting local Docker deployment worker loop...");

  const workerId = `deploy-${process.pid}-${randomUUID()}`;
  const leaseSeconds = Math.max(15, Number(process.env.MYBAY_DEPLOYMENT_LEASE_SECONDS || 45));
  let isProcessingTask = false;

  const runWorkerTick = async () => {
    if (isProcessingTask) {
      console.log("[Deploy Worker] A deployment task is currently in progress. Skipping claim check for this tick.");
      return;
    }

    try {

      isProcessingTask = true;
      const exhaustedTasks = await dbAdapter.failExhaustedDeploymentTasks();
      for (const exhaustedTask of exhaustedTasks) {
        const exhaustedInstance = await dbAdapter.getInstanceById(exhaustedTask.instance_id);
        if (exhaustedInstance) {
          await compensateDeployment(exhaustedInstance, io).catch((error: any) => {
            console.error(`[Deploy Worker] Failed to compensate exhausted task ${exhaustedTask.id}:`, error?.message || String(error));
          });
          await dbAdapter.updateInstanceRecord(exhaustedInstance.id, {
            status: "failed",
            health_status: "unhealthy",
            error_code: "DEPLOYMENT_RETRY_EXHAUSTED",
            error_message: "Deployment worker recovery attempts were exhausted.",
            deployment_error: "Deployment worker recovery attempts were exhausted.",
          });
          await deploymentEventsRepo.create({
            instance_id: exhaustedInstance.id,
            owner_id: exhaustedInstance.user_id || "system",
            step: "recovery_exhausted",
            status: "failed",
            message: "Deployment worker recovery attempts were exhausted.",
            metadata: { taskId: exhaustedTask.id, attempt: exhaustedTask.attempt },
          }).catch(() => {});
          io.emit("instances_updated", { id: exhaustedInstance.id, status: "failed" });
        }
      }
      const claimedTask = await dbAdapter.claimNextDeploymentTask(workerId, leaseSeconds);
      if (!claimedTask) {
        isProcessingTask = false;
        return; // Was claimed by someone else or failed to claim
      }

      console.log(`[Deploy Worker] Claimed task ${claimedTask.id} successfully! Starting deployment.`);
      
      // Mark task as processing / deploying
      await dbAdapter.updateDeploymentTaskStatus(claimedTask.id, "deploying");

      let { instance, secureData, user } = claimedTask.payload_json;
      let configSource = "task.payload_json.secureData";
      if (Number(claimedTask.attempt || 0) > 1) {
        await deploymentEventsRepo.create({
          instance_id: claimedTask.instance_id, owner_id: "system",
          step: "retry_started", status: "info",
          message: `Deployment retry attempt ${claimedTask.attempt} started.`,
          metadata: { taskId: claimedTask.id, attempt: claimedTask.attempt },
        }).catch(() => {});
      }

      // Fetch the latest instance configuration directly from the database
      // to ensure we bypass any stale/incomplete/redacted snapshot in the task payload
      try {
        const freshInstance = await dbAdapter.getInstanceById(instance.id);
        if (freshInstance) {
          instance = freshInstance;
          if (freshInstance.config_json) {
            secureData = JSON.parse(freshInstance.config_json);
            configSource = "freshInstance.config_json";
          }
        }
      } catch (dbErr: any) {
        console.warn(`[Deploy Worker] Failed to fetch fresh instance data from DB for task ${claimedTask.id}, falling back to payload:`, dbErr.message || String(dbErr));
      }

      const assertActive = async (step?: string) => {
        const latestTask = await dbAdapter.getDeploymentTaskById(claimedTask.id);
        const latestInstance = await dbAdapter.getInstanceById(instance.id);
        if (!latestTask || latestTask.worker_id !== workerId || latestTask.cancel_requested || !latestInstance || latestInstance.desired_state === "deleted" || ["deleting", "deleted"].includes(latestInstance.status)) {
          throw new Error("DEPLOYMENT_CANCELLED");
        }
        if (step) await dbAdapter.updateDeploymentTask(claimedTask.id, { current_step: step }, workerId);
      };
      // Set instance status to deploying
      await dbAdapter.updateInstanceStatus(instance.id, "deploying");
      io.emit("instances_updated", { id: instance.id, status: "deploying" });

      let isCurrentTaskActive = true;
      let safetyTimeoutId: NodeJS.Timeout | null = null;
      const heartbeatId = setInterval(() => { void dbAdapter.renewDeploymentLease(claimedTask.id, workerId, leaseSeconds); }, Math.max(5000, Math.floor(leaseSeconds * 1000 / 3)));
      heartbeatId.unref?.();
      const clearExecutionTimers = () => {
        if (safetyTimeoutId) {
          clearTimeout(safetyTimeoutId);
          safetyTimeoutId = null;
        }
        clearInterval(heartbeatId);
      };

      // Build a mock update statement to intercept progress updates
      const mockUpdateStmt = {
        run: async (params: {
          status: string;
          id: string;
          deployment_error?: string;
          error_code?: string;
          error_message?: string;
          error_detail?: string;
          retryable?: boolean;
        }) => {
          if (!isCurrentTaskActive) {
            console.log(`[Deploy Worker] Ignored late callback for inactive task ${claimedTask.id}: status ${params.status}`);
            return;
          }

          try {
            const latestTask = await dbAdapter.getDeploymentTaskById(claimedTask.id);
            const latestInstance = await dbAdapter.getInstanceById(params.id);
            if (!latestTask || latestTask.cancel_requested || latestInstance?.desired_state === "deleted" || ["deleting", "deleted"].includes(latestInstance?.status)) {
              isCurrentTaskActive = false;
              clearExecutionTimers();
              await compensateDeployment(instance, io).catch(() => {});
              await dbAdapter.updateDeploymentTaskStatus(claimedTask.id, "cancelled", "Deployment was cancelled.", "DEPLOYMENT_CANCELLED");
              isProcessingTask = false;
              return;
            }
            console.log(`[Deploy Worker] Intercepted instance status update: ${params.id} -> ${params.status}`);
            await dbAdapter.updateInstanceStatus(params.id, params.status);
            io.emit("instances_updated", { id: params.id, status: params.status });
            io.emit(`deploy_status_${params.id}`, params.status);

            if (params.status === "running" || params.status === "partial_running") {
              isCurrentTaskActive = false;
              clearExecutionTimers();
              await dbAdapter.updateDeploymentTaskStatus(claimedTask.id, "success");
              console.log(`[Deploy Worker] Task ${claimedTask.id} succeeded.`);
              isProcessingTask = false; // RELEASE LOCK ON TERMINAL STATE
            } else if (params.status === "failed") {
              isCurrentTaskActive = false;
              clearExecutionTimers();
              const classified = classifyDockerError(params);
              if (classified.code === "PORT_CONFLICT" && await schedulePortConflictRetry(claimedTask, instance, io, classified.message, classified.detail)) {
                console.log(`[Deploy Worker] Task ${claimedTask.id} will retry after selecting a different host port.`);
                isProcessingTask = false;
                return;
              }
              await compensateDeployment(instance, io).catch(() => {});
              await dbAdapter.updateDeploymentTaskStatus(claimedTask.id, "failed", classified.message, classified.code, classified.detail);
              await dbAdapter.updateInstanceVersionInfo(params.id, { deployment_error: classified.detail, error_code: classified.code, error_message: classified.message, error_detail: classified.detail, failed_at: new Date().toISOString() });
              await dbAdapter.updateInstanceStatus(params.id, "failed");
              console.log(`[Deploy Worker] Task ${claimedTask.id} failed with error: ${classified.detail}`);
              isProcessingTask = false; // RELEASE LOCK ON TERMINAL STATE
            } else {
              console.log(`[Deploy Worker] Task ${claimedTask.id} progressed to intermediate state: ${params.status}`);
            }
          } catch (runErr: any) {
            console.error(`[Deploy Worker] Error updating state in mockUpdateStmt for task ${claimedTask.id}:`, runErr);
            isCurrentTaskActive = false;
            clearExecutionTimers();
            isProcessingTask = false; // RELEASE LOCK ON DB UPDATE ERROR
          }
        }
      };

      // Set a 5-minute safety watchdog to avoid permanent lockup if any unhandled async rejection or silent failure occurs.
      safetyTimeoutId = setTimeout(async () => {
        if (isCurrentTaskActive && isProcessingTask) {
          isCurrentTaskActive = false;
          clearExecutionTimers();
          console.warn(`[Deploy Worker] Watchdog timeout triggered! Task ${claimedTask.id} did not reach a terminal state within 5 minutes.`);
          try {
            await dbAdapter.updateDeploymentTask(claimedTask.id, { cancel_requested: true, status: "failed", error_code: "DEPLOYMENT_TIMEOUT", error_message: "Deployment exceeded its deadline and was cancelled.", error_detail: "Deployment watchdog expired after five minutes.", failed_at: new Date().toISOString(), completed_at: new Date().toISOString() }, workerId);
            await compensateDeployment(instance, io).catch(() => {});
            await dbAdapter.updateInstanceStatus(instance.id, "failed");
            io.emit("instances_updated", { id: instance.id, status: "failed" });
            io.emit(`deploy_status_${instance.id}`, "failed");
          } catch (err: any) {
            console.error(`[Deploy Worker] Watchdog failed to update terminal status:`, err.message || String(err));
          } finally {
            isProcessingTask = false;
          }
        }
      }, 5 * 60 * 1000); // 5 minutes

      // Generate security config summary
      const passwordConfigSummary = buildPasswordConfigSummary(secureData);
      console.log(`[Deploy Worker] Runtime config summary for task ${claimedTask.id}:`, {
        taskId: claimedTask.id,
        instanceId: instance.id,
        configSource,
        passwordConfigSummary
      });

      // Write deployment_events
      await deploymentEventsRepo.create({
        instance_id: instance.id,
        owner_id: user?.id || instance.user_id || "system",
        step: "worker_config_summary",
        status: "success",
        message: "本地部署 Worker 已记录运行时配置安全摘要",
        metadata: {
          taskId: claimedTask.id,
          configSource,
          passwordConfigSummary,
          encryptionKeyConfigured: isEncryptionKeyConfigured(),
          encryptionKeyFingerprint: getEncryptionKeyFingerprint()
        }
      }).catch((err) => {
        console.error(`[Deploy Worker] Failed to write worker_config_summary event for task ${claimedTask.id}:`, err.message || String(err));
      });

      try {
        await executeDeployment(instance, io, mockUpdateStmt, secureData, user, false, 0, { taskId: claimedTask.id, workerId, assertActive });
      } catch (deployErr: any) {
        if (isCurrentTaskActive) {
          isCurrentTaskActive = false;
          clearExecutionTimers();
          console.error(`[Deploy Worker] Critical error starting deployment for task ${claimedTask.id}:`, deployErr);
          const latestTask = await dbAdapter.getDeploymentTaskById(claimedTask.id);
          const latestInstance = await dbAdapter.getInstanceById(instance.id);
          const wasCancelled = String(deployErr?.message || deployErr).includes("DEPLOYMENT_CANCELLED")
            || latestTask?.cancel_requested
            || latestInstance?.desired_state === "deleted"
            || ["deleting", "deleted"].includes(latestInstance?.status);
          if (wasCancelled) {
            await compensateDeployment(instance, io).catch(() => {});
            await dbAdapter.updateDeploymentTaskStatus(claimedTask.id, "cancelled", "Deployment was cancelled.", "DEPLOYMENT_CANCELLED");
            isProcessingTask = false;
            return;
          }
          const classified = classifyDockerError(deployErr);
          if (classified.code === "PORT_CONFLICT" && await schedulePortConflictRetry(claimedTask, instance, io, classified.message, classified.detail)) {
            console.log(`[Deploy Worker] Task ${claimedTask.id} will retry after selecting a different host port.`);
            isProcessingTask = false;
            return;
          }
          await compensateDeployment(instance, io).catch(() => {});
          await dbAdapter.updateDeploymentTaskStatus(claimedTask.id, "failed", classified.message, classified.code, classified.detail);
          await dbAdapter.updateInstanceStatus(instance.id, "failed");
          await dbAdapter.updateInstanceVersionInfo(instance.id, { deployment_error: classified.detail, error_code: classified.code, error_message: classified.message, error_detail: classified.detail, failed_at: new Date().toISOString() });
          io.emit("instances_updated", { id: instance.id, status: "failed" });
          io.emit(`deploy_status_${instance.id}`, "failed");
          isProcessingTask = false; // RELEASE LOCK ON EXCEPTION
        }
      }

    } catch (err: any) {
      console.error("[Deploy Worker] Error in worker tick:", err.message);
      isProcessingTask = false;
    }
  };

  // Run immediately and then every 5 seconds
  runWorkerTick();
  const deployTimer = setInterval(runWorkerTick, 5000);
  deployTimer.unref?.();
  const cleanupWorkerId = `cleanup-${process.pid}-${randomUUID()}`;
  const cleanupTimer = setInterval(async () => {
    try {
      const task = await dbAdapter.claimNextCleanupTask(cleanupWorkerId, leaseSeconds);
      if (task) await executeCleanupTask(task, io);
    } catch (error) {
      console.error("[Cleanup Worker] Cleanup task failed:", error);
    }
  }, 5000);
  cleanupTimer.unref?.();
}

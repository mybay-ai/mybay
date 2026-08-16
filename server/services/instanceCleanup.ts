import fs from "fs";
import path from "path";
import Docker from "dockerode";
import type { Server as SocketIOServer } from "socket.io";
import { dbAdapter } from "../db";
import { buildDeploymentContext } from "../deploymentContext";
import {
  cleanOldContainersOfInstance,
  disconnectControlPlaneFromNetwork,
  disconnectTraefikFromNetwork,
} from "../dockerDeployment";
import { deploymentEventsRepo } from "../repositories/deploymentEventsRepo";
import { scheduledJobsRepo } from "../repositories/scheduledJobsRepo";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });

function isMissingDockerResource(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.statusCode === 404 || message.includes("not found") || message.includes("no such") || message.includes("not active");
}

async function removeInstanceDirectory(instanceId: string) {
  const base = path.resolve(process.cwd(), "data", "instances");
  const target = path.resolve(base, instanceId);
  if (!/^[a-zA-Z0-9-_]+$/.test(instanceId) || !target.startsWith(path.normalize(base + path.sep)) || target === base) {
    throw new Error("Unsafe instance directory path");
  }
  await fs.promises.rm(target, { recursive: true, force: true });
}

export type ResourceCleanupMode = "deployment_compensation" | "delete" | "archive";

export async function cleanupInstanceResources(instance: any, io?: SocketIOServer, mode: ResourceCleanupMode = "delete") {
  const instanceId = String(instance.id);
  const ctx = buildDeploymentContext(instance);
  await deploymentEventsRepo.create({
    instance_id: instanceId,
    owner_id: instance.owner_id || instance.user_id || "system",
    step: "cleanup_started",
    status: "info",
    message: "Instance cleanup started.",
  }).catch(() => {});

  await cleanOldContainersOfInstance(instanceId, io).catch((error: any) => {
    if (!isMissingDockerResource(error)) throw error;
  });
  await disconnectControlPlaneFromNetwork(ctx.networkName).catch((error: any) => {
    if (!isMissingDockerResource(error)) throw error;
  });
  await disconnectTraefikFromNetwork(ctx.networkName).catch((error: any) => {
    if (!isMissingDockerResource(error)) throw error;
  });
  try {
    await docker.getNetwork(ctx.networkName).remove();
  } catch (error: any) {
    if (!isMissingDockerResource(error)) throw error;
  }
  await dbAdapter.releasePortReservation(instanceId);

  if (mode === "delete" || mode === "archive") {
    const jobs = await scheduledJobsRepo.listByInstance(instanceId).catch(() => []);
    for (const job of jobs) {
      if (job.id) await scheduledJobsRepo.update(job.id, { is_active: false, next_run_at: null }).catch(() => {});
    }
  }
  if (mode === "delete") await removeInstanceDirectory(instanceId);

  await deploymentEventsRepo.create({
    instance_id: instanceId,
    owner_id: instance.owner_id || instance.user_id || "system",
    step: "cleanup_completed",
    status: "success",
    message: "Instance resource cleanup completed in " + mode + " mode.",
  }).catch(() => {});
}

export async function compensateDeployment(instance: any, io?: SocketIOServer) {
  await cleanupInstanceResources(instance, io, "deployment_compensation");
  await dbAdapter.updateInstanceRecord(instance.id, { compensated_at: new Date().toISOString() });
}

export async function executeCleanupTask(task: any, io?: SocketIOServer) {
  const instance = await dbAdapter.getInstanceById(task.instance_id);
  const cleanupMode: "delete" | "archive" = task.cleanup_mode === "archive" ? "archive" : "delete";
  if (!instance) {
    await dbAdapter.releasePortReservation(task.instance_id);
    await dbAdapter.updateCleanupTask(task.id, "success", null, null, { current_step: "deleted" });
    return;
  }
  try {
    await cleanupInstanceResources(instance, io, cleanupMode);
    if (cleanupMode === "archive") {
      await dbAdapter.archiveInstance(instance.id);
      await dbAdapter.updateInstanceRecord(instance.id, {
        desired_state: "archived", health_status: "unknown",
        cleanup_verified_at: new Date().toISOString(), cleanup_error: null,
        container_id: null, container_name: null,
      });
      await dbAdapter.updateCleanupTask(task.id, "success", null, null, { current_step: "archived" });
      io?.emit("instances_updated", { id: instance.id, status: "archived", action: "archive" });
    } else {
      await dbAdapter.updateInstanceRecord(instance.id, {
        status: "deleted", desired_state: "deleted", health_status: "unknown",
        deleted_at: new Date().toISOString(),
        cleanup_verified_at: new Date().toISOString(), cleanup_error: null,
        container_id: null, container_name: null,
      });
      await dbAdapter.updateCleanupTask(task.id, "success", null, null, { current_step: "deleted" });
      io?.emit("instances_updated", { id: instance.id, status: "deleted", action: "delete" });
    }
  } catch (error: any) {
    const errorMessage = String(error?.message || error);
    const maxAttempts = Math.max(1, Number(process.env.MYBAY_CLEANUP_MAX_ATTEMPTS || 3));
    if (Number(task.attempt || 0) < maxAttempts) {
      const retryDelaySeconds = Math.min(300, 15 * Math.pow(2, Math.max(0, Number(task.attempt || 1) - 1)));
      const nextRetryAt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
      await dbAdapter.updateCleanupTask(task.id, "retry_wait", "CLEANUP_RETRY_SCHEDULED", errorMessage, { error_detail: errorMessage, current_step: "cleanup_retry_wait", next_retry_at: nextRetryAt });
      await dbAdapter.updateInstanceRecord(instance.id, { status: cleanupMode === "archive" ? "archiving" : "deleting", cleanup_error: errorMessage });
      await deploymentEventsRepo.create({
        instance_id: instance.id, owner_id: instance.owner_id || instance.user_id || "system",
        step: "cleanup_retry_scheduled", status: "failed",
        message: "Cleanup failed and was scheduled for a recoverable retry.",
        metadata: { taskId: task.id, attempt: task.attempt, nextRetryAt, errorCode: "CLEANUP_RETRY_SCHEDULED" },
      }).catch(() => {});
      return;
    }
    await dbAdapter.updateCleanupTask(task.id, "failed", "CLEANUP_FAILED", errorMessage, { error_detail: errorMessage, current_step: "cleanup_failed" });
    await dbAdapter.updateInstanceRecord(instance.id, { status: "cleanup_failed", cleanup_error: errorMessage });
    await deploymentEventsRepo.create({
      instance_id: instance.id, owner_id: instance.owner_id || instance.user_id || "system",
      step: "cleanup_failed", status: "failed",
      message: "Instance cleanup exhausted its retry budget.",
      metadata: { taskId: task.id, attempt: task.attempt, errorCode: "CLEANUP_FAILED" },
    }).catch(() => {});
    throw error;
  }
}

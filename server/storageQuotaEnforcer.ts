import { dbAdapter } from "./db";
import { docker } from "./lib/docker";
import { deploymentEventsRepo } from "./repositories/deploymentEventsRepo";
import { checkInstanceStorageQuota } from "./services/instances/instanceStorageQuotaService";
import { resolveInstanceDataDir } from "./utils/instances/instancePathUtils";

/**
 * Helper to build localized quota event messages.
 */
function buildQuotaEventMessage(type: "exceeded" | "recovered", limitString?: string, locale?: string): string {
  const isEn = typeof locale === "string" && (locale.toLowerCase().startsWith("en") || locale.toLowerCase().includes("en"));
  if (type === "exceeded") {
    return isEn
      ? `Storage quota exceeded (limit: ${limitString}). The instance has been stopped to protect host resources. Please clean up files before recovery.`
      : `存储空间已超额（上限：${limitString}），实例已暂停运行以保护宿主机资源。请清理文件后再恢复。`;
  } else {
    return isEn
      ? `Storage usage is back within the safe range. The instance remains stopped. Please review and start it manually.`
      : `存储空间已恢复到安全范围，实例仍保持暂停状态。请确认后手动启动实例。`;
  }
}

/**
 * Periodically scans running instances to enforce disk usage quotas.
 * If an instance exceeds its quota, it's stopped and marked as storageExceeded.
 */
let quotaInterval: NodeJS.Timeout | null = null;
let quotaStartupTimer: NodeJS.Timeout | null = null;
let quotaCycleActive = false;

export async function startStorageQuotaEnforcer(intervalMs: number = 180000, options: { allowInTest?: boolean; startupDelayMs?: number } = {}) {
  if (quotaInterval || (process.env.NODE_ENV === "test" && !options.allowInTest)) return;
  console.log(`[StorageQuotaEnforcer] Disk quota monitor started (Interval: ${intervalMs / 1000}s)`);

  const enforce = async () => {
    if (quotaCycleActive) return;
    quotaCycleActive = true;
    try {
      // 1. Get all instances from DB
      const dbInstances = await dbAdapter.getAllInstances();
      
      for (const instance of dbInstances) {
        // Only check instances belonging to normal users and that are supposedly running
        if (instance.status !== 'running' && instance.status !== 'partial_running') continue;

        // Skip archived instances
        if (instance.archived) continue;

        // Load config to check existing storageExceeded flag
        let config: any = {};
        try {
          config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
        } catch (e) {}

        const instanceId = instance.id;
        const instanceDir = resolveInstanceDataDir(instance);

        try {
          const quota = await checkInstanceStorageQuota(instance, instanceDir);
          
          if (quota.storageLimitBytes === null) {
            continue; // Unlimited quota for admin
          }

          const usedBytes = quota.storageUsedBytes;
          const limitBytes = quota.storageLimitBytes;
          
          // Check Docker overlay writable layer size (SizeRw) as a warning-only metric
          const containerNameForWarning = instance.container_name || `mybay-agent-${instanceId}`;
          const containerForWarning = docker.getContainer(containerNameForWarning);
          try {
            const inspectSize: any = await (containerForWarning.inspect as any)({ size: true }).catch(() => null);
            if (inspectSize && inspectSize.SizeRw !== undefined) {
              const sizeRw = inspectSize.SizeRw;
              if (sizeRw >= limitBytes) {
                console.warn(`[Quota Enforcer Warning] Instance ${instanceId} writable layer (SizeRw: ${sizeRw} bytes) has exceeded the storage limit (${limitBytes} bytes). This is a warning only; the container is NOT stopped.`);
              }
            }
          } catch (e) {}
          
          if (usedBytes !== null && usedBytes >= limitBytes) {
            console.warn(`[Quota Enforcer] Instance ${instanceId} exceeded quota: ${usedBytes} bytes used (Limit: ${limitBytes})`);
            
            // Mark as exceeded
            if (!config.storageExceeded) {
              const updatedConfig = { ...config, storageExceeded: true };
              await dbAdapter.updateInstanceConfig(instanceId, JSON.stringify(updatedConfig));
              
              const containerName = instance.container_name || `mybay-agent-${instanceId}`;
              const container = docker.getContainer(containerName);
              
              try {
                // We stop the container to prevent further writes
                const inspect = await container.inspect().catch(() => null);
                if (inspect && inspect.State.Running) {
                  console.log(`[Quota Enforcer] Stopping container ${containerName} for instance ${instanceId} due to quota violation.`);
                  await container.stop().catch((e: any) => console.error(`[Quota Enforcer] Failed to stop container ${containerName}:`, e.message));
                  
                  // Update physical status in DB immediately to reflect reality
                  await dbAdapter.updateInstancePhysicalState(instanceId, {
                    physical_status: 'storage_exceeded', // Using the suggested value
                    last_reconciled_at: new Date().toISOString()
                  });
                }
              } catch (e) {}

              const limitString = limitBytes >= 1024 * 1024 * 1024 ? `${(limitBytes / (1024 * 1024 * 1024)).toFixed(0)}GB` : `${(limitBytes / (1024 * 1024)).toFixed(0)}MB`;
              const locale = instance.locale || instance.language || instance.user_language || "zh-CN";

              // Record event
              await deploymentEventsRepo.create({
                instance_id: instanceId,
                owner_id: instance.user_id,
                step: "quota_enforcement",
                status: "failed",
                message: buildQuotaEventMessage("exceeded", limitString, locale),
                metadata: { event_code: "storage_quota_exceeded" }
              }).catch(() => {});
            }
          } else if (usedBytes !== null && usedBytes <= (limitBytes * 0.95) && config.storageExceeded) {
             console.log(`[Quota Enforcer] Instance ${instanceId} is under quota again. Clearing exceeded flag and keeping it stopped.`);
             const updatedConfig = { ...config, storageExceeded: false };
             await dbAdapter.updateInstanceConfig(instanceId, JSON.stringify(updatedConfig));
             
             // Update logic status to 'stopped' to prevent reconciler from auto-starting it
             await dbAdapter.updateInstanceStatus(instanceId, "stopped");
             
             // Update physical status to reflect that it's exited
             await dbAdapter.updateInstancePhysicalState(instanceId, {
                physical_status: 'exited',
                last_reconciled_at: new Date().toISOString()
             });

             const locale = instance.locale || instance.language || instance.user_language || "zh-CN";

             // Record recovery event
             await deploymentEventsRepo.create({
                instance_id: instanceId,
                owner_id: instance.user_id,
                step: "quota_recovery",
                status: "success",
                message: buildQuotaEventMessage("recovered", undefined, locale),
                metadata: { event_code: "storage_quota_recovered" }
             }).catch(() => {});
          }
        } catch (e: any) {
          console.error(`[Quota Enforcer Warning] Failed to check quota for instance ${instanceId}:`, e.message);
        }
      }
    } catch (err: any) {
      console.error("[Quota Enforcer] Enforcement cycle failed:", err.message);
    } finally {
      quotaCycleActive = false;
    }
  };

  // Initial run after a small delay to let server settle
  quotaStartupTimer = setTimeout(() => { void enforce(); }, options.startupDelayMs ?? 5000);
  quotaStartupTimer.unref?.();
  
  // Schedule
  quotaInterval = setInterval(() => { void enforce(); }, intervalMs);
  quotaInterval.unref?.();
}

export function stopStorageQuotaEnforcer() {
  if (quotaStartupTimer) clearTimeout(quotaStartupTimer);
  if (quotaInterval) clearInterval(quotaInterval);
  quotaStartupTimer = null;
  quotaInterval = null;
}
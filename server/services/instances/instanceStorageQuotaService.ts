import { getDirectorySizeBytes } from "../../utils/storageQuota";
import fs from "fs";
import { DEFAULT_INSTANCE_DISK_MB } from "../../constants/resourceLimits";

export function formatDiskLimitLabel(limitMb: number | null): string {
  if (limitMb === null) return "unlimited";
  if (limitMb % 1024 === 0) {
    return `${limitMb / 1024}GB`;
  }
  return `${limitMb}MB`;
}

export interface StorageQuotaStats {
  storageUsedBytes: number | null;
  storageLimitBytes: number | null;
  storageUsagePercent: number | null;
  storageStatus: "normal" | "warning" | "exceeded" | "unknown";
  storageExceeded: boolean;
}

export async function resolveInstanceDiskLimitMb(instance: any): Promise<number | null> {
  let config: any = {};
  if (instance && instance.config_json) {
    try {
      config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : instance.config_json;
    } catch (e) {}
  }

  if (config.limitsDiskMb !== undefined && config.limitsDiskMb !== null && config.limitsDiskMb !== "") {
    if (String(config.limitsDiskMb) === 'unlimited') return null;
    const mb = parseInt(String(config.limitsDiskMb), 10);
    if (!isNaN(mb) && mb > 0) return mb;
  }

  const envDisk = process.env.DEFAULT_INSTANCE_DISK_MB ? parseInt(process.env.DEFAULT_INSTANCE_DISK_MB, 10) : DEFAULT_INSTANCE_DISK_MB;
  return Number.isFinite(envDisk) && envDisk > 0 ? envDisk : 4096;
}

export async function checkInstanceStorageQuota(instance: any, rootDir: string, options: { timeoutMs?: number } = {}): Promise<StorageQuotaStats> {
  let storageUsedBytes: number | null = null;
  let storageUsagePercent: number | null = null;
  let storageStatus: "normal" | "warning" | "exceeded" | "unknown" = "normal";

  const diskLimitMb = await resolveInstanceDiskLimitMb(instance);
  const storageLimitBytes = diskLimitMb === null ? null : diskLimitMb * 1024 * 1024;

  let config: any = {};
  if (instance && instance.config_json) {
    try {
      config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : instance.config_json;
    } catch (e) {
      // ignore
    }
  }

  try {
    if (fs.existsSync(rootDir)) {
      storageUsedBytes = await getDirectorySizeBytes(rootDir, options.timeoutMs);
    } else {
      storageUsedBytes = 0;
    }
    
    if (storageUsedBytes !== null) {
      if (storageLimitBytes !== null) {
        storageUsagePercent = parseFloat(((storageUsedBytes / storageLimitBytes) * 100).toFixed(1));
        if (storageUsagePercent >= 100 || config.storageExceeded) {
          storageStatus = "exceeded";
        } else if (storageUsagePercent >= 80) {
          storageStatus = "warning";
        } else {
          storageStatus = "normal";
        }
      } else {
        storageUsagePercent = null;
        if (config.storageExceeded) {
          storageStatus = "exceeded";
        } else {
          storageStatus = "normal";
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Storage Quota] Failed to fetch storage stats for directory ${rootDir}:`, err.message);
    storageStatus = "unknown";
    storageUsedBytes = null;
    storageUsagePercent = null;
  }

  return {
    storageUsedBytes,
    storageLimitBytes,
    storageUsagePercent,
    storageStatus,
    storageExceeded: !!config.storageExceeded
  };
}

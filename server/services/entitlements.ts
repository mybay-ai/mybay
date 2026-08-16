import { getHostResourceConfig, assertCanCreateInstance as hostAssertCanCreate, assertCanUseChannel as hostAssertCanUseChannel, assertCanExportBackup as hostAssertCanExportBackup, HostResourceError } from "./hostResourceGuardV2";
import { dbAdapter } from "../db";

export const FEATURE_KEYS = {
  MAX_INSTANCES: "max_instances",
  DISK_LIMIT_MB: "disk_limit_mb",
  DEFAULT_INSTANCE_DISK_MB: "default_instance_disk_mb",
  MAX_SINGLE_INSTANCE_DISK_MB: "max_single_instance_disk_mb",
  EXTERNAL_CHANNELS: "external_channels",
  BACKUP_EXPORT: "backup_export"
} as const;

export class EntitlementError extends HostResourceError {
  constructor(code: string, message: string, status = 403, details?: Record<string, any>) {
    super(code, message, status);
    this.name = "EntitlementError";
  }
}

export function isExternalChannel(_channel: any): boolean {
  return true;
}

export async function getEffectiveEntitlements(_user?: any) {
  const config = getHostResourceConfig();
  return {
    planCode: "local",
    privileged: true,
    features: {
      max_instances: config.maxInstanceCount,
      disk_limit_mb: config.defaultDiskMb,
      default_instance_disk_mb: config.defaultDiskMb,
      max_single_instance_disk_mb: config.defaultDiskMb,
      external_channels: true,
      backup_export: true
    }
  };
}

export async function getUserPlanCode(_user?: any): Promise<string> {
  return "local";
}

export async function getPlanFeatures(_planCode?: string) {
  const config = getHostResourceConfig();
  return {
    max_instances: config.maxInstanceCount,
    disk_limit_mb: config.defaultDiskMb,
    default_instance_disk_mb: config.defaultDiskMb,
    max_single_instance_disk_mb: config.defaultDiskMb,
    external_channels: true,
    backup_export: true
  };
}

export async function getInstanceLimit(_user?: any, _fallback?: any): Promise<number | null> {
  const config = getHostResourceConfig();
  return config.maxInstanceCount;
}

export async function getStorageLimitMb(_user?: any): Promise<number | null> {
  const config = getHostResourceConfig();
  return config.defaultDiskMb;
}

export async function getDefaultInstanceDiskMb(_user?: any): Promise<number> {
  const config = getHostResourceConfig();
  return config.defaultDiskMb;
}

export async function assertCanCreateInstance(user: any, requestedChannel?: any): Promise<void> {
  const allInstances = await dbAdapter.getAllInstances();
  const activeCount = allInstances.filter((i: any) => !i.archived && i.status !== "deleted").length;
  hostAssertCanCreate(activeCount);
  if (requestedChannel) {
    hostAssertCanUseChannel(requestedChannel);
  }
}

export async function assertCanUseChannel(_user: any, channel: any): Promise<void> {
  hostAssertCanUseChannel(channel);
}

export async function assertCanExportBackup(_user: any): Promise<void> {
  hostAssertCanExportBackup();
}

export async function sendEntitlementError(res: any, err: any): Promise<void> {
  const status = err?.status || 403;
  res.status(status).json({
    error: err?.message || "Host resource limit restriction",
    code: err?.code || "RESOURCE_LIMIT_EXCEEDED"
  });
}

export async function getUserQuotaDetails(user?: any) {
  const config = getHostResourceConfig();
  const allInstances = await dbAdapter.getAllInstances();
  const activeCount = allInstances.filter((i: any) => !i.archived && i.status !== "deleted").length;

  return {
    planCode: "local",
    instanceLimit: config.maxInstanceCount,
    instanceUsed: activeCount,
    totalDiskQuotaMb: config.defaultDiskMb,
    allocatedDiskMb: config.defaultDiskMb,
    remainingDiskMb: null,
    defaultInstanceDiskMb: config.defaultDiskMb,
    maxSingleInstanceDiskMb: config.defaultDiskMb,
    isDiskOverAllocated: false,
    externalChannelsAllowed: true,
    canCreateInstance: config.maxInstanceCount === null || activeCount < config.maxInstanceCount
  };
}

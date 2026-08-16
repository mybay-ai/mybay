import { dbAdapter } from "../db";

export interface LocalResourcePolicy {
  maxInstanceCount: number | null;
  defaultCpu: number;
  maxCpu: number;
  defaultMemoryMb: number;
  maxMemoryMb: number;
  defaultDiskMb: number;
}

const KEYS = {
  maxInstanceCount: "local_resource_max_instance_count",
  defaultCpu: "local_resource_default_cpu",
  maxCpu: "local_resource_max_cpu",
  defaultMemoryMb: "local_resource_default_memory_mb",
  maxMemoryMb: "local_resource_max_memory_mb",
  defaultDiskMb: "local_resource_default_disk_mb"
} as const;

function positiveNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: any, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMaxInstances(value: any): number | null {
  if (value === null || value === undefined || value === "" || String(value).toLowerCase() === "unlimited" || String(value) === "-1") return null;
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getLocalResourcePolicy(): LocalResourcePolicy {
  const maxCpu = positiveNumber(process.env.MAX_INSTANCE_CPUS, 4);
  const maxMemoryMb = positiveInteger(process.env.MAX_INSTANCE_MEMORY_MB, 4096);
  const defaultCpu = Math.min(positiveNumber(process.env.DEFAULT_INSTANCE_CPUS, 1), maxCpu);
  const defaultMemoryMb = Math.min(positiveInteger(process.env.DEFAULT_INSTANCE_MEMORY_MB || process.env.DEFAULT_INSTANCE_MEMORY, 1024), maxMemoryMb);
  const defaultDiskMb = positiveInteger(process.env.DEFAULT_INSTANCE_DISK_MB, 4096);

  return {
    maxInstanceCount: parseMaxInstances(process.env.MAX_INSTANCE_COUNT),
    defaultCpu,
    maxCpu,
    defaultMemoryMb,
    maxMemoryMb,
    defaultDiskMb
  };
}

export function applyLocalResourcePolicy(policy: LocalResourcePolicy): LocalResourcePolicy {
  const maxCpu = positiveNumber(policy.maxCpu, 4);
  const maxMemoryMb = positiveInteger(policy.maxMemoryMb, 4096);
  const normalized: LocalResourcePolicy = {
    maxInstanceCount: policy.maxInstanceCount === null ? null : positiveInteger(policy.maxInstanceCount, 1),
    maxCpu,
    maxMemoryMb,
    defaultCpu: Math.min(positiveNumber(policy.defaultCpu, 1), maxCpu),
    defaultMemoryMb: Math.min(positiveInteger(policy.defaultMemoryMb, 1024), maxMemoryMb),
    defaultDiskMb: positiveInteger(policy.defaultDiskMb, 4096)
  };

  process.env.MAX_INSTANCE_COUNT = normalized.maxInstanceCount === null ? "unlimited" : String(normalized.maxInstanceCount);
  process.env.DEFAULT_INSTANCE_CPUS = String(normalized.defaultCpu);
  process.env.MAX_INSTANCE_CPUS = String(normalized.maxCpu);
  process.env.DEFAULT_INSTANCE_MEMORY_MB = String(normalized.defaultMemoryMb);
  process.env.DEFAULT_INSTANCE_MEMORY = `${normalized.defaultMemoryMb}MB`;
  process.env.MAX_INSTANCE_MEMORY_MB = String(normalized.maxMemoryMb);
  process.env.DEFAULT_INSTANCE_DISK_MB = String(normalized.defaultDiskMb);

  return normalized;
}

export async function loadPersistedLocalResourcePolicy(): Promise<LocalResourcePolicy> {
  const values = await Promise.all(Object.values(KEYS).map(key => dbAdapter.getSystemSetting(key).catch(() => null)));
  const hasPersisted = values.some(value => value !== null && value !== undefined && value !== "");
  if (!hasPersisted) return getLocalResourcePolicy();

  const current = getLocalResourcePolicy();
  return applyLocalResourcePolicy({
    maxInstanceCount: values[0] === null ? current.maxInstanceCount : parseMaxInstances(values[0]),
    defaultCpu: values[1] === null ? current.defaultCpu : positiveNumber(values[1], current.defaultCpu),
    maxCpu: values[2] === null ? current.maxCpu : positiveNumber(values[2], current.maxCpu),
    defaultMemoryMb: values[3] === null ? current.defaultMemoryMb : positiveInteger(values[3], current.defaultMemoryMb),
    maxMemoryMb: values[4] === null ? current.maxMemoryMb : positiveInteger(values[4], current.maxMemoryMb),
    defaultDiskMb: values[5] === null ? current.defaultDiskMb : positiveInteger(values[5], current.defaultDiskMb)
  });
}

export async function saveLocalResourcePolicy(policy: LocalResourcePolicy): Promise<LocalResourcePolicy> {
  const normalized = applyLocalResourcePolicy(policy);
  const values: Record<string, string> = {
    [KEYS.maxInstanceCount]: normalized.maxInstanceCount === null ? "unlimited" : String(normalized.maxInstanceCount),
    [KEYS.defaultCpu]: String(normalized.defaultCpu),
    [KEYS.maxCpu]: String(normalized.maxCpu),
    [KEYS.defaultMemoryMb]: String(normalized.defaultMemoryMb),
    [KEYS.maxMemoryMb]: String(normalized.maxMemoryMb),
    [KEYS.defaultDiskMb]: String(normalized.defaultDiskMb)
  };
  await Promise.all(Object.entries(values).map(([key, value]) => dbAdapter.setSystemSetting(key, value)));
  return normalized;
}

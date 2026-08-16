/**
 * Resource quota constants for local instances, derived from host environment variables.
 */

export function getEnvDiskLimit(): number {
  const raw = process.env.DEFAULT_INSTANCE_DISK_MB;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 4096;
}

export const DEFAULT_USER_DISK_LIMIT_MB = getEnvDiskLimit();
export const DEFAULT_INSTANCE_DISK_MB = getEnvDiskLimit();
export const DEFAULT_MAX_SINGLE_INSTANCE_DISK_MB = getEnvDiskLimit();

export const ALLOWED_DISK_LIMITS = [512, 1024, 2048, 4096, 8192, 10240, 20480, null];

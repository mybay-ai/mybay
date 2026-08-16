/**
 * Host Resource Guard for MyBay Open Source
 * Manages local server instance limits and resource policies.
 */

export interface HostResourceConfig {
  maxInstanceCount: number | null;
  defaultMemory: string;
  defaultCpus: string;
  defaultDiskMb: number;
}

export function getHostResourceConfig(): HostResourceConfig {
  const maxRaw = process.env.MAX_INSTANCE_COUNT;
  let maxInstanceCount: number | null = 10;
  if (maxRaw !== undefined && maxRaw !== null && maxRaw !== "") {
    if (maxRaw.toLowerCase() === "unlimited" || maxRaw === "-1") {
      maxInstanceCount = null;
    } else {
      const parsed = parseInt(maxRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        maxInstanceCount = parsed;
      }
    }
  }

  const defaultDiskRaw = process.env.DEFAULT_INSTANCE_DISK_MB;
  let defaultDiskMb = 4096;
  if (defaultDiskRaw) {
    const parsed = parseInt(defaultDiskRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      defaultDiskMb = parsed;
    }
  }

  return {
    maxInstanceCount,
    defaultMemory: process.env.DEFAULT_INSTANCE_MEMORY || "1024m",
    defaultCpus: process.env.DEFAULT_INSTANCE_CPUS || "1",
    defaultDiskMb
  };
}

export class HostResourceError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "HostResourceError";
    this.code = code;
    this.status = status;
  }
}

export function assertCanCreateInstance(currentCount: number): void {
  const config = getHostResourceConfig();
  if (config.maxInstanceCount !== null && currentCount >= config.maxInstanceCount) {
    throw new HostResourceError(
      "MAX_INSTANCE_COUNT_REACHED",
      `Cannot create instance: Local instance limit reached (${config.maxInstanceCount}). You can adjust MAX_INSTANCE_COUNT in .env.`
    );
  }
}

export function assertCanUseChannel(_channel: any): void {
  // All channels are enabled for the single admin in MyBay Open Source
}

export function assertCanExportBackup(): void {
  // Backup export is always permitted for the local admin
}

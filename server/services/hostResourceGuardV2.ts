import { assertCanUseChannel as legacyAssertCanUseChannel, assertCanExportBackup as legacyAssertCanExportBackup } from "./hostResourceGuard";
import { getLocalResourcePolicy } from "./localResourcePolicy";

export interface HostResourceConfig {
  maxInstanceCount: number | null;
  defaultMemory: string;
  defaultCpus: string;
  defaultDiskMb: number;
}

export function getHostResourceConfig(): HostResourceConfig {
  const policy = getLocalResourcePolicy();
  return {
    maxInstanceCount: policy.maxInstanceCount,
    defaultMemory: `${policy.defaultMemoryMb}MB`,
    defaultCpus: String(policy.defaultCpu),
    defaultDiskMb: policy.defaultDiskMb
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
      `Cannot create instance: Local instance limit reached (${config.maxInstanceCount}). Adjust the local resource policy in the administrator settings.`
    );
  }
}

export function assertCanUseChannel(channel: any): void {
  legacyAssertCanUseChannel(channel);
}

export function assertCanExportBackup(): void {
  legacyAssertCanExportBackup();
}

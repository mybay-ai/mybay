export type UpgradePreflightStatus = "pass" | "warning" | "blocker";

export interface UpgradePreflightCheck {
  code: string;
  status: UpgradePreflightStatus;
  detail?: string | null;
}

export interface UpgradePreflightInput {
  instance: any;
  targetTag: string;
  targetCompatible: boolean;
  activeOperation?: string | null;
  disk?: { totalBytes: number; freeBytes: number } | null;
  configValid: boolean;
  dataDirectoryExists: boolean;
  currentContainerRunning: boolean;
  targetImageCached: boolean;
  architectureCompatible?: boolean | null;
}

export function buildUpgradePreflight(input: UpgradePreflightInput) {
  const { instance } = input;
  const runtimeStatus = String(instance?.status || "unknown").toLowerCase();
  const terminal = ["archived", "deleting", "deleted"].includes(runtimeStatus);
  const chatReady = instance?.gateway_ready === true && ["running", "gateway_ready"].includes(runtimeStatus);
  const diskStatus: UpgradePreflightStatus = !input.disk
    ? "warning"
    : input.disk.freeBytes < 256 * 1024 * 1024
      ? "blocker"
      : input.disk.freeBytes < 1024 ** 3 || input.disk.freeBytes / Math.max(input.disk.totalBytes, 1) < 0.1
        ? "warning"
        : "pass";

  const checks: UpgradePreflightCheck[] = [
    { code: "TARGET_COMPATIBILITY", status: input.targetCompatible ? "pass" : "blocker", detail: input.targetTag },
    { code: "ACTIVE_OPERATION", status: input.activeOperation ? "blocker" : "pass", detail: input.activeOperation || null },
    { code: "INSTANCE_STATE", status: terminal ? "blocker" : input.currentContainerRunning ? "pass" : "warning", detail: runtimeStatus },
    { code: "CONFIG_VALID", status: input.configValid ? "pass" : "blocker" },
    { code: "DATA_DIRECTORY", status: input.dataDirectoryExists ? "pass" : "blocker", detail: instance?.data_volume_path || null },
    { code: "DISK_SPACE", status: diskStatus, detail: input.disk ? `${input.disk.freeBytes}/${input.disk.totalBytes}` : null },
    { code: "ROLLBACK_READY", status: input.currentContainerRunning ? "pass" : "warning", detail: instance?.agent_image_tag || null },
    { code: "TARGET_IMAGE", status: input.targetImageCached ? "pass" : "warning", detail: input.targetTag },
    { code: "ARCHITECTURE", status: input.architectureCompatible === false ? "blocker" : input.architectureCompatible === true ? "pass" : "warning" },
    { code: "CHAT_READINESS", status: chatReady ? "pass" : "warning", detail: instance?.gateway_status || runtimeStatus },
    { code: "SERVICE_INTERRUPTION", status: "warning" },
  ];
  const summary = {
    passed: checks.filter(check => check.status === "pass").length,
    warnings: checks.filter(check => check.status === "warning").length,
    blockers: checks.filter(check => check.status === "blocker").length,
  };
  return { instanceId: instance.id, instanceName: instance.name, targetTag: input.targetTag, allowed: summary.blockers === 0, checks, summary };
}

import type { TFunction } from "i18next";
import { normalizeAgentUpgradePhase } from "../../../shared/agentUpgradePhase";

const KNOWN_RUNTIME_STATUSES = new Set([
  "running",
  "gateway_ready",
  "partial_running",
  "dashboard_ready",
  "gateway_starting",
  "deploying",
  "restarting",
  "upgrading",
  "stopped",
  "archived",
  "unhealthy",
  "error",
  "failed",
]);

export function getUpgradePhaseLabel(t: TFunction, instance: any): string {
  const phase = normalizeAgentUpgradePhase(instance?.upgrade_phase, instance?.upgrade_status);
  return t(`versionManagement.phases.${phase}`);
}

export function getRuntimeStatusLabel(t: TFunction, status: unknown): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return t("versionManagement.runtimeStatuses.unknown");
  if (KNOWN_RUNTIME_STATUSES.has(normalized)) {
    return t(`versionManagement.runtimeStatuses.${normalized}`);
  }
  return t("versionManagement.runtimeStatuses.unknownWithCode", { code: normalized });
}

export function getAuditActionLabel(t: TFunction, action: unknown): string {
  const normalized = String(action || "").trim().toLowerCase();
  if (normalized === "upgrade" || normalized === "upgrade_progress") {
    return t("versionManagement.logs.actions.upgrade");
  }
  if (normalized === "rollback" || normalized === "rollback_progress") {
    return t("versionManagement.logs.actions.rollback");
  }
  return t("versionManagement.logs.actions.other");
}

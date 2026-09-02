import { describe, expect, it } from "vitest";
import { getAuditActionLabel, getRuntimeStatusLabel, getUpgradePhaseLabel } from "./versionStatusPresentation";

const t = ((key: string, options?: Record<string, string>) => options?.code ? `${key}:${options.code}` : key) as any;

describe("version status presentation", () => {
  it("localizes structured and legacy upgrade states", () => {
    expect(getUpgradePhaseLabel(t, { upgrade_phase: "health_check", upgrade_status: "upgrading" })).toBe("versionManagement.phases.health_check");
    expect(getUpgradePhaseLabel(t, { upgrade_status: "success" })).toBe("versionManagement.phases.completed");
    expect(getUpgradePhaseLabel(t, {})).toBe("versionManagement.phases.idle");
  });

  it("localizes known runtime and audit status values", () => {
    expect(getRuntimeStatusLabel(t, "gateway_ready")).toBe("versionManagement.runtimeStatuses.gateway_ready");
    expect(getRuntimeStatusLabel(t, "future_state")).toBe("versionManagement.runtimeStatuses.unknownWithCode:future_state");
    expect(getAuditActionLabel(t, "rollback_progress")).toBe("versionManagement.logs.actions.rollback");
  });
});

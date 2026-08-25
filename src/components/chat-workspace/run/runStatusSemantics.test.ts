import { describe, expect, it } from "vitest";
import { getRunStatusI18nKey, normalizeRunDisplayStatus, reconcileRunMetricStatus, resolveRunDisplayStatus, resolveToolDisplayStatus } from "./runStatusSemantics";

describe("run status semantics", () => {
  it("normalizes backend aliases into one display contract", () => {
    expect(normalizeRunDisplayStatus("dispatching")).toBe("running");
    expect(normalizeRunDisplayStatus("approval_required")).toBe("waiting_for_approval");
    expect(normalizeRunDisplayStatus("cancelled")).toBe("stopped");
    expect(normalizeRunDisplayStatus("expired")).toBe("failed");
  });

  it("does not let a stale metric snapshot regress a terminal run", () => {
    expect(reconcileRunMetricStatus("completed", "running")).toBe("completed");
    expect(reconcileRunMetricStatus("failed", "queued")).toBe("failed");
    expect(reconcileRunMetricStatus("running", "completed")).toBe("completed");
  });

  it("uses one authoritative status across active run sources", () => {
    expect(resolveRunDisplayStatus({ activeRunId: "run-2", executionRunId: "run-1", executionStatus: "completed" })).toBe("running");
    expect(resolveRunDisplayStatus({ activeRunId: "run-1", executionRunId: "run-1", executionStatus: "running", hasPendingApproval: true })).toBe("waiting_for_approval");
    expect(resolveRunDisplayStatus({ executionStatus: "stopped" })).toBe("stopped");
  });

  it("derives tool display status from the same run status", () => {
    expect(resolveToolDisplayStatus("running", "waiting_for_approval")).toBe("waiting_for_approval");
    expect(resolveToolDisplayStatus("failed", "stopped")).toBe("stopped");
    expect(getRunStatusI18nKey("queued")).toBe("runStatusQueued");
  });
});

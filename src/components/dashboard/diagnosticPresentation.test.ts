import { describe, expect, it } from "vitest";
import { isCompleteDiagnosticPass, settleTimedOutDiagnosticChecks, type DiagnosticCheckView } from "./diagnosticPresentation";

const checks: DiagnosticCheckView[] = [
  { code: "GATEWAY", domain: "chat", label: "Agent 网关", status: "checking", detail: "正在初始化" },
  { code: "CONTAINER_STATE", domain: "container", label: "Docker 容器", status: "pass", detail: "running" },
];

describe("diagnostic presentation convergence", () => {
  it("settles only pending checks to an actionable timeout", () => {
    expect(settleTimedOutDiagnosticChecks(checks, true)).toEqual([
      expect.objectContaining({ code: "GATEWAY", status: "warning", reasonCode: "DIAGNOSTIC_CHECK_TIMEOUT", recoveryAction: "view_logs" }),
      checks[1],
    ]);
  });

  it("does not rewrite checks before the deadline", () => {
    expect(settleTimedOutDiagnosticChecks(checks, false)).toBe(checks);
  });

  it("records a complete pass only after pending and failed checks are gone", () => {
    expect(isCompleteDiagnosticPass({ failed: 0, checking: 0 })).toBe(true);
    expect(isCompleteDiagnosticPass(null)).toBe(false);
    expect(isCompleteDiagnosticPass({ failed: 0, checking: 1 })).toBe(false);
    expect(isCompleteDiagnosticPass({ failed: 1, checking: 0 })).toBe(false);
  });
});

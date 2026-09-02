import { describe, expect, it } from "vitest";
import { buildLocalDiagnosticExport, readLocalDiagnosticExport } from "./localDiagnosticExport";

describe("sanitized local diagnostic export", () => {
  it("excludes free text, nested credentials, paths, network and unknown enum values", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const report = buildLocalDiagnosticExport({
      generatedAt: "2026-08-31T00:00:00.000Z", instance: { id, name: "PRIVATE", status: "running", env: "PRIVATE" },
      capabilities: { deploymentMode: "desktop", host: "PRIVATE" }, config: { key: "PRIVATE" },
      checks: [{ code: "GATEWAY", domain: "chat", status: "fail", reasonCode: "GATEWAY_UNHEALTHY", detail: "PRIVATE", suggestion: "PRIVATE" },
        { code: "PRIVATE", domain: "PRIVATE", status: "PRIVATE", reasonCode: "PRIVATE" }], events: [{ message: "PRIVATE" }],
    }, "0.1.24", id);
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
    expect(report).toMatchObject({ reportId: id, instanceId: id, applicationVersion: "0.1.24", deploymentMode: "desktop" });
    expect(report.checks[1]).toEqual({ code: "unknown", domain: "unknown", status: "unknown", reasonCode: "unknown" });
    expect(readLocalDiagnosticExport({ ...report, injected: "PRIVATE" })).toEqual(report);
  });
  it("bounds reports and rejects untrusted metadata", () => {
    const result = buildLocalDiagnosticExport({ generatedAt: "PRIVATE", instance: { id: "PRIVATE" }, checks: Array(500).fill(null) }, "0.1.24-PRIVATE", "PRIVATE");
    expect(result.checks).toHaveLength(32);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(readLocalDiagnosticExport(null)).toBeNull();
  });
  it("retains a bounded release-candidate version", () => {
    const report = buildLocalDiagnosticExport({}, "0.1.27-rc.1", null);
    expect(report.applicationVersion).toBe("0.1.27-rc.1");
    expect(readLocalDiagnosticExport(report)?.applicationVersion).toBe("0.1.27-rc.1");
  });
});

import { describe, expect, it } from "vitest";
import { buildInstanceDiagnosticReport } from "./instanceDiagnostics";

const context = { containerName: "mybay-agent-i1", networkName: "mybay-net-i1", host_port: 10100, internal_web_port: 9119 };

describe("instance diagnostic report", () => {
  it("reports a healthy local container", () => {
    const report = buildInstanceDiagnosticReport({
      instance: { id: "i1", name: "demo", status: "running", physical_status: "running" },
      context,
      inspect: { Id: "container-1", State: { Running: true, Status: "running", Health: { Status: "healthy" } }, Config: { Image: "mybay:latest" }, NetworkSettings: { Ports: { "9119/tcp": [{ HostPort: "10100" }] }, Networks: { "mybay-net-i1": {} } } },
      disk: { path: "data", totalBytes: 20 * 1024 ** 3, freeBytes: 10 * 1024 ** 3 },
    });
    expect(report.summary).toEqual({ passed: 6, warnings: 0, failed: 0 });
  });

  it("returns actionable failures for missing runtime resources", () => {
    const report = buildInstanceDiagnosticReport({
      instance: { id: "i1", name: "demo", status: "degraded", physical_status: "missing", physical_error: "container missing" },
      context,
      inspect: null,
      inspectError: "no such container",
      disk: { path: "data", totalBytes: 20 * 1024 ** 3, freeBytes: 100 * 1024 ** 2 },
    });
    expect(report.summary.failed).toBeGreaterThanOrEqual(4);
    expect(report.checks.find((check) => check.code === "PORT_MAPPING")?.suggestion).toContain("端口");
  });
});

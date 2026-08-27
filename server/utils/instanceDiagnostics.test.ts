import { describe, expect, it } from "vitest";
import { buildInstanceDiagnosticReport } from "./instanceDiagnostics";

const context = { containerName: "mybay-agent-i1", networkName: "mybay-net-i1", host_port: 10100, internal_web_port: 9119 };

describe("instance diagnostic report", () => {
  it("reports a healthy local container", () => {
    const report = buildInstanceDiagnosticReport({
      instance: {
        id: "i1", name: "demo", status: "running", physical_status: "running",
        gateway_ready: true, gateway_status: "running",
        model_provider: "deepseek", model_name: "deepseek-chat",
        model_config_status: "verified", model_runtime_status: "callable",
        config_json: JSON.stringify({ deployment_mode: "desktop", channel: "web", password: "encrypted", webPasswordHash: "hash", dashboardAuthSecret: "secret", hermesDashboardAuthSecret: "secret" }),
      },
      context,
      inspect: { Id: "container-1", State: { Running: true, Status: "running", Health: { Status: "healthy" } }, Config: { Image: "mybay:latest" }, NetworkSettings: { Ports: { "9119/tcp": [{ HostPort: "10100" }] }, Networks: { "mybay-net-i1": {} } } },
      disk: { path: "data", totalBytes: 20 * 1024 ** 3, freeBytes: 10 * 1024 ** 3 },
    });
    expect(report.summary.failed).toBe(0);
    expect(report.checks.find((check) => check.code === "CHAT_READINESS")?.status).toBe("pass");
    expect(report.checks.find((check) => check.code === "CHANNEL")?.status).toBe("not_applicable");
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

  it("marks checks that do not apply to the local instance instead of failing them", () => {
    const report = buildInstanceDiagnosticReport({
      instance: {
        id: "i1", name: "server-only", status: "running", physical_status: "running",
        gateway_ready: true,
        config_json: JSON.stringify({ deployment_mode: "server", enableDashboard: false }),
      },
      context,
      inspect: { State: { Running: true, Status: "running" }, NetworkSettings: { Networks: { "mybay-net-i1": {} } } },
      disk: { path: "data", totalBytes: 20 * 1024 ** 3, freeBytes: 10 * 1024 ** 3 },
    });

    expect(report.checks.find((check) => check.code === "PORT_MAPPING")?.status).toBe("not_applicable");
    expect(report.checks.find((check) => check.code === "MODEL_CONFIG")?.status).toBe("not_applicable");
    expect(report.checks.find((check) => check.code === "CHANNEL")?.status).toBe("not_applicable");
    expect(report.summary.notApplicable).toBe(5);
  });

  it("separates a failed configured channel from container health", () => {
    const report = buildInstanceDiagnosticReport({
      instance: {
        id: "i1", name: "feishu", status: "running", physical_status: "running",
        gateway_ready: true, configured_channels: 1, connected_channels: 0,
        channel_status: { feishu: { status: "auth_failed" } },
        model_provider: "deepseek", model_config_status: "verified", model_runtime_status: "callable",
        config_json: JSON.stringify({ deployment_mode: "desktop", channel: "feishu", password: "encrypted", webPasswordHash: "hash", dashboardAuthSecret: "secret", hermesDashboardAuthSecret: "secret" }),
      },
      context,
      inspect: { State: { Running: true, Status: "running", Health: { Status: "healthy" } }, NetworkSettings: { Ports: { "9119/tcp": [{ HostPort: "10100" }] }, Networks: { "mybay-net-i1": {} } } },
      disk: { path: "data", totalBytes: 20 * 1024 ** 3, freeBytes: 10 * 1024 ** 3 },
    });

    expect(report.checks.find((check) => check.code === "CONTAINER_STATE")?.status).toBe("pass");
    expect(report.checks.find((check) => check.code === "CHANNEL")).toMatchObject({ status: "fail", reasonCode: "CHANNEL_CONFIG_UNAVAILABLE", recoveryAction: "open_channel_settings" });
    expect(report.checks.find((check) => check.code === "CHAT_READINESS")).toMatchObject({ status: "fail", recoveryAction: "open_channel_settings" });
  });

  it("uses detailed channel state when the aggregate connected count is stale", () => {
    const report = buildInstanceDiagnosticReport({
      instance: {
        id: "i1", name: "feishu", status: "running", physical_status: "running",
        gateway_ready: true, configured_channels: 1, connected_channels: 0,
        channel_status: { feishu: { status: "connected" } },
        model_provider: "deepseek", model_config_status: "verified", model_runtime_status: "callable",
        config_json: JSON.stringify({ deployment_mode: "desktop", channel: "feishu", password: "encrypted", webPasswordHash: "hash", dashboardAuthSecret: "secret", hermesDashboardAuthSecret: "secret" }),
      },
      context,
      inspect: { State: { Running: true, Status: "running", Health: { Status: "healthy" } }, NetworkSettings: { Ports: { "9119/tcp": [{ HostPort: "10100" }] }, Networks: { "mybay-net-i1": {} } } },
      disk: { path: "data", totalBytes: 20 * 1024 ** 3, freeBytes: 10 * 1024 ** 3 },
    });

    expect(report.checks.find((check) => check.code === "CHANNEL")).toMatchObject({ status: "pass", detail: "1/1 个渠道已连接" });
    expect(report.checks.find((check) => check.code === "CHAT_READINESS")?.status).toBe("pass");
  });
});

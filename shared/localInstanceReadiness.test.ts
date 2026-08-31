import { describe, expect, it } from "vitest";
import { canProbeLocalInstanceReadiness, deriveLocalInstanceReadiness, deriveLocalReadinessChecks } from "./localInstanceReadiness";

describe("local instance readiness", () => {
  it.each(["stopped", "archived", "deleting", "deleted"])("never probes or marks a %s instance ready from stale observations", status => {
    const input = { status, physicalStatus: "running", chat: { ready: true, runtimeReady: true } };
    expect(canProbeLocalInstanceReadiness(input)).toBe(false);
    expect(deriveLocalInstanceReadiness(input)).toMatchObject({ phase: "stopped", runtimeReady: false, chatReady: false });
    expect(deriveLocalReadinessChecks(input).filter(check => ["runtime", "chat", "channels"].includes(check.key)).every(check => check.status === "stopped")).toBe(true);
  });

  it("separates a failed probe from a running runtime and an unattempted check", () => {
    expect(deriveLocalInstanceReadiness({ status: "running", chat: { ready: false, reason: "PROBE_FAILED" } }).phase).toBe("readiness_check_failed");
    expect(deriveLocalReadinessChecks({ status: "running" }).find(check => check.key === "chat")?.status).toBe("unknown");
    expect(deriveLocalReadinessChecks({ status: "running", chat: { probeStatus: "failed", reason: "HTTP_500" } }).find(check => check.key === "chat")?.status).toBe("failed");
  });

  it("does not infer model execution or channel delivery from a healthy chat API", () => {
    expect(deriveLocalReadinessChecks({ status: "running", chat: { ready: true }, modelConfigStatus: "written" })).toEqual([
      { key: "runtime", status: "ready" }, { key: "chat", status: "ready" },
      { key: "model_config", status: "configured" }, { key: "model_response", status: "unknown" }, { key: "channels", status: "unknown" },
    ]);
  });

  it("labels existing model success as historical evidence and keeps missing counts unknown", () => {
    expect(deriveLocalReadinessChecks({ modelRuntimeStatus: "callable", configuredChannels: 2 }).find(check => check.key === "model_response")?.status).toBe("historical_success");
    expect(deriveLocalReadinessChecks({ configuredChannels: 2 }).find(check => check.key === "channels")?.status).toBe("unknown");
    expect(deriveLocalReadinessChecks({ configuredChannels: 2, connectedChannels: 1 }).find(check => check.key === "channels")?.status).toBe("partial");
    expect(deriveLocalReadinessChecks({ configuredChannels: 0 }).find(check => check.key === "channels")?.status).toBe("not_configured");
  });

  it("does not treat sendability or failed-check payloads as API readiness", () => {
    expect(deriveLocalInstanceReadiness({ status: "running", chat: { ready: false, sendable: true } }).chatReady).toBe(false);
    expect(deriveLocalInstanceReadiness({ status: "running", chat: { ready: true, probeStatus: "failed" } }).chatReady).toBe(false);
  });
  it("keeps deployment lifecycle separate from chat readiness", () => {
    expect(deriveLocalInstanceReadiness({ status: "deploying" }).phase).toBe("deploying");
    expect(deriveLocalInstanceReadiness({
      status: "running",
      chat: { ready: false, runtimeReady: true, sendable: false, reason: "HERMES_API_NOT_READY" },
    }).phase).toBe("runtime_ready_chat_initializing");
  });

  it("reports local chat configuration without calling it a deployment failure", () => {
    const result = deriveLocalInstanceReadiness({
      status: "running",
      chat: { ready: false, runtimeReady: true, sendable: false, reason: "CHAT_API_NOT_ENABLED" },
    });
    expect(result.phase).toBe("runtime_ready_chat_configuration_required");
    expect(result.runtimeReady).toBe(true);
  });

  it("reports chat authentication and route failures separately", () => {
    expect(deriveLocalInstanceReadiness({
      status: "unhealthy",
      physicalStatus: "running",
      chat: { ready: false, runtimeReady: true, sendable: false, reason: "INTERNAL_ROUTE_AUTH_FAILED" },
    }).phase).toBe("chat_auth_or_route_failed");
    expect(deriveLocalInstanceReadiness({
      status: "running",
      chat: { ready: false, runtimeReady: true, sendable: false, reason: "INTERNAL_ROUTE_TIMEOUT" },
    }).phase).toBe("chat_auth_or_route_failed");
  });

  it("reports ready only when chat is sendable", () => {
    expect(deriveLocalInstanceReadiness({
      status: "running",
      chat: { ready: true, runtimeReady: true, sendable: true },
    }).phase).toBe("ready");
    expect(deriveLocalInstanceReadiness({
      status: "running",
      chat: { ready: true, runtimeReady: true, sendable: false },
    }).phase).toBe("runtime_ready_chat_initializing");
  });

  it("uses deployment failure only when the runtime is not running", () => {
    expect(deriveLocalInstanceReadiness({ status: "failed", deploymentError: "container exited" }).phase).toBe("deployment_failed");
    expect(deriveLocalInstanceReadiness({ status: "failed", physicalStatus: "running" }).phase).toBe("runtime_ready_chat_initializing");
  });
});

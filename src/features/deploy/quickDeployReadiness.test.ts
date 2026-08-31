import { describe, expect, it } from "vitest";
import { deriveQuickDeployReadiness } from "./quickDeployReadiness";

describe("quick deployment readiness", () => {
  it.each([{ ready: false, sendable: true }, { ready: true, sendable: false }])("does not conflate ready and sendable: %j", probe => {
    expect(deriveQuickDeployReadiness({ status: "success" }, { status: "running" }, probe).chat.tone).not.toBe("ready");
  });

  it("uses the same configuration inference as the instance and chat views", () => {
    expect(deriveQuickDeployReadiness({ status: "success" }, { status: "running", model_config_status: "mismatched" }, null)).toMatchObject({ runtime: { tone: "ready" }, chat: { tone: "attention", reason: "MODEL_CONFIG_UNAVAILABLE" } });
  });

  it("keeps a physically running container distinct from a chat route failure", () => {
    expect(deriveQuickDeployReadiness({ status: "success" }, { status: "unhealthy", physical_status: "running" }, { reason: "INTERNAL_ROUTE_AUTH_FAILED", ready: false })).toMatchObject({ runtime: { tone: "ready" }, chat: { tone: "attention" } });
  });

  it("stops polling without marking a manually stopped instance ready", () => {
    expect(deriveQuickDeployReadiness({ status: "success" }, { status: "stopped", physical_status: "running" }, { ready: true })).toMatchObject({ terminal: true, runtime: { tone: "attention" }, chat: { tone: "attention" } });
  });

  it("offers attention rather than indefinite startup after a failed API check", () => {
    expect(deriveQuickDeployReadiness({ status: "success" }, { status: "running" }, { ready: false, reason: "PROBE_FAILED", probeStatus: "failed" })).toMatchObject({ terminal: true, chat: { tone: "attention" } });
  });
  it("stays pending while the deployment task or runtime is not ready", () => {
    expect(deriveQuickDeployReadiness({ status: "running" }, { status: "deploying" }, null)).toMatchObject({ terminal: false, runtime: { tone: "pending" } });
    expect(deriveQuickDeployReadiness({ status: "success" }, { status: "initializing" }, null)).toMatchObject({ terminal: false, runtime: { tone: "pending" } });
  });

  it("finishes only when the task, runtime, and chat are actually ready", () => {
    expect(deriveQuickDeployReadiness(
      { status: "success", instanceStatus: "running" },
      { status: "running" },
      { ready: true },
    )).toEqual({ runtime: { tone: "ready" }, chat: { tone: "ready" }, terminal: true });
  });

  it("surfaces actionable chat configuration failures without hiding a healthy runtime", () => {
    expect(deriveQuickDeployReadiness(
      { status: "success" },
      { status: "running" },
      { ready: false, error: "CHAT_API_NOT_ENABLED", message: "Enable the chat API" },
    )).toEqual({
      runtime: { tone: "ready" },
      chat: { tone: "attention", reason: "Enable the chat API" },
      terminal: true,
    });
  });

  it("treats deployment and runtime failures as terminal failures", () => {
    expect(deriveQuickDeployReadiness(
      { status: "failed", errorCode: "HEALTH_CHECK_FAILED" },
      { status: "unhealthy" },
      null,
    )).toMatchObject({ terminal: true, runtime: { tone: "failed", reason: "HEALTH_CHECK_FAILED" }, chat: { tone: "failed" } });
  });
});

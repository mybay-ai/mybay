import { describe, expect, it } from "vitest";
import { deriveLocalInstanceReadiness } from "./localInstanceReadiness";

describe("local instance readiness", () => {
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

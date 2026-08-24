import { describe, expect, it } from "vitest";
import {
  buildLocalChatReadiness,
  resolveLocalChatLifecycleReadiness,
} from "./chatReadinessContract";

describe("local chat readiness contract", () => {
  it.each(["running", "gateway_ready", "partial_running", "dashboard_ready"])(
    "allows %s instances to proceed to the runtime probe",
    (status) => {
      expect(resolveLocalChatLifecycleReadiness({ status })).toBeNull();
    },
  );

  it.each(["failed", "unhealthy"])(
    "allows dashboardless %s instances to prove runtime readiness",
    (status) => {
      expect(resolveLocalChatLifecycleReadiness({ status, dashboardEnabled: false })).toBeNull();
      expect(resolveLocalChatLifecycleReadiness({ status, dashboardEnabled: true })).toMatchObject({
        ready: false,
        sendable: false,
        reason: "INSTANCE_NOT_RUNNING",
      });
    },
  );

  it("returns a complete unavailable response for stopped instances", () => {
    expect(resolveLocalChatLifecycleReadiness({ status: "stopped" })).toEqual({
      ready: false,
      runtimeReady: false,
      sendable: false,
      wakeable: false,
      runtimeState: "stopped",
      reason: "INSTANCE_NOT_RUNNING",
      error: "INSTANCE_NOT_RUNNING",
      message: "Instance is currently stopped and cannot accept chat requests.",
    });
  });

  it("keeps local ready state sendable but never wakeable", () => {
    expect(buildLocalChatReadiness({
      ready: true,
      status: "gateway_ready",
      message: "ready",
    })).toMatchObject({
      ready: true,
      runtimeReady: true,
      sendable: true,
      wakeable: false,
      runtimeState: "running",
      reason: null,
      error: null,
    });
  });

  it("keeps runtime readiness separate from chat sendability", () => {
    expect(buildLocalChatReadiness({
      ready: false,
      runtimeReady: true,
      sendable: false,
      status: "running",
      reason: "CHAT_API_NOT_ENABLED",
      message: "chat configuration required",
    })).toMatchObject({
      ready: false,
      runtimeReady: true,
      sendable: false,
      runtimeState: "running",
      reason: "CHAT_API_NOT_ENABLED",
    });
  });
});

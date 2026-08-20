import { describe, expect, it } from "vitest";
import {
  normalizeChatReadinessProbe,
  unavailableChatReadiness,
} from "./chatReadinessState";

describe("chat readiness client state", () => {
  it("preserves the complete server readiness contract", () => {
    expect(normalizeChatReadinessProbe({
      ready: false,
      runtimeReady: false,
      sendable: false,
      wakeable: false,
      runtimeState: "unhealthy",
      reason: "HERMES_API_NOT_READY",
      error: "IGNORED_WHEN_REASON_EXISTS",
      message: "starting",
    })).toEqual({
      ready: false,
      runtimeReady: false,
      sendable: false,
      wakeable: false,
      runtimeState: "unhealthy",
      reason: "HERMES_API_NOT_READY",
      message: "starting",
    });
  });

  it("supports the legacy ready-only response without making it wakeable", () => {
    expect(normalizeChatReadinessProbe({ ready: true })).toMatchObject({
      ready: true,
      runtimeReady: true,
      sendable: true,
      wakeable: false,
    });
  });

  it("fails closed when the readiness probe cannot be reached", () => {
    expect(unavailableChatReadiness()).toMatchObject({
      ready: false,
      runtimeReady: false,
      sendable: false,
      wakeable: false,
      reason: "PROBE_FAILED",
    });
  });
});

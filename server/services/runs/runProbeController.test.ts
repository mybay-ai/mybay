import { describe, expect, it } from "vitest";
import {
  hasRunExceededRuntime,
  isImmediateStopCancellation,
  resolveMaxRuntimeMs,
  resolvePartialOutput,
  resolveProbeFailure,
  resolveTerminalProbeOutcome,
} from "./runProbeController";

describe("run probe controller decisions", () => {
  it("clamps runtime configuration to 60 through 7200 seconds", () => {
    expect(resolveMaxRuntimeMs(undefined)).toBe(1_800_000);
    expect(resolveMaxRuntimeMs("invalid")).toBe(1_800_000);
    expect(resolveMaxRuntimeMs("5")).toBe(60_000);
    expect(resolveMaxRuntimeMs("9000")).toBe(7_200_000);
  });

  it("expires runtime only after the configured boundary", () => {
    const createdAt = "2026-08-17T00:00:00.000Z";
    expect(hasRunExceededRuntime(createdAt, 60_000, Date.parse("2026-08-17T00:01:00.000Z"))).toBe(false);
    expect(hasRunExceededRuntime(createdAt, 60_000, Date.parse("2026-08-17T00:01:00.001Z"))).toBe(true);
    expect(hasRunExceededRuntime("invalid", 60_000, Date.now())).toBe(false);
  });

  it("normalizes completed output and upstream duration", () => {
    expect(resolveTerminalProbeOutcome({
      status: "completed",
      output: { message: { content: "nested answer" } },
      usage: { total_tokens: 7 },
      duration_ms: 23,
    }, 10)).toEqual({
      status: "completed",
      assistantContent: "nested answer",
      usage: { total_tokens: 7 },
      durationMs: 23,
    });
    expect(resolveTerminalProbeOutcome({ status: "completed", output: "", message: "fallback" }, 10)).toEqual({
      status: "completed",
      assistantContent: "fallback",
      usage: {},
      durationMs: null,
    });
  });

  it("normalizes failed and cancelled terminal states while leaving active states open", () => {
    expect(resolveTerminalProbeOutcome({ status: "failed", error_code: "FAILED" }, 10)).toEqual({
      status: "failed",
      error: "FAILED",
    });
    expect(resolveTerminalProbeOutcome({ status: "cancelled_by_user" }, 10)).toEqual({
      status: "cancelled",
      errorCode: "CANCELLED_UPSTREAM",
    });
    expect(resolveTerminalProbeOutcome({ status: "running" }, 10)).toBeNull();
  });

  it("computes append, replacement, and unchanged partial output", () => {
    expect(resolvePartialOutput("hello", "hello world")).toEqual({
      hasPartialOutput: true,
      changed: true,
      newOutput: "hello world",
      delta: " world",
    });
    expect(resolvePartialOutput("hello", "replacement").delta).toBe("replacement");
    expect(resolvePartialOutput("hello", "hello").changed).toBe(false);
    expect(resolvePartialOutput("hello", undefined)).toEqual({
      hasPartialOutput: false,
      changed: false,
      newOutput: "hello",
      delta: "",
    });
  });

  it("prioritizes 404 and uses a strict three-minute zombie timeout", () => {
    const now = Date.parse("2026-08-17T00:03:00.000Z");
    expect(resolveProbeFailure(404, 0, now)).toBe("upstream_not_found");
    expect(resolveProbeFailure(503, now - 180_000, now)).toBe("retry");
    expect(resolveProbeFailure(503, now - 180_001, now)).toBe("zombie_timeout");
    expect(resolveProbeFailure(503, Number.NaN, now)).toBe("retry");
  });

  it("recognizes only immediate cancelled stop responses", () => {
    expect(isImmediateStopCancellation({ status: "cancelled" })).toBe(true);
    expect(isImmediateStopCancellation({ status: "cancelled_by_user" })).toBe(true);
    expect(isImmediateStopCancellation({ status: "stopping" })).toBe(false);
    expect(isImmediateStopCancellation(null)).toBe(false);
  });
});

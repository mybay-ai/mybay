import { describe, expect, it } from "vitest";
import { quickDeployProgressPercent, shouldContinueQuickDeployPolling, shouldProbeQuickDeployChat } from "./quickDeployDeliveryState";

describe("quick deployment delivery state", () => {
  it("probes chat only after both the task and runtime are ready", () => {
    expect(shouldProbeQuickDeployChat({ status: "running" }, { status: "running" })).toBe(false);
    expect(shouldProbeQuickDeployChat({ status: "success" }, { status: "initializing" })).toBe(false);
    expect(shouldProbeQuickDeployChat({ status: "success" }, { status: "gateway_ready" })).toBe(true);
  });

  it("stops polling on terminal readiness or timeout", () => {
    const pending = { runtime: { tone: "pending" as const }, chat: { tone: "pending" as const }, terminal: false };
    const ready = { runtime: { tone: "ready" as const }, chat: { tone: "ready" as const }, terminal: true };
    expect(shouldContinueQuickDeployPolling(pending, 1_000, 10_000)).toBe(true);
    expect(shouldContinueQuickDeployPolling(pending, 10_000, 10_000)).toBe(false);
    expect(shouldContinueQuickDeployPolling(ready, 1_000, 10_000)).toBe(false);
  });

  it("clamps task progress to a safe display range", () => {
    expect(quickDeployProgressPercent(undefined)).toBe(5);
    expect(quickDeployProgressPercent(-10)).toBe(5);
    expect(quickDeployProgressPercent(48.4)).toBe(48);
    expect(quickDeployProgressPercent(120)).toBe(100);
  });
});

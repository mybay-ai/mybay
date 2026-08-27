import { describe, expect, it } from "vitest";
import {
  canApplyTerminalWatchdogResponse,
  isFinalStepTerminalHint,
  readAuthoritativeTerminalStatus,
  shouldPublishWatchdogStatusUnknown,
  shouldRunTerminalWatchdog,
} from "./runTerminalWatchdog";

describe("local run terminal watchdog", () => {
  it("accepts only the currently bound instance, conversation, run, and generation", () => {
    const current = {
      requestGeneration: 4, currentGeneration: 4,
      targetRunId: "run-1", currentRunId: "run-1",
      instanceId: "instance-1", currentInstanceId: "instance-1",
      conversationId: "conv-1", currentConversationId: "conv-1",
    };
    expect(canApplyTerminalWatchdogResponse(current)).toBe(true);
    expect(canApplyTerminalWatchdogResponse({ ...current, currentRunId: "run-2" })).toBe(false);
    expect(canApplyTerminalWatchdogResponse({ ...current, currentConversationId: "conv-2" })).toBe(false);
    expect(canApplyTerminalWatchdogResponse({ ...current, currentGeneration: 5 })).toBe(false);
  });

  it("uses a completed final step only as a prompt for an authoritative status check", () => {
    expect(isFinalStepTerminalHint({ id: "step-final", status: "completed" })).toBe(true);
    expect(isFinalStepTerminalHint({ stepType: "final", status: "failed" })).toBe(true);
    expect(isFinalStepTerminalHint({ id: "tool-1", status: "completed" })).toBe(false);
    expect(readAuthoritativeTerminalStatus({ status: "completed" })).toBe("completed");
    expect(readAuthoritativeTerminalStatus({ status: "running" })).toBeNull();
  });

  it("backs off to status unknown after repeated failures and yields to fallback polling", () => {
    expect(shouldPublishWatchdogStatusUnknown(2)).toBe(false);
    expect(shouldPublishWatchdogStatusUnknown(3)).toBe(true);
    expect(shouldRunTerminalWatchdog(false)).toBe(true);
    expect(shouldRunTerminalWatchdog(true)).toBe(false);
  });
});

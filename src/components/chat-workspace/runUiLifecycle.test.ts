import { describe, expect, it } from "vitest";
import {
  canExecutePollingCallback,
  finalizeRunSteps,
  isTerminalRunStatus,
  shouldTriggerFallback
} from "./runUiLifecycle";

describe("run UI lifecycle guards", () => {
  it("accepts polling only for the currently bound run generation", () => {
    expect(canExecutePollingCallback({
      boundRunId: "run-1",
      currentRunId: "run-1",
      boundGeneration: 3,
      currentGeneration: 3
    })).toBe(true);
    expect(canExecutePollingCallback({
      boundRunId: "run-1",
      currentRunId: "run-2",
      boundGeneration: 3,
      currentGeneration: 3
    })).toBe(false);
    expect(canExecutePollingCallback({
      boundRunId: "run-1",
      currentRunId: "run-1",
      boundGeneration: 2,
      currentGeneration: 3
    })).toBe(false);
    expect(canExecutePollingCallback({
      boundRunId: "run-1",
      currentRunId: "run-1",
      boundGeneration: 3,
      currentGeneration: 3,
      aborted: true
    })).toBe(false);
  });

  it("does not start fallback after switching instance or conversation", () => {
    const base = {
      selectedInstanceId: "instance-1",
      boundInstanceId: "instance-1",
      selectedConversationId: "conv-1",
      boundConversationId: "conv-1"
    };
    expect(shouldTriggerFallback(base)).toBe(true);
    expect(shouldTriggerFallback({ ...base, selectedConversationId: "conv-2" })).toBe(false);
    expect(shouldTriggerFallback({ ...base, selectedInstanceId: "instance-2" })).toBe(false);
    expect(shouldTriggerFallback({ ...base, terminal: true })).toBe(false);
    expect(shouldTriggerFallback({ ...base, aborted: true })).toBe(false);
  });

  it("treats stopped runs as terminal and finalizes active tools", () => {
    expect(isTerminalRunStatus("stopped")).toBe(true);
    const finalized = finalizeRunSteps([
      { id: "tool-1", name: "Search", status: "running", startedAt: 10 },
      { id: "tool-2", name: "Read", status: "completed", startedAt: 20, completedAt: 30 }
    ], "stopped");
    expect(finalized[0]?.status).toBe("failed");
    expect(finalized[0]?.completedAt).toEqual(expect.any(Number));
    expect(finalized[1]?.status).toBe("completed");
    expect(finalized[1]?.completedAt).toBe(30);
  });
});

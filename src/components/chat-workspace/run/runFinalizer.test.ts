import { describe, expect, it } from "vitest";
import { finalizeRunExecution } from "./runFinalizer";
import type { RunExecutionState } from "./runTypes";

function createState(): RunExecutionState {
  return {
    runId: "run-1",
    status: "running",
    lastProcessedSeq: 2,
    blocks: [
      { id: "text-1", type: "text", firstSeq: 1, lastSeq: 1, content: "partial" },
      { id: "tool-1", type: "tool", firstSeq: 2, lastSeq: 2, toolCallId: "call-1", tool: "read", status: "running", startedAt: 100 },
      { id: "approval-1", type: "approval", firstSeq: 2, lastSeq: 2, approvalId: "approval-1", status: "pending" }
    ]
  };
}

describe("finalizeRunExecution", () => {
  it("keeps partial output and fails a running tool when the run is stopped", () => {
    const next = finalizeRunExecution(createState(), "stopped", 250);
    expect(next.status).toBe("stopped");
    expect(next.blocks[0]).toMatchObject({ type: "text", content: "partial" });
    expect(next.blocks[1]).toMatchObject({ type: "tool", status: "failed", completedAt: 250, durationMs: 150 });
  });

  it("completes a running tool when the run completes", () => {
    const next = finalizeRunExecution(createState(), "completed", 250);
    expect(next.blocks[1]).toMatchObject({ status: "completed", durationMs: 150 });
  });

  it("does not rewrite an already settled tool", () => {
    const state = createState();
    const tool = state.blocks[1];
    if (tool.type !== "tool") throw new Error("expected tool block");
    state.blocks[1] = { ...tool, status: "completed", completedAt: 180, durationMs: 80 };
    expect(finalizeRunExecution(state, "failed", 250).blocks[1]).toEqual(state.blocks[1]);
  });

  it("expires an unresolved approval when the run becomes terminal", () => {
    expect(finalizeRunExecution(createState(), "failed", 250).blocks[2]).toMatchObject({ type: "approval", status: "expired" });
  });
});

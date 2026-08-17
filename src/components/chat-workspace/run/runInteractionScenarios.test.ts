import { describe, expect, it } from "vitest";
import { createRunExecutionState, deriveToolSteps } from "./runReducer";
import { consumeRunSseFrame } from "./runStreamCoordinator";

describe("local run interaction scenarios", () => {
  it("keeps independent tool calls stable across start and completion events", () => {
    let state = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    let cursor = { currentEventId: 0, lastCommittedEventId: 0 };
    for (const frame of [
      { eventId: 1, event: "step", data: JSON.stringify({ id: "search", tool_name: "search", status: "running" }) },
      { eventId: 2, event: "step", data: JSON.stringify({ id: "read", tool_name: "read_file", status: "running" }) },
      { eventId: 3, event: "step", data: JSON.stringify({ id: "search", tool_name: "search", status: "completed" }) }
    ]) {
      const result = consumeRunSseFrame(state, cursor, {
        ...frame,
        runId: "run-1",
        conversationId: "conv-1"
      });
      state = result.state;
      cursor = result.cursor;
    }

    expect(deriveToolSteps(state.blocks).map(step => [step.id, step.status])).toEqual([
      ["search", "completed"],
      ["read", "running"]
    ]);
    expect(cursor.lastCommittedEventId).toBe(3);
  });

  it("resolves approval without allowing a replay to reopen it", () => {
    let state = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    const requested = consumeRunSseFrame(state, { currentEventId: 0, lastCommittedEventId: 0 }, {
      eventId: 1,
      event: "approval",
      data: JSON.stringify({ id: "approval-1", status: "pending", title: "Run command" }),
      runId: "run-1",
      conversationId: "conv-1"
    });
    const resolved = consumeRunSseFrame(requested.state, requested.cursor, {
      eventId: 2,
      event: "approval",
      data: JSON.stringify({ id: "approval-1", status: "resolved", choice: "once" }),
      runId: "run-1",
      conversationId: "conv-1"
    });
    const replayedPending = consumeRunSseFrame(resolved.state, resolved.cursor, {
      eventId: 3,
      event: "approval",
      data: JSON.stringify({ id: "approval-1", status: "pending" }),
      runId: "run-1",
      conversationId: "conv-1"
    });
    const approval = replayedPending.state.blocks.find(block => block.type === "approval");

    expect(approval).toMatchObject({ type: "approval", approvalId: "approval-1", status: "resolved" });
    expect(replayedPending.cursor.lastCommittedEventId).toBe(3);
  });
});

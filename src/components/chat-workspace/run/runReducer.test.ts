import { describe, expect, it } from "vitest";
import { createRunExecutionState, deriveAssistantText, deriveToolSteps, reduceRunEvents, runReducer } from "./runReducer";
import type { NormalizedRunEvent } from "./runTypes";

function event(seq: number, type: NormalizedRunEvent["type"], payload: unknown, runId = "run-1"): NormalizedRunEvent {
  return { seq, type, payload, runId, conversationId: "conv-1" };
}

describe("runReducer", () => {
  it("sorts events and ignores duplicate or stale sequences", () => {
    const initial = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    const reduced = reduceRunEvents(initial, [
      event(2, "text.delta", { delta: " world" }),
      event(1, "text.delta", { delta: "hello" })
    ]);
    expect(deriveAssistantText(reduced.blocks)).toBe("hello world");
    expect(runReducer(reduced, event(2, "text.delta", { delta: " duplicate" }))).toBe(reduced);
  });

  it("rejects events from another run or conversation", () => {
    const initial = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    expect(runReducer(initial, event(1, "text.delta", { delta: "x" }, "run-2"))).toBe(initial);
    expect(runReducer(initial, { ...event(1, "text.delta", { delta: "x" }), conversationId: "conv-2" })).toBe(initial);
  });

  it("does not regress a completed tool to running", () => {
    const initial = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    const completed = runReducer(initial, event(1, "tool.completed", { id: "tool-1", tool: "search" }));
    const lateStarted = runReducer(completed, event(2, "tool.started", { id: "tool-1", tool: "search" }));
    expect(deriveToolSteps(lateStarted.blocks)[0]?.status).toBe("completed");
  });

  it("keeps interim commentary in the timeline but out of the final answer", () => {
    const initial = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    const commentary = runReducer(initial, event(1, "commentary.added", { id: "note-1", text: "Checked the entry points." }));
    const final = runReducer(commentary, event(2, "text.delta", { delta: "Final answer" }));
    expect(final.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "commentary", commentaryId: "note-1", content: "Checked the entry points." }),
      expect.objectContaining({ type: "text", content: "Final answer" })
    ]));
    expect(deriveAssistantText(final.blocks)).toBe("Final answer");
  });

  it("updates replayed commentary by stable id without duplicating it", () => {
    const initial = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    const first = runReducer(initial, event(1, "commentary.added", { id: "note-1", text: "First" }));
    const updated = runReducer(first, event(2, "commentary.added", { id: "note-1", text: "Updated" }));
    expect(updated.blocks.filter(block => block.type === "commentary")).toEqual([
      expect.objectContaining({ commentaryId: "note-1", content: "Updated", firstSeq: 1, lastSeq: 2 })
    ]);
  });

  it("freezes output after a terminal status", () => {
    const initial = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    const terminal = runReducer(initial, event(1, "status.changed", { status: "completed" }));
    expect(runReducer(terminal, event(2, "text.delta", { delta: "late" }))).toBe(terminal);
  });

  it("settles pending approvals when a run becomes terminal", () => {
    const initial = createRunExecutionState({ runId: "run-1", conversationId: "conv-1", status: "running" });
    const waiting = runReducer(initial, event(1, "approval.requested", { id: "approval-1", status: "pending" }));
    const terminal = runReducer(waiting, event(2, "status.changed", { status: "failed" }));
    expect(terminal.blocks.find(block => block.type === "approval")).toMatchObject({ type: "approval", status: "expired" });
  });
});

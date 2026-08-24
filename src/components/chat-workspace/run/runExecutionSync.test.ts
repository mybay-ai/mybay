import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { createRunExecutionState, runReducer } from "./runReducer";
import { applyRunExecutionToMessages, applyRunTextSnapshot } from "./runExecutionSync";

describe("run execution message synchronization", () => {
  it("updates only the assistant message explicitly bound to the run", () => {
    const messages: ChatMessage[] = [
      { id: "assistant-old", role: "assistant", content: "old", status: "pending", conversation_id: "conv-1" },
      { id: "assistant-new", role: "assistant", content: "", status: "pending", conversation_id: "conv-1" }
    ];
    const state = runReducer(createRunExecutionState({
      runId: "run-new",
      conversationId: "conv-1",
      assistantMessageId: "assistant-new"
    }), {
      seq: 1,
      runId: "run-new",
      conversationId: "conv-1",
      type: "text.delta",
      payload: { delta: "new answer" }
    });

    const updated = applyRunExecutionToMessages(messages, state);
    expect(updated[0].content).toBe("old");
    expect(updated[1]).toMatchObject({ content: "new answer", metadata: { runId: "run-new" } });
  });

  it("does not fall back to the previous assistant when the placeholder is absent", () => {
    const messages: ChatMessage[] = [
      { id: "assistant-old", role: "assistant", content: "old", status: "pending", conversation_id: "conv-1" }
    ];
    const state = createRunExecutionState({
      runId: "run-new",
      conversationId: "conv-1",
      assistantMessageId: "assistant-new",
      initialText: "new answer"
    });

    expect(applyRunExecutionToMessages(messages, state)).toBe(messages);
  });

  it("reconciles a more complete snapshot without advancing the SSE cursor", () => {
    const streamed = runReducer(createRunExecutionState({ runId: "run-1" }), {
      seq: 4,
      runId: "run-1",
      type: "text.delta",
      payload: { delta: "partial" }
    });
    const reconciled = applyRunTextSnapshot(streamed, "partial result");
    const stale = applyRunTextSnapshot(reconciled, "partial");

    expect(reconciled.assistantText).toBe("partial result");
    expect(reconciled.lastProcessedSeq).toBe(4);
    expect(stale).toBe(reconciled);
  });

  it("lets SSE replay catch up to a snapshot without duplicating recovered text", () => {
    const streamed = runReducer(createRunExecutionState({ runId: "run-1" }), {
      seq: 1,
      runId: "run-1",
      type: "text.delta",
      payload: { delta: "hello" }
    });
    const snapshotted = applyRunTextSnapshot(streamed, "hello world");
    const caughtUp = runReducer(snapshotted, {
      seq: 2,
      runId: "run-1",
      type: "text.delta",
      payload: { delta: " world" }
    });

    expect(caughtUp.assistantText).toBe("hello world");
    expect(caughtUp.streamText).toBe("hello world");
    expect(caughtUp.lastProcessedSeq).toBe(2);
  });
});

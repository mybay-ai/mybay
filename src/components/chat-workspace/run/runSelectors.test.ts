import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { createRunExecutionState } from "./runReducer";
import { findRunAssistantMessageIndex, shouldShowLegacyRunLoading } from "./runSelectors";

describe("run message selectors", () => {
  const messages: ChatMessage[] = [
    { id: "user-1", role: "user", content: "hello", conversation_id: "conv-1" },
    { id: "assistant-1", role: "assistant", content: "", status: "pending", conversation_id: "conv-1", request_id: "request-1" }
  ];

  it("prefers explicit assistant id and then request id", () => {
    expect(findRunAssistantMessageIndex(messages, createRunExecutionState({
      runId: "run-1",
      conversationId: "conv-1",
      assistantMessageId: "assistant-1"
    }))).toBe(1);
    expect(findRunAssistantMessageIndex(messages, createRunExecutionState({
      runId: "run-1",
      conversationId: "conv-1",
      requestId: "request-1"
    }))).toBe(1);
  });

  it("does not bind a run to another conversation", () => {
    expect(findRunAssistantMessageIndex(messages, createRunExecutionState({
      runId: "run-2",
      conversationId: "conv-2"
    }))).toBe(-1);
  });

  it("never binds an identified new run to a previous pending assistant", () => {
    expect(findRunAssistantMessageIndex(messages, createRunExecutionState({
      runId: "run-new",
      conversationId: "conv-1",
      requestId: "request-new",
      assistantMessageId: "assistant-new"
    }))).toBe(-1);
  });

  it("hides the legacy loader after timeline blocks exist", () => {
    expect(shouldShowLegacyRunLoading(true, createRunExecutionState({ runId: "run-1" }))).toBe(true);
    expect(shouldShowLegacyRunLoading(true, createRunExecutionState({
      runId: "run-1",
      initialStep: { id: "queued", tool: "agent", label: "Queued" }
    }))).toBe(false);
  });
});

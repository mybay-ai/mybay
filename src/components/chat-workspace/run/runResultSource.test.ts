import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { createRunExecutionState } from "./runReducer";
import { resolveWorkspaceAssistantResult } from "./runResultSource";

describe("workspace assistant result", () => {
  it("uses the active run instead of another turn's latest answer", () => {
    const messages: ChatMessage[] = [
      { id: "assistant-old", role: "assistant", content: "old result", status: "completed", metadata: { runId: "run-old" } },
      { id: "assistant-live", role: "assistant", content: "live partial", status: "pending", metadata: { runId: "run-live" } }
    ];
    const active = createRunExecutionState({
      runId: "run-live",
      assistantMessageId: "assistant-live",
      initialText: "live complete"
    });

    expect(resolveWorkspaceAssistantResult(messages, active, "run-live")).toMatchObject({
      content: "live complete",
      runId: "run-live",
      live: true
    });
  });

  it("does not expose an older result while the active placeholder is missing", () => {
    const messages: ChatMessage[] = [
      { id: "assistant-old", role: "assistant", content: "old result", status: "completed", metadata: { runId: "run-old" } }
    ];
    const active = createRunExecutionState({
      runId: "run-new",
      assistantMessageId: "assistant-new",
      initialText: "new streaming result"
    });

    expect(resolveWorkspaceAssistantResult(messages, active, "run-new")).toMatchObject({
      message: undefined,
      content: "new streaming result",
      runId: "run-new",
      live: true
    });
  });
});

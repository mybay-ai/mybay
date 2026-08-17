import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { normalizeRecoveredRunStatus, recoverActiveRunMessages } from "./runRecovery";

describe("active Run recovery", () => {
  it("inserts a deterministic Agent reply after the Run user message", () => {
    const messages: ChatMessage[] = [
      { id: "user-old", role: "user", content: "old", conversation_id: "conv-1" },
      { id: "assistant-old", role: "assistant", content: "done", conversation_id: "conv-1" },
      { id: "user-active", role: "user", content: "work", request_id: "request-1", conversation_id: "conv-1" }
    ];
    const recovered = recoverActiveRunMessages(messages, {
      id: "run-1",
      status: "queued",
      userMessageId: "user-active",
      requestId: "request-1",
      partialOutput: "partial"
    }, "conv-1");

    expect(recovered.assistantMessageId).toBe("assistant-stream-run-1");
    expect(recovered.messages.at(-1)).toMatchObject({
      id: "assistant-stream-run-1",
      role: "assistant",
      content: "partial",
      request_id: "request-1",
      metadata: { runId: "run-1", requestId: "request-1" }
    });
  });

  it("reuses an existing matching Agent reply instead of duplicating it", () => {
    const messages: ChatMessage[] = [
      { id: "assistant-existing", role: "assistant", content: "partial", conversation_id: "conv-1", metadata: { run_id: "run-1" } }
    ];
    const recovered = recoverActiveRunMessages(messages, { id: "run-1", status: "running" }, "conv-1");
    expect(recovered.assistantMessageId).toBe("assistant-existing");
    expect(recovered.messages).toHaveLength(1);
  });

  it("normalizes unsupported or missing active statuses to running", () => {
    expect(normalizeRecoveredRunStatus("stopping")).toBe("stopping");
    expect(normalizeRecoveredRunStatus("unexpected")).toBe("running");
    expect(normalizeRecoveredRunStatus(undefined)).toBe("running");
  });
});

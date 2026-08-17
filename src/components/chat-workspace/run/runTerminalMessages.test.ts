import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { RunExecutionState } from "./runTypes";
import { markRunMessagesStopped } from "./runTerminalMessages";

const execution: RunExecutionState = {
  runId: "run-1",
  requestId: "req-1",
  assistantMessageId: "assistant-1",
  status: "running",
  lastProcessedSeq: 0,
  blocks: []
};

describe("markRunMessagesStopped", () => {
  it("places the terminal state on the matching assistant reply", () => {
    const messages: ChatMessage[] = [
      { id: "user-1", role: "user", content: "go", status: "pending", request_id: "req-1" },
      { id: "assistant-1", role: "assistant", content: "partial", status: "pending", request_id: "req-1" }
    ];
    const next = markRunMessagesStopped(messages, execution, "stopped");
    expect(next[0]).toMatchObject({ status: "completed" });
    expect(next[1]).toMatchObject({ status: "stopped", error_code: "RUN_STOPPED", content: "partial" });
  });

  it("falls back to the latest user message when no assistant reply exists", () => {
    const messages: ChatMessage[] = [{ id: "user-1", role: "user", content: "go", status: "pending" }];
    expect(markRunMessagesStopped(messages, execution, "stopped")[0]).toMatchObject({ status: "stopped", error_code: "RUN_STOPPED" });
  });
});

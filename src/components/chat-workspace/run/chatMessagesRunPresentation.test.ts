import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { ChatApprovalRequest } from "../useChatRuns";
import { createRunExecutionState } from "./runReducer";
import { deriveChatMessagesRunPresentation } from "./chatMessagesRunPresentation";

const pendingApproval: ChatApprovalRequest = {
  id: "approval-1",
  status: "pending",
  choices: ["once", "deny"]
};

const baseInput = {
  selectedConversationId: "conversation-1",
  messages: [] as ChatMessage[],
  sending: true,
  activeRunId: "run-1",
  toolSteps: [],
  runMetrics: null,
  approvalRequests: [] as ChatApprovalRequest[]
};

describe("chat messages run presentation", () => {
  it("ignores execution and approvals from another conversation", () => {
    const result = deriveChatMessagesRunPresentation({
      ...baseInput,
      incomingExecution: createRunExecutionState({ runId: "run-1", conversationId: "conversation-2" }),
      approvalRequests: [pendingApproval]
    });

    expect(result.runExecutionState).toBeNull();
    expect(result.detachedRunMessage).toBeNull();
    expect(result.inlineApproval).toBeNull();
  });

  it("binds an execution to its existing assistant message and hides the legacy loader after text appears", () => {
    const messages: ChatMessage[] = [{
      id: "assistant-1",
      role: "assistant",
      content: "Partial answer",
      status: "pending",
      conversation_id: "conversation-1",
      metadata: { runId: "run-1" }
    }];
    const result = deriveChatMessagesRunPresentation({
      ...baseInput,
      messages,
      incomingExecution: createRunExecutionState({ runId: "run-1", conversationId: "conversation-1" })
    });

    expect(result.runAssistantIndex).toBe(0);
    expect(result.detachedRunMessage).toBeNull();
    expect(result.shouldShowLegacyLoading).toBe(false);
  });

  it.each([
    ["running", "pending"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["cancelled", "stopped"],
    ["expired", "stopped"]
  ] as const)("creates a detached message for %s execution", (executionStatus, messageStatus) => {
    const execution = createRunExecutionState({
      runId: "run-1",
      conversationId: "conversation-1",
      requestId: "request-1"
    });
    execution.status = executionStatus;
    execution.assistantText = "Incremental answer";

    const result = deriveChatMessagesRunPresentation({ ...baseInput, incomingExecution: execution });

    expect(result.detachedRunMessage).toMatchObject({
      id: "detached-run-run-1",
      content: "Incremental answer",
      status: messageStatus,
      conversation_id: "conversation-1",
      request_id: "request-1",
      metadata: { runId: "run-1", requestId: "request-1" }
    });
  });

  it("uses the pending approval in the inline card and shared run status", () => {
    const execution = createRunExecutionState({ runId: "run-1", conversationId: "conversation-1" });
    execution.status = "running";
    const result = deriveChatMessagesRunPresentation({
      ...baseInput,
      incomingExecution: execution,
      approvalRequests: [{ ...pendingApproval, status: "resolved" }, pendingApproval]
    });

    expect(result.inlineApproval).toEqual(pendingApproval);
    expect(result.runDisplayStatus).toBe("waiting_for_approval");
    expect(result.runStatusI18nKey).toBe("runStatusWaitingForApproval");
  });
});

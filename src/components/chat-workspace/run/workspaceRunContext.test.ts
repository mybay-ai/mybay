import { describe, expect, it } from "vitest";
import { createRunExecutionState } from "./runReducer";
import { resolveSelectedWorkspaceRunContext } from "./workspaceRunContext";

const step = { id: "step-1", name: "tool", status: "running" as const };
const approval = { id: "approval-1", status: "pending" as const, choices: ["once" as const] };

describe("selected workspace run context", () => {
  it("keeps all panels bound to the selected active run", () => {
    const execution = createRunExecutionState({ runId: "run-1", conversationId: "conversation-1" });
    expect(resolveSelectedWorkspaceRunContext({
      selectedConversationId: "conversation-1",
      activeRunConversationId: "conversation-1",
      sending: true,
      activeRunId: "run-1",
      runExecutionState: execution,
      runMetrics: { runId: "run-1", status: "running" },
      toolSteps: [step],
      approvalRequests: [approval],
    })).toMatchObject({ activeRunId: "run-1", execution, toolSteps: [step], approvalRequests: [approval], running: true });
  });

  it("hides the previous conversation run before effects reset state", () => {
    const execution = createRunExecutionState({ runId: "run-old", conversationId: "conversation-old" });
    expect(resolveSelectedWorkspaceRunContext({
      selectedConversationId: "conversation-new",
      activeRunConversationId: "conversation-old",
      sending: true,
      activeRunId: "run-old",
      runExecutionState: execution,
      runMetrics: { runId: "run-old", status: "running" },
      toolSteps: [step],
      approvalRequests: [approval],
    })).toEqual({ activeRunId: null, execution: null, metrics: null, toolSteps: [], approvalRequests: [], running: false });
  });

  it("does not mix stale steps into a newly identified run", () => {
    const staleExecution = createRunExecutionState({ runId: "run-old", conversationId: "conversation-1" });
    const resolved = resolveSelectedWorkspaceRunContext({
      selectedConversationId: "conversation-1",
      activeRunConversationId: "conversation-1",
      sending: true,
      activeRunId: "run-new",
      runExecutionState: staleExecution,
      runMetrics: { runId: "run-old", status: "running" },
      toolSteps: [step],
      approvalRequests: [approval],
    });
    expect(resolved.activeRunId).toBe("run-new");
    expect(resolved.execution).toBeNull();
    expect(resolved.metrics).toBeNull();
    expect(resolved.toolSteps).toEqual([]);
    expect(resolved.approvalRequests).toEqual([]);
  });
});

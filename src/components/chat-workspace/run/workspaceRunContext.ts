import type { ChatToolStep } from "../ChatToolProgress";
import type { ChatApprovalRequest, ChatRunMetrics } from "../useChatRuns";
import type { RunExecutionState } from "./runTypes";

type WorkspaceRunContextInput = {
  selectedConversationId: string | null;
  activeRunConversationId: string | null;
  sending: boolean;
  activeRunId: string | null;
  runExecutionState: RunExecutionState | null;
  runMetrics: ChatRunMetrics | null;
  toolSteps: ChatToolStep[];
  approvalRequests: ChatApprovalRequest[];
};

export type SelectedWorkspaceRunContext = {
  activeRunId: string | null;
  execution: RunExecutionState | null;
  metrics: ChatRunMetrics | null;
  toolSteps: ChatToolStep[];
  approvalRequests: ChatApprovalRequest[];
  running: boolean;
};

export function resolveSelectedWorkspaceRunContext(input: WorkspaceRunContextInput): SelectedWorkspaceRunContext {
  const selectedConversationId = input.selectedConversationId;
  if (!selectedConversationId) {
    return { activeRunId: null, execution: null, metrics: null, toolSteps: [], approvalRequests: [], running: false };
  }

  const ownerConversationMatches = !input.activeRunConversationId
    || input.activeRunConversationId === selectedConversationId;
  const executionMatches = Boolean(
    input.runExecutionState
    && input.runExecutionState.conversationId === selectedConversationId
  );
  const execution = executionMatches ? input.runExecutionState : null;
  const activeRunId = input.sending && ownerConversationMatches ? input.activeRunId : null;
  const canonicalRunId = activeRunId || execution?.runId || null;
  const metrics = ownerConversationMatches
    && input.runMetrics
    && (!canonicalRunId || !input.runMetrics.runId || input.runMetrics.runId === canonicalRunId)
      ? input.runMetrics
      : null;
  const runPayloadMatches = Boolean(execution && (!canonicalRunId || execution.runId === canonicalRunId));
  const selectedExecution = runPayloadMatches ? execution : null;

  return {
    activeRunId,
    execution: selectedExecution,
    metrics,
    toolSteps: runPayloadMatches ? input.toolSteps : [],
    approvalRequests: runPayloadMatches ? input.approvalRequests : [],
    running: Boolean(activeRunId),
  };
}

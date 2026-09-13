import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { ChatToolStep } from "../ChatToolProgress";
import type { ChatApprovalRequest, ChatRunMetrics } from "../useChatRuns";
import { selectInlineApproval } from "./approvalSelectors";
import { deriveRunAssistantText, findRunAssistantMessageIndex, shouldShowLegacyRunLoading } from "./runSelectors";
import { getRunStatusI18nKey, resolveRunDisplayStatus, type RunDisplayStatus } from "./runStatusSemantics";
import type { RunExecutionState } from "./runTypes";

type ChatMessagesRunPresentationInput = {
  selectedConversationId: string | null;
  messages: ChatMessage[];
  sending: boolean;
  activeRunId: string | null;
  toolSteps: ChatToolStep[];
  incomingExecution?: RunExecutionState | null;
  runMetrics?: ChatRunMetrics | null;
  approvalRequests: ChatApprovalRequest[];
};

export type ChatMessagesRunPresentation = {
  runExecutionState: RunExecutionState | null;
  runDisplayStatus: RunDisplayStatus;
  runStatusI18nKey: string;
  runAssistantIndex: number;
  detachedRunMessage: ChatMessage | null;
  inlineApproval: ChatApprovalRequest | null;
  shouldShowLegacyLoading: boolean;
};

function toDetachedMessageStatus(status: RunExecutionState["status"]): ChatMessage["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (["cancelled", "stopped", "expired"].includes(status)) return "stopped";
  return "pending";
}

export function deriveChatMessagesRunPresentation({
  selectedConversationId,
  messages,
  sending,
  activeRunId,
  toolSteps,
  incomingExecution,
  runMetrics,
  approvalRequests
}: ChatMessagesRunPresentationInput): ChatMessagesRunPresentation {
  const runExecutionState = incomingExecution?.conversationId === selectedConversationId ? incomingExecution : null;
  const runDisplayStatus = resolveRunDisplayStatus({
    activeRunId,
    executionRunId: runExecutionState?.runId,
    executionStatus: runExecutionState?.status,
    metricRunId: runMetrics?.runId,
    metricStatus: runMetrics?.status,
    hasPendingApproval: approvalRequests.some(request => request.status === "pending"),
    hasRunningTool: toolSteps.some(step => step.status === "running")
  });
  const runAssistantIndex = runExecutionState ? findRunAssistantMessageIndex(messages, runExecutionState) : -1;
  const detachedRunMessage: ChatMessage | null = runExecutionState && runAssistantIndex < 0 ? {
    id: `detached-run-${runExecutionState.runId}`,
    role: "assistant",
    content: deriveRunAssistantText(runExecutionState),
    status: toDetachedMessageStatus(runExecutionState.status),
    conversation_id: runExecutionState.conversationId || selectedConversationId,
    request_id: runExecutionState.requestId || null,
    metadata: { runId: runExecutionState.runId, requestId: runExecutionState.requestId }
  } : null;
  const inlineApproval = runExecutionState ? selectInlineApproval(approvalRequests) : null;
  const runAssistantHasContent = runAssistantIndex >= 0 && Boolean(messages[runAssistantIndex]?.content.trim());

  return {
    runExecutionState,
    runDisplayStatus,
    runStatusI18nKey: getRunStatusI18nKey(runDisplayStatus),
    runAssistantIndex,
    detachedRunMessage,
    inlineApproval,
    shouldShowLegacyLoading: shouldShowLegacyRunLoading(sending, runExecutionState) && !runAssistantHasContent
  };
}

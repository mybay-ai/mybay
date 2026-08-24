import { useTranslation } from "react-i18next";
import { AlertCircle, LoaderCircle } from "lucide-react";
import type { RefObject } from "react";
import { findRetrySourceMessage } from "./run/retrySelectors";
import type { AgentInstance, User as UserType } from "../../types";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ChatNoInstancesEmptyState, ChatMessagesLoadingState, ChatWelcomeEmptyState } from "./ChatEmptyStates";
import { ChatReadinessBanner } from "./ChatReadinessBanner";
import type { ChatToolStep } from "./ChatToolProgress";
import type { ChatApprovalChoice, ChatApprovalRequest, ChatRunMetrics } from "./useChatRuns";
import type { PendingAttachment } from "./ChatInputBar";
import type { RunExecutionState } from "./run/runTypes";
import { deriveRunAssistantText, findRunAssistantMessageIndex, shouldShowLegacyRunLoading } from "./run/runSelectors";
import { selectInlineApproval } from "./run/approvalSelectors";

type ReadinessState = {
  ready: boolean;
  reason?: string;
  message?: string;
};

type ChatMessagesPanelProps = {
  scrollContainerRef: RefObject<HTMLDivElement>;
  messagesEndRef: RefObject<HTMLDivElement>;
  selectedId: string;
  isChatReady: boolean;
  selectedInstance?: AgentInstance;
  selectedReadiness?: ReadinessState;
  instances: AgentInstance[];
  loadingInstances: boolean;
  loadingMessages: boolean;
  messages: ChatMessage[];
  nextCursorSeq: number | null;
  loadingMoreMessages: boolean;
  selectedConversationId: string | null;
  currentUser?: UserType | null;
  sending: boolean;
  activeRunId: string | null;
  toolSteps: ChatToolStep[];
  runExecutionState?: RunExecutionState | null;
  runMetrics?: ChatRunMetrics | null;
  approvalRequests?: ChatApprovalRequest[];
  canRespondToApproval?: boolean;
  onRespondToApproval?: (choice: ChatApprovalChoice, approvalId?: string, resolveAll?: boolean) => void | Promise<void>;
  error: string | null;
  onGoToInstanceManage: () => void;
  onUsePrompt: (prompt: string) => void;
  onLoadMoreMessages: () => void;
  onRetry: (message: ChatMessage) => void;
  onEditMessage?: (message: ChatMessage) => void;
  onSwitchToAssistAndDiagnose?: () => void;
  conversationFiles?: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
  onMessageFeedbackChange?: (messageId: string, feedback: "like" | "dislike" | null) => void;
};

export function ChatMessagesPanel({
  scrollContainerRef,
  messagesEndRef,
  selectedId,
  isChatReady,
  selectedInstance,
  selectedReadiness,
  instances,
  loadingInstances,
  loadingMessages,
  messages,
  nextCursorSeq,
  loadingMoreMessages,
  selectedConversationId,
  currentUser,
  sending,
  activeRunId,
  toolSteps,
  runExecutionState,
  runMetrics,
  approvalRequests = [],
  canRespondToApproval = false,
  onRespondToApproval,
  error,
  onGoToInstanceManage,
  onUsePrompt,
  onLoadMoreMessages,
  onRetry,
  onEditMessage,
  onSwitchToAssistAndDiagnose,
  conversationFiles = [],
  onOpenConversationFile,
  onOpenInstanceFilePath,
  onMessageFeedbackChange
}: ChatMessagesPanelProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const agentDisplayName = selectedInstance?.name?.trim() || t("dashboard:chatWorkspace.agentFallbackName");
  const fallbackModelLabel = selectedInstance?.model_name?.trim() || selectedInstance?.configSummary?.model?.trim() || "";
  const hasRunningTool = toolSteps.some((step) => step.status === "running");
  const hasSettledTool = toolSteps.some((step) => step.status === "completed" || step.status === "failed");
  const activityLabel = hasRunningTool
    ? t("dashboard:chatWorkspace.agentOperating", { name: agentDisplayName })
    : hasSettledTool
      ? t("dashboard:chatWorkspace.agentFinalizing", { name: agentDisplayName })
      : activeRunId
        ? t("dashboard:chatWorkspace.agentRunning", { name: agentDisplayName })
        : t("dashboard:chatWorkspace.agentThinking", { name: agentDisplayName });
  const shouldShowBlockingHistoryLoader = loadingMessages && messages.length === 0;
  const runAssistantIndex = runExecutionState ? findRunAssistantMessageIndex(messages, runExecutionState) : -1;
  const detachedRunMessage: ChatMessage | null = runExecutionState && runAssistantIndex < 0 ? {
    id: `detached-run-${runExecutionState.runId}`,
    role: "assistant",
    content: deriveRunAssistantText(runExecutionState),
    status: runExecutionState.status === "completed"
      ? "completed"
      : runExecutionState.status === "failed"
        ? "failed"
        : ["cancelled", "stopped", "expired"].includes(runExecutionState.status)
          ? "stopped"
          : "pending",
    conversation_id: runExecutionState.conversationId || selectedConversationId,
    request_id: runExecutionState.requestId || null,
    metadata: { runId: runExecutionState.runId, requestId: runExecutionState.requestId }
  } : null;
  const inlineApproval = runExecutionState ? selectInlineApproval(approvalRequests) : null;
  const runAssistantHasContent = runAssistantIndex >= 0 && Boolean(messages[runAssistantIndex]?.content.trim());
  const shouldShowLegacyLoading = shouldShowLegacyRunLoading(sending, runExecutionState) && !runAssistantHasContent;

  return (
    <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.06),_transparent_34%),linear-gradient(180deg,_rgba(248,250,252,0.92),_#ffffff_42%)] text-content p-3 sm:p-5 space-y-4 sm:space-y-5 dark:bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.12),_transparent_34%),linear-gradient(180deg,_rgba(15,23,42,0.98),_#020617_55%)]">
      <ChatReadinessBanner
        selectedId={selectedId}
        isChatReady={isChatReady}
        selectedInstance={selectedInstance}
        selectedReadiness={selectedReadiness}
      />

      {instances.length === 0 && !loadingInstances ? (
        <ChatNoInstancesEmptyState onGoToInstanceManage={onGoToInstanceManage} />
      ) : shouldShowBlockingHistoryLoader ? (
        <ChatMessagesLoadingState />
      ) : messages.length === 0 && !detachedRunMessage ? (
        <ChatWelcomeEmptyState selectedInstance={selectedInstance} loadingInstances={loadingInstances} onUsePrompt={onUsePrompt} />
      ) : (
        <div className="space-y-4 max-w-4xl mx-auto">
          {nextCursorSeq !== null && (
            <div className="flex justify-center my-4">
              <button
                type="button"
                onClick={onLoadMoreMessages}
                disabled={loadingMoreMessages}
                className="text-[13px] text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 font-medium disabled:opacity-50 cursor-pointer border border-indigo-150 shadow-xs dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15 dark:text-indigo-300 dark:hover:text-indigo-200 dark:border-indigo-400/20"
              >
                {loadingMoreMessages ? t("dashboard:chatWorkspace.loadingMore") : t("dashboard:chatWorkspace.loadEarlierMessages")}
              </button>
            </div>
          )}

          {messages.map((msg, messageIndex) => (
            <ChatMessageBubble
              key={msg.id || `${selectedConversationId}-${msg.sequence_no}`}
              message={msg}
              currentUser={currentUser}
              retrySourceMessage={msg.role === "assistant" ? findRetrySourceMessage(messages, messageIndex) : undefined}
              selectedConversationId={selectedConversationId}
              sending={sending}
              onRetry={onRetry}
              onEdit={onEditMessage}
              onSwitchToAssistAndDiagnose={onSwitchToAssistAndDiagnose}
              conversationFiles={conversationFiles}
              onOpenConversationFile={onOpenConversationFile}
              onOpenInstanceFilePath={onOpenInstanceFilePath}
              fallbackModelLabel={fallbackModelLabel}
              instanceId={selectedId}
              onMessageFeedbackChange={onMessageFeedbackChange}
              runExecutionState={msg.role === "assistant" && messageIndex === runAssistantIndex ? runExecutionState : null}
              runMetrics={runMetrics}
              approvalRequest={msg.role === "assistant" && messageIndex === runAssistantIndex ? inlineApproval : null}
              canRespondToApproval={canRespondToApproval}
              onRespondToApproval={onRespondToApproval}
            />
          ))}

          {detachedRunMessage && (
            <ChatMessageBubble
              message={detachedRunMessage}
              currentUser={currentUser}
              selectedConversationId={selectedConversationId}
              sending={sending}
              onRetry={onRetry}
              conversationFiles={conversationFiles}
              onOpenConversationFile={onOpenConversationFile}
              onOpenInstanceFilePath={onOpenInstanceFilePath}
              fallbackModelLabel={fallbackModelLabel}
              instanceId={selectedId}
              runExecutionState={runExecutionState}
              runMetrics={runMetrics}
              approvalRequest={inlineApproval}
              canRespondToApproval={canRespondToApproval}
              onRespondToApproval={onRespondToApproval}
            />
          )}

          {shouldShowLegacyLoading && (
            <div className="flex gap-3.5 justify-start animate-pulse">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/30">
                <LoaderCircle className="w-4 h-4 animate-spin" />
              </div>
              <div className="bg-surface/95 border border-outline/80 rounded-2xl rounded-tl-md px-4 py-3 text-[14px] leading-6 flex items-center gap-2 text-content-muted shadow-xs">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce dark:bg-slate-500" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce dark:bg-slate-500" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce dark:bg-slate-500" style={{ animationDelay: "300ms" }} />
                </div>
                <span>{activityLabel}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex gap-3.5 justify-center max-w-lg mx-auto">
              <div className="bg-red-50 border border-red-200/60 text-red-700 rounded-xl p-3.5 text-[13px] flex items-start gap-2.5 shadow-sm dark:bg-rose-950/35 dark:border-rose-500/30 dark:text-rose-200">
                <AlertCircle className="w-4.5 h-4.5 text-red-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-800 dark:text-rose-100">{t("dashboard:chatWorkspace.errorTitle")}</p>
                  <p className="text-red-600/95 leading-relaxed dark:text-rose-200/90">{error}</p>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}




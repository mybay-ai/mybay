import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowDown, LoaderCircle } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { centerChatMessage } from "./chatAutoFollow";
import { findRetrySourceMessage } from "./run/retrySelectors";
import type { AgentInstance, User as UserType } from "../../types";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ChatAgentAvatar } from "./ChatAgentAvatar";
import { ChatNoInstancesEmptyState, ChatMessagesLoadingState, ChatWelcomeEmptyState } from "./ChatEmptyStates";
import { ChatReadinessBanner } from "./ChatReadinessBanner";
import type { ChatToolStep } from "./ChatToolProgress";
import type { ChatApprovalChoice, ChatApprovalRequest, ChatRunMetrics } from "./useChatRuns";
import type { PendingAttachment } from "./ChatInputBar";
import type { RunExecutionState } from "./run/runTypes";
import { deriveRunAssistantText, findRunAssistantMessageIndex, shouldShowLegacyRunLoading } from "./run/runSelectors";
import { selectInlineApproval } from "./run/approvalSelectors";
import { getRunStatusI18nKey, resolveRunDisplayStatus } from "./run/runStatusSemantics";
import type { GeneratedArtifact } from "./generatedArtifacts";
import type { InstanceChatReadinessProbe } from "../../hooks/useLocalInstanceReadiness";

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
  onReadinessChecked?: (probe: InstanceChatReadinessProbe) => void;
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
  onDownloadInstanceFilePath?: (filePath: string) => void;
  generatedArtifacts?: GeneratedArtifact[];
  onMessageFeedbackChange?: (messageId: string, feedback: "like" | "dislike" | null) => void;
  highlightedMessageId?: string | null;
  highlightedMessageRevision?: number;
  showJumpToLatest?: boolean;
  onJumpToLatest?: () => void;
  onRevealMessage?: (message: HTMLElement) => void;
};

export function ChatMessagesPanel({
  scrollContainerRef,
  messagesEndRef,
  selectedId,
  isChatReady,
  selectedInstance,
  selectedReadiness,
  onReadinessChecked,
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
  runExecutionState: incomingExecution,
  runMetrics,
  approvalRequests = [],
  canRespondToApproval = false,
  onRespondToApproval,
  error,
  onGoToInstanceManage,
  onUsePrompt,
  onLoadMoreMessages,
  highlightedMessageId,
  highlightedMessageRevision,
  showJumpToLatest = false,
  onJumpToLatest,
  onRevealMessage,
  onRetry,
  onEditMessage,
  onSwitchToAssistAndDiagnose,
  conversationFiles = [],
  onOpenConversationFile,
  onOpenInstanceFilePath,
  onDownloadInstanceFilePath,
  generatedArtifacts = [],
  onMessageFeedbackChange
}: ChatMessagesPanelProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const runExecutionState = incomingExecution?.conversationId === selectedConversationId ? incomingExecution : null;
  const agentDisplayName = selectedInstance?.name?.trim() || t("dashboard:chatWorkspace.agentFallbackName");
  const fallbackModelLabel = selectedInstance?.model_name?.trim() || selectedInstance?.configSummary?.model?.trim() || "";
  const runDisplayStatus = resolveRunDisplayStatus({
    activeRunId,
    executionRunId: runExecutionState?.runId,
    executionStatus: runExecutionState?.status,
    metricRunId: runMetrics?.runId,
    metricStatus: runMetrics?.status,
    hasPendingApproval: approvalRequests.some(request => request.status === "pending"),
    hasRunningTool: toolSteps.some(step => step.status === "running")
  });
  const activityLabel = t(`dashboard:chatWorkspace.${getRunStatusI18nKey(runDisplayStatus)}`, { name: agentDisplayName });
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
  const lastRevealed = useRef<string | null>(null);

  useEffect(() => {
    if (!highlightedMessageId) { lastRevealed.current = null; return; }
    const revealKey = JSON.stringify([selectedId, selectedConversationId, highlightedMessageId, highlightedMessageRevision]);
    if (lastRevealed.current === revealKey) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(highlightedMessageId) : highlightedMessageId.replace(/["\\]/g, "\\$&");
    const target = container.querySelector<HTMLElement>(`[data-chat-message-id="${escapedId}"]`);
    if (target) {
      if (onRevealMessage) onRevealMessage(target);
      else centerChatMessage(container, target);
      lastRevealed.current = revealKey;
    }
  }, [highlightedMessageId, highlightedMessageRevision, selectedId, selectedConversationId, messages, scrollContainerRef, onRevealMessage]);

  return (
    <div className="relative flex-1 min-h-0">
    <div ref={scrollContainerRef} role="region" aria-label={t("dashboard:chatWorkspace.messageHistoryRegion")} tabIndex={0} className="h-full min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none] focus-visible:outline-indigo-500 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.06),_transparent_34%),linear-gradient(180deg,_rgba(248,250,252,0.92),_#ffffff_42%)] text-content dark:bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.12),_transparent_34%),linear-gradient(180deg,_rgba(15,23,42,0.98),_#020617_55%)]">
    <div className="p-3 sm:p-5 space-y-4 sm:space-y-5">
      <ChatReadinessBanner
        selectedId={selectedId}
        isChatReady={isChatReady}
        selectedInstance={selectedInstance}
        selectedReadiness={selectedReadiness}
        onReadinessChecked={onReadinessChecked}
        onOpenDiagnostics={onGoToInstanceManage}
      />

      {instances.length === 0 && !loadingInstances ? (
        <ChatNoInstancesEmptyState onGoToInstanceManage={onGoToInstanceManage} />
      ) : shouldShowBlockingHistoryLoader ? (
        <ChatMessagesLoadingState />
      ) : messages.length === 0 && !detachedRunMessage ? (
        <ChatWelcomeEmptyState selectedInstance={selectedInstance} loadingInstances={loadingInstances} onUsePrompt={onUsePrompt} />
      ) : (
        <div className="mx-auto w-full max-w-5xl space-y-4 2xl:max-w-6xl">
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
            <div
              key={msg.id || `${selectedConversationId}-${msg.sequence_no}`}
              data-chat-message-id={msg.id}
              className={highlightedMessageId === msg.id ? "rounded-2xl ring-2 ring-indigo-400 ring-offset-4 ring-offset-white transition dark:ring-indigo-400 dark:ring-offset-slate-950" : undefined}
            >
            <ChatMessageBubble
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
              onDownloadInstanceFilePath={onDownloadInstanceFilePath}
              generatedArtifacts={generatedArtifacts}
              fallbackModelLabel={fallbackModelLabel}
              agentInstance={selectedInstance}
              instanceId={selectedId}
              onMessageFeedbackChange={onMessageFeedbackChange}
              runExecutionState={msg.role === "assistant" && messageIndex === runAssistantIndex ? runExecutionState : null}
              runMetrics={msg.role === "assistant" && messageIndex === runAssistantIndex ? runMetrics : null}
              approvalRequest={msg.role === "assistant" && messageIndex === runAssistantIndex ? inlineApproval : null}
              canRespondToApproval={canRespondToApproval}
              onRespondToApproval={onRespondToApproval}
            />
            </div>
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
              onDownloadInstanceFilePath={onDownloadInstanceFilePath}
              generatedArtifacts={generatedArtifacts}
              fallbackModelLabel={fallbackModelLabel}
              agentInstance={selectedInstance}
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
              <div className="relative h-8 w-8 shrink-0">
                <ChatAgentAvatar instance={selectedInstance} />
                <LoaderCircle className="absolute -bottom-1 -right-1 h-3.5 w-3.5 animate-spin rounded-full bg-surface p-0.5 text-indigo-600" />
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

        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
    </div>
    {showJumpToLatest && onJumpToLatest && (
      <button type="button" onClick={onJumpToLatest} aria-label={t("dashboard:chatWorkspace.jumpToLatest")}
        className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-outline bg-surface px-3 py-2 text-xs font-medium text-content shadow-lg hover:bg-surface-muted focus-visible:outline-indigo-500">
        <ArrowDown className="h-4 w-4" />{t("dashboard:chatWorkspace.jumpToLatest")}
      </button>
    )}
    </div>
  );
}




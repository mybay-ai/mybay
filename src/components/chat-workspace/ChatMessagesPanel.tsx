import { useTranslation } from "react-i18next";
import { ArrowDown } from "lucide-react";
import type { RefObject } from "react";
import type { AgentInstance, User as UserType } from "../../types";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { ChatReadinessBanner } from "./ChatReadinessBanner";
import type { ChatToolStep } from "./ChatToolProgress";
import type { ChatApprovalChoice, ChatApprovalRequest, ChatRunMetrics } from "./useChatRuns";
import type { PendingAttachment } from "./ChatInputBar";
import type { RunExecutionState } from "./run/runTypes";
import { deriveChatMessagesRunPresentation } from "./run/chatMessagesRunPresentation";
import type { GeneratedArtifact } from "./generatedArtifacts";
import type { InstanceChatReadinessProbe } from "../../hooks/useLocalInstanceReadiness";
import type { GroupRunActivity, GroupRunMissingMember } from "./ChatGroupRunSummary";
import type { ChatMessageListProps } from "./ChatMessageList";
import { ChatMessagesPanelBody } from "./ChatMessagesPanelBody";
import { useChatMessageHighlightReveal } from "./useChatMessageHighlightReveal";

const EMPTY_CONVERSATION_FILES: PendingAttachment[] = [];
const EMPTY_GENERATED_ARTIFACTS: GeneratedArtifact[] = [];

type ReadinessState = {
  ready: boolean;
  reason?: string;
  message?: string;
};

export type ChatMessagesPanelViewport = {
  scrollContainerRef: RefObject<HTMLDivElement>;
  messagesEndRef: RefObject<HTMLDivElement>;
  highlightedMessageId?: string | null;
  highlightedMessageRevision?: number;
  showJumpToLatest?: boolean;
  onJumpToLatest?: () => void;
  onRevealMessage?: (message: HTMLElement) => void;
};

export type ChatMessagesPanelInstance = {
  selectedId: string;
  isChatReady: boolean;
  selectedInstance?: AgentInstance;
  selectedReadiness?: ReadinessState;
  onReadinessChecked?: (probe: InstanceChatReadinessProbe) => void;
  instances: AgentInstance[];
  loadingInstances: boolean;
};

export type ChatMessagesPanelHistory = {
  loadingMessages: boolean;
  messages: ChatMessage[];
  nextCursorSeq: number | null;
  loadingMoreMessages: boolean;
  selectedConversationId: string | null;
  currentUser?: UserType | null;
  error: string | null;
};

export type ChatMessagesPanelRun = {
  sending: boolean;
  activeRunId: string | null;
  toolSteps: ChatToolStep[];
  runExecutionState?: RunExecutionState | null;
  runMetrics?: ChatRunMetrics | null;
  approvalRequests?: ChatApprovalRequest[];
  canRespondToApproval?: boolean;
  onRespondToApproval?: (choice: ChatApprovalChoice, approvalId?: string, resolveAll?: boolean) => void | Promise<void>;
};

export type ChatMessagesPanelActions = {
  onGoToInstanceManage: () => void;
  onUsePrompt: (prompt: string) => void;
  onLoadMoreMessages: () => void;
  onRetry: (message: ChatMessage) => void;
  onEditMessage?: (message: ChatMessage) => void;
  onSwitchToAssistAndDiagnose?: () => void;
  onReconnectCodexOAuth?: () => void;
  reconnectingCodexOAuth?: boolean;
  onMessageFeedbackChange?: (messageId: string, feedback: "like" | "dislike" | null) => void;
  onPrepareGroupRecovery?: (activity: GroupRunActivity) => void;
  onPrepareMissingGroupMember?: (member: GroupRunMissingMember) => void;
};

export type ChatMessagesPanelResources = {
  conversationFiles?: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
  onDownloadInstanceFilePath?: (filePath: string) => void;
  generatedArtifacts?: GeneratedArtifact[];
  onRefreshGeneratedArtifacts?: () => void;
};

export type ChatMessagesPanelProps = {
  viewport: ChatMessagesPanelViewport;
  instance: ChatMessagesPanelInstance;
  history: ChatMessagesPanelHistory;
  run: ChatMessagesPanelRun;
  resources?: ChatMessagesPanelResources;
  actions: ChatMessagesPanelActions;
};

export function ChatMessagesPanel({ viewport, instance, history, run, resources = {}, actions }: ChatMessagesPanelProps) {
  const {
  scrollContainerRef,
  messagesEndRef,
  highlightedMessageId,
  highlightedMessageRevision,
  showJumpToLatest = false,
  onJumpToLatest,
  onRevealMessage
  } = viewport;
  const {
  selectedId,
  isChatReady,
  selectedInstance,
  selectedReadiness,
  onReadinessChecked,
  instances,
  loadingInstances
  } = instance;
  const {
  loadingMessages,
  messages,
  nextCursorSeq,
  loadingMoreMessages,
  selectedConversationId,
  currentUser,
  error
  } = history;
  const {
  sending,
  activeRunId,
  toolSteps,
  runExecutionState: incomingExecution,
  runMetrics,
  approvalRequests = [],
  canRespondToApproval = false,
  onRespondToApproval
  } = run;
  const {
  conversationFiles = EMPTY_CONVERSATION_FILES,
  onOpenConversationFile,
  onOpenInstanceFilePath,
  onDownloadInstanceFilePath,
  generatedArtifacts = EMPTY_GENERATED_ARTIFACTS,
  onRefreshGeneratedArtifacts
  } = resources;
  const {
  onGoToInstanceManage,
  onUsePrompt,
  onLoadMoreMessages,
  onRetry,
  onEditMessage,
  onSwitchToAssistAndDiagnose,
  onReconnectCodexOAuth,
  reconnectingCodexOAuth,
  onMessageFeedbackChange,
  onPrepareGroupRecovery,
  onPrepareMissingGroupMember
  } = actions;
  const { t } = useTranslation(["dashboard", "common"]);
  const agentDisplayName = selectedInstance?.name?.trim() || t("dashboard:chatWorkspace.agentFallbackName");
  const fallbackModelLabel = selectedInstance?.model_name?.trim() || selectedInstance?.configSummary?.model?.trim() || "";
  const {
    runExecutionState,
    runStatusI18nKey,
    runAssistantIndex,
    detachedRunMessage,
    inlineApproval,
    shouldShowLegacyLoading
  } = deriveChatMessagesRunPresentation({
    selectedConversationId,
    messages,
    sending,
    activeRunId,
    toolSteps,
    incomingExecution,
    runMetrics,
    approvalRequests
  });
  const activityLabel = t(`dashboard:chatWorkspace.${runStatusI18nKey}`, { name: agentDisplayName });
  const messageListProps: ChatMessageListProps = {
    messages,
    highlightedMessageId,
    context: {
      selectedConversationId,
      currentUser,
      selectedInstance,
      instanceId: selectedId,
      sending,
      activeRunId,
      fallbackModelLabel
    },
    run: {
      assistantIndex: runAssistantIndex,
      detachedMessage: detachedRunMessage,
      executionState: runExecutionState,
      metrics: runMetrics,
      approval: inlineApproval,
      canRespondToApproval,
      onRespondToApproval
    },
    resources: {
      conversationFiles,
      generatedArtifacts,
      onOpenConversationFile,
      onOpenInstanceFilePath,
      onDownloadInstanceFilePath,
      onRefreshGeneratedArtifacts
    },
    actions: {
      onRetry,
      onEditMessage,
      onSwitchToAssistAndDiagnose,
      onReconnectCodexOAuth,
      reconnectingCodexOAuth,
      onMessageFeedbackChange,
      onPrepareGroupRecovery,
      onPrepareMissingGroupMember
    }
  };
  useChatMessageHighlightReveal({
    scrollContainerRef,
    selectedId,
    selectedConversationId,
    highlightedMessageId,
    highlightedMessageRevision,
    messages,
    onRevealMessage
  });

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

      <ChatMessagesPanelBody
        hasInstances={instances.length > 0}
        loadingInstances={loadingInstances}
        loadingMessages={loadingMessages}
        selectedInstance={selectedInstance}
        onGoToInstanceManage={onGoToInstanceManage}
        onUsePrompt={onUsePrompt}
        nextCursorSeq={nextCursorSeq}
        loadingMoreMessages={loadingMoreMessages}
        onLoadMoreMessages={onLoadMoreMessages}
        messageListProps={messageListProps}
        shouldShowLegacyLoading={shouldShowLegacyLoading}
        activityLabel={activityLabel}
        error={error}
      />
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




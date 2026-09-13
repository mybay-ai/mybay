import { useChatHistoryPagination } from "./chat-workspace/useChatHistoryPagination";
import { useChatRealtimeSync } from "./chat-workspace/useChatRealtimeSync";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Socket } from "socket.io-client";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { humanizeChatError } from "../lib/chatRuntimeErrors";
import type { AgentInstance, User as UserType } from "../types";
import { APP_ROUTES } from "../constants/routes";
import { useNavigate } from "react-router-dom";
import { useFeedback } from "./FeedbackProvider";
import { ChatConversationSidebar } from "./chat-workspace/ChatConversationSidebar";
import { ChatInputBar, type ChatReasoningEffort, type PendingAttachment } from "./chat-workspace/ChatInputBar";
import { useChatComposerDraft } from "./chat-workspace/useChatComposerDraft";
import type { ChatHistoryNavigation } from "./chat-workspace/chatHistoryNavigation";
import { ChatMessagesPanel, type ChatMessagesPanelProps } from "./chat-workspace/ChatMessagesPanel";
import { ChatSettingsPanel } from "./chat-workspace/ChatSettingsPanel";
import { useChatRuns } from "./chat-workspace/useChatRuns";
import { ChatWorkspaceHeader } from "./chat-workspace/ChatWorkspaceHeader";
import { ChatWorkspacePanel, type WorkspaceTab } from "./chat-workspace/ChatWorkspacePanel";
import { useChatWorkspaceFiles } from "./chat-workspace/useChatWorkspaceFiles";
import { useChatConversations } from "./chat-workspace/useChatConversations";
import { useChatMessageHistory } from "./chat-workspace/useChatMessageHistory";
import { resolveSelectedWorkspaceRunContext } from "./chat-workspace/run/workspaceRunContext";
import { useGeneratedArtifacts } from "./chat-workspace/useGeneratedArtifacts";
import { useChatWorkspaceViewport } from "./chat-workspace/useChatWorkspaceViewport";
import { useQueuedChatFollowUps } from "./chat-workspace/useQueuedChatFollowUps";
import { createChatCancellationController } from "./chat-workspace/chatCancellationController";
import { createChatRunWithRetry, waitForRunRelease } from "./chat-workspace/chatRunTransport";
import { MAX_CHAT_USER_MESSAGE_CHARS, countChatMessageCharacters } from "../../shared/chatMessageContract";
import { unavailableChatReadiness } from "./chat-workspace/chatReadinessState";

import {
  ChatMessage,
  OptimisticChatContext,
  shouldAcceptChatResponse,
  shouldAcceptConversationHistory
} from "../lib/chatWorkspaceState";
import { createChatWorkspaceMessageSender } from "./ChatWorkspaceMessageSender";
import { useChatInstanceLifecycle } from "./chat-workspace/useChatInstanceLifecycle";
import { createChatSelectionPersistence } from "./chat-workspace/chatSelectionPersistence";
import { createChatModePreference } from "./chat-workspace/chatModePreference";
import { createChatWorkspaceMessageActions } from "./chat-workspace/createChatWorkspaceMessageActions";
import { useChatInstanceReadiness } from "./chat-workspace/useChatInstanceReadiness";
import { createChatWorkspaceSelectionActions } from "./chat-workspace/createChatWorkspaceSelectionActions";
import { useChatSelectionReset } from "./chat-workspace/useChatSelectionReset";
import { useA2ARecoveryDraft } from "./chat-workspace/useA2ARecoveryDraft";
import { useGeneratedPreviewRestoration } from "./chat-workspace/useGeneratedPreviewRestoration";
import { useChatHistoryViewport } from "./chat-workspace/useChatHistoryViewport";
import { createResponsiveWorkspaceFileActions } from "./chat-workspace/createResponsiveWorkspaceFileActions";
import { useChatMobileWorkspace } from "./chat-workspace/useChatMobileWorkspace";
import { createChatComposerCommandActions } from "./chat-workspace/createChatComposerCommandActions";
import { ChatMobileWorkspaceDialog, type ChatWorkspacePanelSharedProps } from "./chat-workspace/ChatMobileWorkspaceDialog";
import { createChatComposerInteractionActions } from "./chat-workspace/createChatComposerInteractionActions";
import { createChatWorkspaceNavigationActions } from "./chat-workspace/createChatWorkspaceNavigationActions";
import { ChatWorkspaceDropOverlay } from "./chat-workspace/ChatWorkspaceDropOverlay";
import { selectConversationContextUsage } from "./chat-workspace/conversationContextUsage";
import { ChatWorkspaceRecoveryDraftNotice } from "./chat-workspace/ChatWorkspaceRecoveryDraftNotice";
import { ChatWorkspaceFloatingControls } from "./chat-workspace/ChatWorkspaceFloatingControls";

export { generateUUIDv4 } from "./chat-workspace/chatWorkspaceSendPolicy";
export { selectConversationContextUsage } from "./chat-workspace/conversationContextUsage";

export function ChatWorkspace({ currentUser, socket }: { currentUser?: UserType | null; socket?: Socket | null }) {
  const { t } = useTranslation(["dashboard", "common"]);
  const navigate = useNavigate();
  const { showConfirm, showToast } = useFeedback();
  const selectionPersistence = useMemo(() => createChatSelectionPersistence(
    () => typeof window === "undefined" ? null : window.localStorage, currentUser?.id,
  ), [currentUser?.id]);
  const modePreference = useMemo(() => createChatModePreference(
    () => typeof window === "undefined" ? null : window.localStorage, currentUser?.id,
  ), [currentUser?.id]);
  const preferredInstanceId = useMemo(
    () => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("instanceId") || "",
    [],
  );
  
  // States
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const composer = useChatComposerDraft();
  const { input, replaceInput: setInput } = composer;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Conversation Selection State
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchNavigation, setSearchNavigation] = useState<ChatHistoryNavigation | null>(null);
  const [activeRunConversationId, setActiveRunConversationId] = useState<string | null>(null);

  // Message Pagination State
  const [nextCursorSeq, setNextCursorSeq] = useState<number | null>(null);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  
  // UI States
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const {
    mobileOverlay,
    mobileSidebarOpen,
    mobileWorkspaceOpen,
    mobileWorkspaceTab,
    openMobileHistory,
    openMobileWorkspace,
    closeMobileOverlay,
    closeMobileOverlayAndResetWorkspace,
    selectMobileWorkspaceTab,
    revealMobileWorkspaceTabOnNarrowViewport,
  } = useChatMobileWorkspace();
  const [temperature, setTemperature] = useState<number>(0.7);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>("balanced");
  const [chatMode, setChatMode] = useState<"quick" | "assist" | "agent">("quick");
  const [selectedSkillId, setSelectedSkillId] = useState<string>("model_config_diagnosis");
  const [desktopWorkspaceTab, setDesktopWorkspaceTab] = useState<WorkspaceTab>("result");

  // Refs
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageLoadRequestIdRef = useRef<number>(0);
  const historyAbortRef = useRef<AbortController | null>(null);
  const selectionRevisionRef = useRef(0);
  const activeChatRequestIdRef = useRef<string | null>(null);
  const shouldScrollToBottomRef = useRef<boolean>(true);
  
  const instanceGenerationRef = useRef(0);
  const messageGenerationRef = useRef(0);
  const activeChatGenerationRef = useRef(0);
  const internallySelectingConversationRef = useRef(false);
  const optimisticChatContextRef = useRef<OptimisticChatContext | null>(null);
  const activeSyncChatRequestRef = useRef<{ controller: AbortController; requestId: string; instanceId: string; conversationId: string | null } | null>(null);
  const syncCancelReconciliationTimersRef = useRef<number[]>([]);
  const editingRetryMessageIdRef = useRef<string | null>(null);

  const selectedIdRef = useRef(selectedId);
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);
  const refreshAuthoritativeHistoryRef = useRef<(instanceId: string, convId: string) => Promise<void>>(async () => {});
  const mobileWorkspaceFrame = useChatWorkspaceViewport({
    workspaceRootRef,
    mobileOverlay,
    closeMobileOverlay,
  });

  const {
    chatReadiness,
    setChatReadiness,
    selectedReadiness,
    selectedInstance,
    isChatReady,
    hasAnyReady,
    groupedInstances,
    getInstanceDropdownLabel,
    handleReadinessChecked,
    isCodexAccountInstance,
    reconnectingCodexOAuth,
    handleReconnectCodexOAuth,
  } = useChatInstanceReadiness({
    instances,
    selectedId,
    selectedIdRef,
    setInstances,
    showToast,
    t,
  });

  const {
    recoveryDraftRef: a2aRecoveryDraftRef,
    prepareGroupRecovery,
    prepareMissingGroupMember,
  } = useA2ARecoveryDraft({ selectedId, setInput, setChatMode, modePreference, showToast });

  const {
    attachmentConfig,
    attachmentLimitReached,
    remainingAttachmentSlots,
    pendingAttachments,
    setPendingAttachments,
    conversationFiles,
    setConversationFiles,
    conversationFilePreview,
    clearConversationFilePreview,
    isUploading,
    attachmentUploads,
    isDraggingOver,
    uploadInFlightRef,
    refreshConversationFiles,
    handleUploadFiles,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleRemoveAttachment,
    handleOpenInstanceFilePath,
    handleDownloadInstanceFilePath,
    handleDownloadConversationFile,
    handleOpenConversationFile,
    handlePreviewConversationFile,
    handleDeleteConversationFile
  } = useChatWorkspaceFiles({
    selectedId,
    selectedConversationId,
    isChatReady: chatReadiness[selectedId]?.ready || false,
    chatMode,
    showToast
  });

  const {
    handleOpenInstanceFileFromChat,
    handleOpenConversationFileFromChat,
    handlePreviewConversationFileFromWorkspace,
  } = createResponsiveWorkspaceFileActions({
    handleOpenInstanceFilePath,
    handleOpenConversationFile,
    handlePreviewConversationFile,
    revealMobileWorkspacePreview: () => revealMobileWorkspaceTabOnNarrowViewport("preview"),
  });
  const { selectInstanceId, selectConversationId } = createChatWorkspaceSelectionActions({
    historyAbortRef,
    instanceGenerationRef,
    messageLoadRequestIdRef,
    selectionRevisionRef,
    selectedIdRef,
    selectedConversationIdRef,
    internallySelectingConversationRef,
    setSelectedId,
    setSelectedConversationId,
    setChatMode,
    setSearchNavigation,
    setMessages,
    setNextCursorSeq,
    setLoadingMoreMessages,
    setError,
    modePreference,
    selectionPersistence,
  });

  const {
    conversations,
    conversationProjects,
    setConversations,
    loadingConversations,
    setConversationsCursor,
    loadingMoreConversations,
    renamingId,
    renameValue,
    setRenameValue,
    setRenamingId,
    resetConversationsForInstance,
    loadConversationsForSelectedInstance,
    handleCreateConversation,
    creatingConversation,
    conversationCreationInFlightRef,
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    handleMoveConversationToProject,
    handleDeleteConversation,
    startRename,
    handlePlaceConversation,
    organizingConversations,
    handleMoveConversation,
    handleMoveProject,
    handleTogglePinConversation,
    buildConversationTitleFromMessage,
    maybeRenameDefaultConversation,
    handleRenameSubmit,
    handleConversationsScroll
  } = useChatConversations({
    selectedId,
    selectedIdRef,
    selectedConversationId,
    selectedConversationIdRef,
    selectionRevisionRef,
    getRememberedConversationId: selectionPersistence.conversationFor,
    selectConversationId,
    instanceGenerationRef,
    setMessages,
    setNextCursorSeq,
    setError,
    setPendingAttachments,
    setConversationFiles,
    showConfirm,
    t
  });


  const {
    runsCapabilityState,
    runsSupported,
    activeRunId,
    stopPending,
    runCapabilities,
    approvalRequests,
    runExecutionState,
    runMetrics,
    toolSteps,
    setRunMetrics,
    setActiveRunId,
    setToolSteps,
    initializeRunExecution,
    finalizeActiveRunUi,
    isCurrentRunContext,
    streamActiveRun,
    handleStopRun,
    respondToApproval,
    stopActiveRunStreams,
    resetRunState
  } = useChatRuns({
    selectedId,
    selectedIdRef,
    selectedConversationIdRef,
    setMessages,
    setSending,
    refreshAuthoritativeHistory: async (instanceId, convId) => {
      if (!convId) return;
      await refreshAuthoritativeHistoryRef.current(instanceId, convId);
      setActiveRunConversationId(prev => prev === convId ? null : prev);
    },
    showToast,
    t,
    notificationUserId: String(currentUser?.id || currentUser?.username || ""),
    socket,
  });

  const {
    clearQueuedFollowUps,
    enqueueFollowUpMessage,
    queuedFollowUpSenderRef,
  } = useQueuedChatFollowUps({
    creatingConversation,
    conversationCreationInFlightRef,
    selectedId,
    selectedConversationId,
    selectedIdRef,
    selectedConversationIdRef,
    activeRunId,
    sending,
    isUploading,
    uploadInFlightRef,
    setMessages,
    setError,
    shouldScrollToBottomRef,
    t,
  });

  const { generatedArtifacts, refreshGeneratedArtifacts } = useGeneratedArtifacts({
    selectedId,
    selectedConversationId,
    messages,
    activeRunId,
  });

  useGeneratedPreviewRestoration({
    selectedId,
    selectedConversationId,
    generatedArtifacts,
    conversationFilePreview,
    handleOpenInstanceFilePath,
    clearConversationFilePreview,
  });

  useChatSelectionReset({
    selectedId,
    selectedConversationId,
    activeSyncChatRequestRef,
    syncCancelReconciliationTimersRef,
    instanceGenerationRef,
    messageGenerationRef,
    activeChatGenerationRef,
    activeChatRequestIdRef,
    optimisticChatContextRef,
    messageLoadRequestIdRef,
    internallySelectingConversationRef,
    clearQueuedFollowUps,
    stopActiveRunStreams,
    resetConversationsForInstance,
    resetRunState,
    setMessages,
    setNextCursorSeq,
    setError,
    setLoadingMoreMessages,
    setSending,
    setActiveRunConversationId,
  });

  const {
    selectedHistoryNavigation,
    selectedSearch,
    chatScroll,
    handleJumpToLatest,
    showJumpToLatest,
  } = useChatHistoryViewport({
    scrollContainerRef,
    messagesEndRef,
    shouldScrollToBottomRef,
    selectedId,
    selectedConversationId,
    searchNavigation,
    messages,
    sending,
    loadingMessages,
    messageLoadRequestIdRef,
    setLoadingMoreMessages,
    setLoadingMessages,
    setSearchNavigation,
  });

  useChatInstanceLifecycle({
    userId: currentUser?.id, preferredInstanceId, selectedId, selectedIdRef, instanceGenerationRef,
    getRememberedInstanceId: () => selectionPersistence.read().instanceId,
    selectInstanceId, setInstances, setLoadingInstances, setChatReadiness, setError,
    loadConversationsForSelectedInstance,
  });

  useChatMessageHistory({
    selectedId, selectedConversationId, searchNavigation, selectedIdRef,
    selectedConversationIdRef, messageGenerationRef, messageLoadRequestIdRef, instanceGenerationRef,
    historyAbortRef, optimisticChatContextRef, setMessages, setNextCursorSeq,
    setLoadingMessages, setError, setSending, setActiveRunConversationId,
    setSearchNavigation, selectionPersistence, selectConversationId, loadConversationsForSelectedInstance,
    setActiveRunId, setRunMetrics, initializeRunExecution, streamActiveRun,
    stopActiveRunStreams, resetRunState,
  });

  const { handleLoadMoreMessages } = useChatHistoryPagination({
    selectedId, selectedConversationId, nextCursorSeq, loadingMoreMessages,
    selectedIdRef, selectedConversationIdRef, messageGenerationRef, messageLoadRequestIdRef,
    chatScroll, setLoadingMoreMessages, setMessages, setNextCursorSeq,
    setError,
  });

  const { refreshAuthoritativeHistory } = useChatRealtimeSync({
    socket,
    userId: currentUser?.id,
    selectedIdRef,
    selectedConversationIdRef,
    messageGenerationRef,
    messageLoadRequestIdRef,
    optimisticChatContextRef,
    refreshAuthoritativeHistoryRef,
    refreshConversationFiles,
    setMessages,
    setNextCursorSeq,
    setConversations,
    setConversationsCursor,
    showToast,
    t,
  });

  const handleSend = createChatWorkspaceMessageSender({
    conversationCreationInFlightRef,
    loadingConversations,
    uploadInFlightRef,
    isUploading,
    showToast,
    t,
    pendingAttachments,
    input,
    pendingLongTexts: composer.blocks,
    editingRetryMessageIdRef,
    selectedId,
    setError,
    chatMode,
    runsSupported,
    runsCapabilityState,
    sending,
    activeRunConversationId,
    selectedConversationIdRef,
    setInput,
    enqueueFollowUpMessage,
    setPendingAttachments,
    setMessages,
    shouldScrollToBottomRef,
    selectedConversationId,
    activeRunId,
    waitForRunRelease,
    stopActiveRunStreams,
    resetRunState,
    activeChatGenerationRef,
    activeChatRequestIdRef,
    setSending,
    setToolSteps,
    messageLoadRequestIdRef,
    setLoadingMessages,
    activeSyncChatRequestRef,
    optimisticChatContextRef,
    conversations,
    buildConversationTitleFromMessage,
    selectedIdRef,
    internallySelectingConversationRef,
    setConversations,
    selectConversationId,
    maybeRenameDefaultConversation,
    a2aRecoveryDraftRef,
    createChatRunWithRetry,
    reasoningEffort,
    setActiveRunId,
    setActiveRunConversationId,
    initializeRunExecution,
    setRunMetrics,
    streamActiveRun,
    temperature,
    selectedSkillId,
    refreshAuthoritativeHistory,
  });

  queuedFollowUpSenderRef.current = (content, options) => {
    void handleSend(undefined, content, options);
  };

  const { handleCancelOrStop } = createChatCancellationController({
    activeRunId,
    runExecutionState,
    activeSyncChatRequestRef,
    activeChatGenerationRef,
    activeChatRequestIdRef,
    optimisticChatContextRef,
    syncCancelReconciliationTimersRef,
    selectedIdRef,
    selectedConversationIdRef,
    refreshAuthoritativeHistoryRef,
    setMessages,
    setSending,
    setActiveRunConversationId,
    handleStopRun,
    resumeActiveRunStreams: streamActiveRun,
    waitForRunRelease,
    isCurrentRunContext,
    stopActiveRunStreams,
    finalizeActiveRunUi,
    t,
  });

  const selectedConversation = useMemo(
    () => conversations.find(conversation => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );
  const conversationContextUsage = useMemo(() => selectConversationContextUsage(messages), [messages]);
  const {
    handleSwitchToAssistAndDiagnose,
    handleRetry,
    handleChatModeChange,
    handleCollaborationChange,
    handleEditMessage,
    handleClear,
    handleKeyDown,
    handleMessageFeedbackChange,
  } = createChatWorkspaceMessageActions({
    selectedId,
    selectedConversationId,
    selectedIdRef,
    selectedConversation,
    isChatReady,
    runsSupported,
    conversationFiles,
    editingRetryMessageIdRef,
    modePreference,
    handleSend,
    setMessages,
    setConversations,
    setPendingAttachments,
    setInput,
    setError,
    setChatMode,
    setSelectedSkillId,
    setShowSettings,
    showToast,
    showConfirm,
    t,
  });

  const selectedRunContext = useMemo(() => resolveSelectedWorkspaceRunContext({
    selectedConversationId,
    activeRunConversationId,
    sending,
    activeRunId,
    runExecutionState,
    runMetrics,
    toolSteps,
    approvalRequests,
  }), [activeRunConversationId, activeRunId, approvalRequests, runExecutionState, runMetrics, selectedConversationId, sending, toolSteps]);
  const selectedConversationIsRunning = selectedRunContext.running;
  const selectedActiveRunId = selectedRunContext.activeRunId;
  const selectedRunMetrics = selectedRunContext.metrics;
  const selectedRunExecution = selectedRunContext.execution;
  const selectedToolSteps = selectedRunContext.toolSteps;
  const selectedApprovalRequests = selectedRunContext.approvalRequests;
  const { handleComposerCommand } = createChatComposerCommandActions({
    runtimeType: selectedInstance?.runtime_type,
    handleCreateConversation,
    handleClear,
    handleCancelOrStop,
    setDesktopWorkspaceTab,
    selectMobileWorkspaceTab,
    revealMobileWorkspaceTabOnNarrowViewport,
    closeMobileOverlay,
    setShowSettings,
    showToast,
    t,
  });
  const { handleAddWorkspaceFiles, handleComposerInputFocus } = createChatComposerInteractionActions({
    selectedIdRef,
    selectedConversationIdRef,
    handleUploadFiles,
  });
  const {
    handleOpenMobileHistory,
    handleDeployNewInstance,
    handleInstanceChange,
    handleToggleSettings,
    handleCreateConversationFromSidebar,
    handleSelectConversation,
    handleSelectSearchResult,
    handleOpenSidebar,
    handleOpenMobileWorkspace,
  } = createChatWorkspaceNavigationActions({
    deployRoute: APP_ROUTES.DEPLOY,
    navigate,
    handleCreateConversation,
    selectInstanceId,
    selectConversationId,
    openMobileHistory,
    openMobileWorkspace,
    closeMobileOverlay,
    closeMobileOverlayAndResetWorkspace,
    setShowSettings,
    setSidebarOpen,
    setMessages,
    setError,
    setSearchNavigation,
  });
  const workspacePanelProps: ChatWorkspacePanelSharedProps = {
    selectedId,
    selectedConversationId,
    conversationFiles,
    generatedArtifacts,
    onRefreshGeneratedArtifacts: refreshGeneratedArtifacts,
    onPreviewGeneratedArtifact: handleOpenInstanceFileFromChat,
    onDownloadGeneratedArtifact: handleDownloadInstanceFilePath,
    onDeleteConversationFile: handleDeleteConversationFile,
    onDownloadConversationFile: handleDownloadConversationFile,
    onOpenConversationFile: handleOpenConversationFileFromChat,
    onPreviewConversationFile: handlePreviewConversationFileFromWorkspace,
    conversationFilePreview,
    onClearConversationFilePreview: clearConversationFilePreview,
    selectedInstance,
    messages,
    toolSteps: selectedToolSteps,
    activeRunId: selectedActiveRunId,
    runExecutionState: selectedRunExecution,
    runMetrics: selectedRunMetrics,
    approvalRequests: selectedApprovalRequests,
    runCapabilities,
    onRespondToApproval: respondToApproval,
  };
  const messagesPanelProps: ChatMessagesPanelProps = {
    viewport: {
      scrollContainerRef,
      messagesEndRef,
      showJumpToLatest,
      onJumpToLatest: handleJumpToLatest,
      onRevealMessage: chatScroll.revealMessage,
      highlightedMessageId: selectedSearch?.messageId ?? null,
      highlightedMessageRevision: selectedSearch?.nonce,
    },
    instance: {
      selectedId,
      isChatReady,
      selectedInstance,
      selectedReadiness,
      onReadinessChecked: handleReadinessChecked,
      instances,
      loadingInstances,
    },
    history: {
      loadingMessages,
      messages,
      nextCursorSeq,
      loadingMoreMessages,
      selectedConversationId,
      currentUser,
      error,
    },
    run: {
      sending: selectedConversationIsRunning,
      activeRunId: selectedActiveRunId,
      toolSteps: selectedToolSteps,
      runExecutionState: selectedRunExecution,
      runMetrics: selectedRunMetrics,
      approvalRequests: selectedApprovalRequests,
      canRespondToApproval: runCapabilities.runApprovalResponse,
      onRespondToApproval: respondToApproval,
    },
    resources: {
      conversationFiles,
      onOpenConversationFile: handleOpenConversationFileFromChat,
      onOpenInstanceFilePath: handleOpenInstanceFileFromChat,
      onDownloadInstanceFilePath: handleDownloadInstanceFilePath,
      generatedArtifacts,
      onRefreshGeneratedArtifacts: refreshGeneratedArtifacts,
    },
    actions: {
      onGoToInstanceManage: () => navigate(APP_ROUTES.INSTANCES),
      onUsePrompt: setInput,
      onLoadMoreMessages: handleLoadMoreMessages,
      onRetry: handleRetry,
      onEditMessage: handleEditMessage,
      onSwitchToAssistAndDiagnose: handleSwitchToAssistAndDiagnose,
      onReconnectCodexOAuth: isCodexAccountInstance ? handleReconnectCodexOAuth : undefined,
      reconnectingCodexOAuth,
      onMessageFeedbackChange: handleMessageFeedbackChange,
      onPrepareGroupRecovery: prepareGroupRecovery,
      onPrepareMissingGroupMember: prepareMissingGroupMember,
    },
  };

  return (
    <div
      ref={workspaceRootRef}
      style={mobileWorkspaceFrame ? ({ "--chat-workspace-mobile-top": `${mobileWorkspaceFrame.top}px`, "--chat-workspace-mobile-bottom": `${mobileWorkspaceFrame.bottom}px` } as React.CSSProperties) : undefined}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-muted/70 animate-fade-in max-md:fixed max-md:left-0 max-md:right-0 max-md:top-[var(--chat-workspace-mobile-top,48px)] max-md:bottom-[var(--chat-workspace-mobile-bottom,0px)] max-md:h-auto max-md:z-30"
    >
      {/* Header */}
      <ChatWorkspaceHeader
        mobileSidebarOpen={mobileSidebarOpen}
        loadingInstances={loadingInstances}
        instances={instances}
        selectedId={selectedId}
        selectedInstance={selectedInstance}
        groupedInstances={groupedInstances}
        chatReadiness={chatReadiness}
        showSettings={showSettings}
        hasMessages={messages.length > 0}
        chatMode={chatMode}
        getInstanceDropdownLabel={getInstanceDropdownLabel}
        onOpenMobileSidebar={handleOpenMobileHistory}
        onDeployNewInstance={handleDeployNewInstance}
        onInstanceChange={handleInstanceChange}
        onToggleSettings={handleToggleSettings}
        onClear={handleClear}
      />

      {/* Slide-out Settings panel */}
      {showSettings && selectedId && (
        <ChatSettingsPanel
          temperature={temperature}
          setTemperature={setTemperature}
          reasoningEffort={reasoningEffort}
          setReasoningEffort={setReasoningEffort}
          chatMode={chatMode}
          instanceId={selectedId}
          busy={selectedConversationIsRunning}
          selectedSkillId={selectedSkillId}
          setSelectedSkillId={setSelectedSkillId}
        />
      )}

      {/* Main split layout container (Left Sidebar + Right Messages) */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative bg-surface-muted/60">
        {mobileSidebarOpen && (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-slate-950/45 md:hidden"
            onClick={closeMobileOverlay}
            aria-label={t("dashboard:chatWorkspace.sidebarToggle")}
          />
        )}
        
        {/* Collapsible Left Sidebar (Conversation History Sidebar) */}
        <ChatConversationSidebar
          creatingConversation={creatingConversation}
          mobileSidebarOpen={mobileSidebarOpen}
          sidebarOpen={sidebarOpen}
          selectedId={selectedId}
          loadingConversations={loadingConversations}
          conversations={conversations}
          conversationProjects={conversationProjects}
          selectedConversationId={selectedConversationId}
          renamingId={renamingId}
          renameValue={renameValue}
          loadingMoreConversations={loadingMoreConversations}
          onCreateConversation={handleCreateConversationFromSidebar}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onMoveProject={handleMoveProject}
          onCloseSidebar={() => setSidebarOpen(false)}
          onCloseMobileSidebar={closeMobileOverlay}
          onScroll={handleConversationsScroll}
          onSelectConversation={handleSelectConversation}
          onSelectSearchResult={handleSelectSearchResult}
          setRenameValue={setRenameValue}
          setRenamingId={setRenamingId}
          onRenameSubmit={handleRenameSubmit}
          onStartRename={startRename}
          onPlaceConversation={handlePlaceConversation}
          organizingConversations={organizingConversations}
          onMoveConversation={handleMoveConversation}
          onMoveConversationToProject={handleMoveConversationToProject}
          onTogglePinConversation={handleTogglePinConversation}
          onDeleteConversation={handleDeleteConversation}
        />

        <ChatWorkspaceFloatingControls
          sidebarOpen={sidebarOpen}
          selectedInstanceId={selectedId}
          mobileWorkspaceOpen={mobileWorkspaceOpen}
          expandHistoryLabel={t("dashboard:chatWorkspace.expandHistory")}
          workspaceLabel={t("dashboard:chatWorkspace.workspaceTitle")}
          onOpenSidebar={handleOpenSidebar}
          onOpenMobileWorkspace={handleOpenMobileWorkspace}
        />

        {/* Right Chat panel area */}
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-surface relative"
        >
          {/* Glassmorphic Drag & Drop Overlay */}
          {isDraggingOver && (
            <ChatWorkspaceDropOverlay
              isChatReady={isChatReady}
              hasActiveConversation={Boolean(selectedConversationId)}
              attachmentLimitReached={attachmentLimitReached}
              isUploading={isUploading}
              remainingAttachmentSlots={remainingAttachmentSlots}
            />
          )}

          {/* Main Messages container */}
          <ChatMessagesPanel {...messagesPanelProps} />

          {/* Message input area */}
          <ChatWorkspaceRecoveryDraftNotice
            selectedInstanceId={selectedId}
            input={input}
            blockCount={composer.blocks.length}
            chatMode={chatMode}
            recoveryDraft={a2aRecoveryDraftRef.current}
          />
          {selectedId && (
            <ChatInputBar
              workspaceContext={{ instanceId: selectedId, conversationId: selectedConversationId }}
              onAddWorkspaceFiles={handleAddWorkspaceFiles}
              creatingConversation={creatingConversation}
              loadingConversations={loadingConversations}
              input={input}
              sending={selectedConversationIsRunning}
              activeRunId={selectedActiveRunId}
              stopPending={Boolean(selectedActiveRunId && stopPending)}
              isChatReady={isChatReady}
              hasActiveConversation={Boolean(selectedConversationId)}
              selectedChannel={selectedInstance?.configSummary?.channel || "web"}
              runtimeType={selectedInstance?.runtime_type}
              selectedInstanceName={selectedInstance?.name}
              runMetrics={selectedRunMetrics}
              contextUsage={conversationContextUsage ?? selectedRunMetrics?.usageEvidence ?? null}
              manualCompactionSupported={runCapabilities.features.manual_compaction === true}
              chatMode={chatMode}
              onChatModeChange={handleChatModeChange}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
              agentAvailable={runsSupported}
              agentCapabilityState={runsCapabilityState}
              onInputChange={composer.setInput}
              longTextComposer={composer}
              pendingAttachments={pendingAttachments}
              attachmentUploads={attachmentUploads}
              isUploading={isUploading}
              attachmentConfig={attachmentConfig}
              mobileKeyboardOpen={mobileWorkspaceFrame?.keyboardOpen || false}
              onUpload={handleUploadFiles}
              onRemoveAttachment={handleRemoveAttachment}
              onPreviewAttachment={handlePreviewConversationFileFromWorkspace}

              onSubmit={handleSend}
              onKeyDown={handleKeyDown}
              onStopRun={handleCancelOrStop}
              onComposerCommand={handleComposerCommand}
              collaboration={selectedConversation?.collaboration || null}
              onCollaborationChange={handleCollaborationChange}
              onInputFocus={handleComposerInputFocus}
            />
          )}
        </div>
        <ChatWorkspacePanel
          {...workspacePanelProps}
          activeTab={desktopWorkspaceTab}
          onActiveTabChange={setDesktopWorkspaceTab}
        />

        {mobileWorkspaceOpen && typeof document !== "undefined" && createPortal(
          <ChatMobileWorkspaceDialog
            activeTab={mobileWorkspaceTab}
            onActiveTabChange={selectMobileWorkspaceTab}
            onClose={closeMobileOverlay}
            dialogLabel={t("dashboard:chatWorkspace.workspaceTitle")}
            closeLabel={t("dashboard:files_close_preview_title")}
            panelProps={workspacePanelProps}
          />,
          document.body
        )}
      </div>
    </div>
  );
}

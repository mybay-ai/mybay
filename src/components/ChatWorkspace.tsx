import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Socket } from "socket.io-client";
import { useTranslation } from "react-i18next";
import { ChevronRight, Layers, UploadCloud, X } from "lucide-react";
import { api } from "../lib/api";
import { humanizeChatError } from "../lib/chatRuntimeErrors";
import type { AgentInstance, User as UserType } from "../types";
import { APP_ROUTES } from "../constants/routes";
import { useNavigate } from "react-router-dom";
import { useFeedback } from "./FeedbackProvider";
import { ChatConversationSidebar, type ConversationSearchResult } from "./chat-workspace/ChatConversationSidebar";
import { ChatInputBar, type ChatReasoningEffort, type PendingAttachment } from "./chat-workspace/ChatInputBar";
import { useChatComposerDraft } from "./chat-workspace/useChatComposerDraft";
import { useChatAutoFollow } from "./chat-workspace/useChatAutoFollow";
import { completeLatestHistoryWindow, getHistorySearchQuery, needsLatestHistoryWindow, requestLatestHistoryWindow, type ChatHistoryNavigation } from "./chat-workspace/chatHistoryNavigation";
import { ChatMessagesPanel } from "./chat-workspace/ChatMessagesPanel";
import { ChatSettingsPanel } from "./chat-workspace/ChatSettingsPanel";
import { useChatRuns } from "./chat-workspace/useChatRuns";
import { ChatWorkspaceHeader } from "./chat-workspace/ChatWorkspaceHeader";
import { ChatWorkspacePanel, type WorkspaceTab } from "./chat-workspace/ChatWorkspacePanel";
import { useChatWorkspaceFiles } from "./chat-workspace/useChatWorkspaceFiles";
import { useChatConversations } from "./chat-workspace/useChatConversations";
import { recoverActiveRunMessages } from "./chat-workspace/run/runRecovery";
import { getRetryAttachments } from "./chat-workspace/run/retryAttachments";
import { resolveSelectedWorkspaceRunContext } from "./chat-workspace/run/workspaceRunContext";
import { useGeneratedArtifacts } from "./chat-workspace/useGeneratedArtifacts";
import { getGeneratedArtifactActionPath, isGeneratedArtifactPreviewable } from "./chat-workspace/generatedArtifacts";
import { clearGeneratedPreviewSelection, loadGeneratedPreviewSelection } from "./chat-workspace/previewSelectionStorage";
import { CHAT_WORKSPACE_TABLET_BREAKPOINT, shouldUseOverlayWorkspace } from "./chat-workspace/chatWorkspaceResponsiveLayout";
import { useChatWorkspaceViewport } from "./chat-workspace/useChatWorkspaceViewport";
import { useQueuedChatFollowUps } from "./chat-workspace/useQueuedChatFollowUps";
import { createChatCancellationController } from "./chat-workspace/chatCancellationController";
import { createChatRunWithRetry, waitForRunRelease } from "./chat-workspace/chatRunTransport";
import { MAX_CHAT_USER_MESSAGE_CHARS, countChatMessageCharacters } from "../../shared/chatMessageContract";
import { normalizeStoredMessageError, normalizeStoredMessageStatus } from "./chat-workspace/chatMessagePolicy";
import {
  normalizeChatReadinessProbe,
  unavailableChatReadiness,
  type ChatReadinessState,
} from "./chat-workspace/chatReadinessState";

import {
  ChatMessage,
  OptimisticChatContext,
  deduplicateMessages,
  reconcileConversationMessages,
  shouldAcceptChatResponse,
  shouldAcceptMessageHistory,
  shouldAcceptConversationHistory
} from "../lib/chatWorkspaceState";
import { createChatWorkspaceMessageSender } from "./ChatWorkspaceMessageSender";
import { resolveInitialChatInstanceId } from "./chat-workspace/chatInitialInstanceSelection";
import { createChatSelectionPersistence } from "./chat-workspace/chatSelectionPersistence";
import { createChatModePreference, type PreferredChatMode } from "./chat-workspace/chatModePreference";

export { generateUUIDv4 } from "./chat-workspace/chatWorkspaceSendPolicy";

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
  const [chatReadiness, setChatReadiness] = useState<Record<string, ChatReadinessState>>({});

  
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
  const [mobileOverlay, setMobileOverlay] = useState<"history" | "workspace" | null>(null);
  const mobileSidebarOpen = mobileOverlay === "history";
  const mobileWorkspaceOpen = mobileOverlay === "workspace";
  const [temperature, setTemperature] = useState<number>(0.7);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>("balanced");
  const [chatMode, setChatMode] = useState<"quick" | "assist" | "agent">("quick");
  const [selectedSkillId, setSelectedSkillId] = useState<string>("model_config_diagnosis");
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<WorkspaceTab>("result");

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
    closeMobileOverlay: () => setMobileOverlay(null),
  });

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

  const revealWorkspaceOnNarrowViewport = () => {
    if (typeof window === "undefined" || !shouldUseOverlayWorkspace(window.innerWidth)) return;
    setMobileWorkspaceTab("preview");
    setMobileOverlay("workspace");
  };

  const handleOpenInstanceFileFromChat = async (filePath: string) => {
    await handleOpenInstanceFilePath(filePath);
    revealWorkspaceOnNarrowViewport();
  };

  const handleOpenConversationFileFromChat = async (file: PendingAttachment) => {
    await handleOpenConversationFile(file);
    revealWorkspaceOnNarrowViewport();
  };

  const handlePreviewConversationFileFromWorkspace = async (file: PendingAttachment) => {
    await handlePreviewConversationFile(file);
    revealWorkspaceOnNarrowViewport();
  };
  const selectInstanceId = (id: string) => {
    if (selectedIdRef.current === id) return;
    historyAbortRef.current?.abort();
    instanceGenerationRef.current += 1;
    messageLoadRequestIdRef.current += 1;
    selectionRevisionRef.current += 1;
    selectedIdRef.current = id;
    // Commit an instance/conversation pair atomically, never new instance + old conversation.
    selectedConversationIdRef.current = null;
    setSelectedId(id);
    // Restore synchronously with the Agent selection, before its requests resolve.
    setChatMode(modePreference.modeFor(id));
    setSelectedConversationId(null);
    setSearchNavigation(null);
    setMessages([]);
    setNextCursorSeq(null);
    selectionPersistence.rememberInstance(id);
  };

  const selectConversationId = (id: string | null) => {
    if (selectedConversationIdRef.current !== id) {
      historyAbortRef.current?.abort();
      selectionRevisionRef.current += 1;
      messageLoadRequestIdRef.current += 1;
      if (!internallySelectingConversationRef.current) {
        setMessages([]);
        setNextCursorSeq(null);
        setLoadingMoreMessages(false);
        setError(null);
      }
    }
    selectedConversationIdRef.current = id;
    setSelectedConversationId(id);
    selectionPersistence.rememberConversation(selectedIdRef.current, id);
  };

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
    notificationUserId: String(currentUser?.id || currentUser?.username || "")
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

  useEffect(() => {
    if (!selectedId || !selectedConversationId) return;
    const selectedPath = loadGeneratedPreviewSelection(window.sessionStorage, selectedId, selectedConversationId);
    if (!selectedPath) return;
    const artifact = generatedArtifacts.find(item => item.path === selectedPath);
    if (artifact && isGeneratedArtifactPreviewable(artifact) && !conversationFilePreview) {
      void handleOpenInstanceFilePath(getGeneratedArtifactActionPath(artifact));
      return;
    }
    if (artifact?.status === "missing") {
      clearGeneratedPreviewSelection(window.sessionStorage, selectedId, selectedConversationId);
      if (conversationFilePreview?.source === "instance" && conversationFilePreview.instancePath === artifact.path) {
        clearConversationFilePreview();
      }
    }
  }, [clearConversationFilePreview, conversationFilePreview, generatedArtifacts, handleOpenInstanceFilePath, selectedConversationId, selectedId]);

  // Reset states immediately on selectedId change to prevent cross-instance leaks
  useEffect(() => {
    activeSyncChatRequestRef.current?.controller.abort();
    activeSyncChatRequestRef.current = null;
    syncCancelReconciliationTimersRef.current.splice(0).forEach(timerId => window.clearTimeout(timerId));
    instanceGenerationRef.current += 1;
    messageGenerationRef.current += 1;
    activeChatGenerationRef.current += 1;
    activeChatRequestIdRef.current = null;
    optimisticChatContextRef.current = null;
    clearQueuedFollowUps();
    messageLoadRequestIdRef.current += 1;

    stopActiveRunStreams();

    resetConversationsForInstance();
    setMessages([]);
    setNextCursorSeq(null);
    setError(null);
    setLoadingMoreMessages(false);
    setSending(false);
    resetRunState();
    setActiveRunConversationId(null);
    // The selection setter already cleared the old pair. Do not erase the saved
    // conversation while its authorized replacement list is still loading.
  }, [selectedId]);

  // Reset states immediately on selectedConversationId change
  useEffect(() => {
    if (internallySelectingConversationRef.current) {
      internallySelectingConversationRef.current = false;
      setNextCursorSeq(null);
      setLoadingMoreMessages(false);
      return;
    }

    activeSyncChatRequestRef.current?.controller.abort();
    activeSyncChatRequestRef.current = null;
    syncCancelReconciliationTimersRef.current.splice(0).forEach(timerId => window.clearTimeout(timerId));
    messageGenerationRef.current += 1;
    activeChatGenerationRef.current += 1;
    activeChatRequestIdRef.current = null;
    optimisticChatContextRef.current = null;
    messageLoadRequestIdRef.current += 1;

    stopActiveRunStreams();

    setNextCursorSeq(null);
    setLoadingMoreMessages(false);
    setSending(false);
    resetRunState();
  }, [selectedConversationId]);

  const selectedHistoryNavigation = searchNavigation?.conversationId === selectedConversationId ? searchNavigation : null;
  const selectedSearch = selectedHistoryNavigation?.window === "search" ? selectedHistoryNavigation : null;
  const chatScroll = useChatAutoFollow({
    scrollContainerRef,
    bottomAnchorRef: messagesEndRef,
    forceScrollRef: shouldScrollToBottomRef,
    contextKey: JSON.stringify([selectedId, selectedConversationId, selectedHistoryNavigation?.nonce]),
    startFollowing: !selectedSearch,
    contentRevision: messages,
    layoutRevision: sending,
  });

  const handleJumpToLatest = () => {
    if (needsLatestHistoryWindow(selectedHistoryNavigation)) {
      // Invalidate older pagination/search responses before the next effect runs.
      messageLoadRequestIdRef.current += 1;
      setLoadingMoreMessages(false);
      setLoadingMessages(true);
      setSearchNavigation(previous => requestLatestHistoryWindow(previous, selectedConversationId));
    } else chatScroll.jumpToLatest();
  };

  // Load instances
  useEffect(() => {
    const controller = new AbortController();
    const currentUserScope = currentUser?.id;
    if (!currentUserScope) return;
    selectInstanceId("");
    async function loadInstances() {
      try {
        setLoadingInstances(true);
        const data = await api.get("/api/instances", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (data && Array.isArray(data)) {
          // Filter to only running/ready instances
          const allowedStatuses = ["running", "gateway_ready", "partial_running", "dashboard_ready"];
          const activeList = data.filter((inst: AgentInstance) => {
            const status = String(inst.status || "").toLowerCase();
            const dashboardlessRuntime = inst.configSummary?.enableDashboard === false;
            return allowedStatuses.includes(status)
              || (dashboardlessRuntime && ["failed", "unhealthy"].includes(status));
          });
          setInstances(activeList);
          
          // Parallel lightweight chat readiness probes
          const readinessPromises = activeList.map(async (inst: any) => {
            try {
              const probe = await api.get(`/api/instances/${inst.id}/chat-readiness`, { signal: controller.signal });
              return { id: inst.id, ...normalizeChatReadinessProbe({ ...probe, checkedAt: new Date().toISOString(), probeStatus: "checked" }) };
            } catch (err) {
              return { id: inst.id, ...unavailableChatReadiness("PROBE_FAILED", t("dashboard:chatWorkspace.probeFailed")), checkedAt: new Date().toISOString(), probeStatus: "failed" };
            }
          });

          const results = await Promise.all(readinessPromises);
          if (controller.signal.aborted) return;
          const readinessMap = results.reduce((acc: any, cur: any) => {
            acc[cur.id] = cur;
            return acc;
          }, {});

          setChatReadiness(readinessMap);

          // Determine the initial selectedId exactly once after readiness state resolves
          if (activeList.length > 0) {
            selectInstanceId(resolveInitialChatInstanceId(activeList, readinessMap, preferredInstanceId, selectionPersistence.read().instanceId));
          }
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch instances for chat workspace:", err);
        setError(t("dashboard:chatWorkspace.loadInstancesError"));
      } finally {
        if (!controller.signal.aborted) setLoadingInstances(false);
      }
    }
    loadInstances();
    return () => controller.abort();
  }, [currentUser?.id]);


  // Poll/Refresh readiness of selected instance and load its conversations when selectedId changes
  useEffect(() => {
    if (!selectedId) return;
    
    const initialSelectedId = selectedId;
    const currentInstanceGen = instanceGenerationRef.current;
    const controller = new AbortController();
    
    async function checkCurrentReadinessAndLoadConversations() {
      try {
        // Probe readiness
        const probe = await api.get(`/api/instances/${selectedId}/chat-readiness`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!shouldAcceptConversationHistory(
          { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
          { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
        )) return;
        setChatReadiness(prev => ({
          ...prev,
          [selectedId]: normalizeChatReadinessProbe({ ...probe, checkedAt: new Date().toISOString(), probeStatus: "checked" })
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!shouldAcceptConversationHistory(
          { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
          { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
        )) return;
        setChatReadiness(prev => ({
          ...prev,
          [selectedId]: { ...unavailableChatReadiness("PROBE_FAILED", t("dashboard:chatWorkspace.probeFailed")), checkedAt: new Date().toISOString(), probeStatus: "failed" }
        }));
      }

      await loadConversationsForSelectedInstance(initialSelectedId, currentInstanceGen, controller.signal);
    }
    
    checkCurrentReadinessAndLoadConversations();
    return () => controller.abort();
  }, [selectedId]);

  // Load messages whenever active conversation changes
  useEffect(() => {
    if (!selectedId || !selectedConversationId) {
      setMessages([]);
      setNextCursorSeq(null);
      setLoadingMessages(false);
      return;
    }

    const initialSelectedId = selectedId;
    const initialConvId = selectedConversationId;
    const currentMessageGen = messageGenerationRef.current;
    const historyRequestId = ++messageLoadRequestIdRef.current;
    const controller = new AbortController();
    historyAbortRef.current = controller;
    let resumeTimer: number | undefined;
    const searchTarget = searchNavigation?.conversationId === initialConvId ? searchNavigation : null;

    async function loadConvMessages() {
      try {
        setLoadingMessages(true);
        setError(null);
        setNextCursorSeq(null);
        const targetQuery = getHistorySearchQuery(searchTarget);
        const res = await api.get(`/api/instances/${selectedId}/conversations/${selectedConversationId}/messages?limit=50${targetQuery}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!shouldAcceptMessageHistory(
          { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
          { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
        )) {
          return;
        }
        if (res && res.success && Array.isArray(res.messages)) {
          let mapped: ChatMessage[] = res.messages.map((m: any) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content || "",
            sequence_no: m.sequence_no,
            status: normalizeStoredMessageStatus(m.status, m.error_code),
            error_code: m.error_code || undefined,
            request_id: m.request_id || m.requestId || undefined,
            conversation_id: m.conversation_id || selectedConversationIdRef.current,
            error_message: normalizeStoredMessageError(m.status, m.error_code, m.error_message),
            metadata: m.metadata || null,
            usage_prompt_tokens: m.usage_prompt_tokens ?? null,
            usage_completion_tokens: m.usage_completion_tokens ?? null,
            usage_total_tokens: m.usage_total_tokens ?? null,
            duration_ms: m.duration_ms ?? null,
            user_feedback: m.user_feedback || undefined
          }));

          if (res.activeRun) {
            const recovered = recoverActiveRunMessages(mapped, res.activeRun, initialConvId);
            mapped = recovered.messages;
            setSending(true);
            setActiveRunId(res.activeRun.id);
            setActiveRunConversationId(initialConvId);
            setRunMetrics({
              runId: res.activeRun.id,
              status: recovered.status,
              startedAt: res.activeRun.startedAt || res.activeRun.createdAt || null,
              completedAt: null,
              durationMs: null
            });
            initializeRunExecution({
              runId: res.activeRun.id,
              conversationId: initialConvId,
              requestId: recovered.requestId,
              assistantMessageId: recovered.assistantMessageId,
              status: recovered.status,
              recoveryTextBaseline: recovered.partialOutput,
              resumeAfterEventId: 0
            });
            // A fresh view has no tool blocks. Replay the available stream; the text
            // baseline reconciliation avoids duplicating already displayed output.
            resumeTimer = window.setTimeout(() => {
              if (controller.signal.aborted) return;
              streamActiveRun(res.activeRun.id, initialSelectedId, initialConvId);
            }, 100);
          } else {
            stopActiveRunStreams();
            resetRunState();
            setActiveRunConversationId(null);
          }

          setMessages(prev => reconcileConversationMessages(mapped, prev, optimisticChatContextRef.current, selectedConversationIdRef.current));
          setNextCursorSeq(res.nextCursorSeq);
          setSearchNavigation(previous => completeLatestHistoryWindow(previous, searchTarget));
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        if (shouldAcceptMessageHistory(
          { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
          { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
        )) {
          if ([403, 404, 410].includes(err?.status)) {
            setSearchNavigation(null);
            selectionPersistence.rememberConversation(initialSelectedId, null);
            selectConversationId(null);
            void loadConversationsForSelectedInstance(initialSelectedId, instanceGenerationRef.current);
          } else {
            console.error("Failed to load messages:", err);
            setError(t("dashboard:chatWorkspace.loadMessagesFailed"));
          }
        }
      } finally {
        if (shouldAcceptMessageHistory(
          { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
          { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
        )) {
          setLoadingMessages(false);
        }
      }
    }

    loadConvMessages();
    return () => {
      controller.abort();
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      if (historyAbortRef.current === controller) historyAbortRef.current = null;
    };
  }, [selectedId, selectedConversationId, searchNavigation?.nonce]);

  const selectedReadiness = chatReadiness[selectedId];
  const handleReadinessChecked = useCallback((probe: Parameters<typeof normalizeChatReadinessProbe>[0]) => {
    if (selectedIdRef.current !== selectedId) return;
    setChatReadiness(previous => ({ ...previous, [selectedId]: normalizeChatReadinessProbe(probe) }));
  }, [selectedId]);
  const isChatReady = selectedReadiness ? selectedReadiness.ready : false; // Do not assume ready until verified
  const hasAnyReady = Object.values(chatReadiness).some(r => r.ready);

  const selectedInstance = instances.find(inst => inst.id === selectedId);

  // Group instances into Ready, Probing, and Unready for clean frontend ordering
  const groupedInstances = useMemo(() => {
    const ready: AgentInstance[] = [];
    const probing: AgentInstance[] = [];
    const unready: AgentInstance[] = [];

    instances.forEach((inst) => {
      const readiness = chatReadiness[inst.id];
      if (!readiness) {
        probing.push(inst);
      } else if (readiness.ready) {
        ready.push(inst);
      } else {
        unready.push(inst);
      }
    });

    return { ready, probing, unready };
  }, [instances, chatReadiness]);

  // Format descriptive channel + readiness labels for the dropdown selector
  const getInstanceDropdownLabel = (inst: AgentInstance) => {
    const channel = inst.configSummary?.channel || "web";
    const isPureWeb = channel === "web" || channel === "none";
    const channelLabel = inst.configSummary?.channelLabel || (isPureWeb ? t("dashboard:chatWorkspace.pureWebLabel") : channel);
    
    const readiness = chatReadiness[inst.id];
    if (!readiness) {
      return `[${channelLabel}] ${inst.name} (${t("dashboard:chatWorkspace.probingLabel")})`;
    }
    
    if (readiness.ready) {
      return `[${channelLabel}] ${inst.name}`;
    }
    
    if (isPureWeb) {
      return `[${channelLabel}] ${inst.name} (${t("dashboard:chatWorkspace.webOnlyNotReadyLabel")})`;
    } else {
      return `[${channelLabel}] ${inst.name} (${t("dashboard:chatWorkspace.externalMainChannelOnlyLabel")})`;
    }
  };

  const handleLoadMoreMessages = async () => {
    if (!selectedId || !selectedConversationId || nextCursorSeq === null || loadingMoreMessages) {
      return;
    }
    
    const initialSelectedId = selectedId;
    const initialConvId = selectedConversationId;
    const currentMessageGen = messageGenerationRef.current;
    const historyRequestId = ++messageLoadRequestIdRef.current;
    
    chatScroll.pause();

    try {
      setLoadingMoreMessages(true);
      const res = await api.get(`/api/instances/${selectedId}/conversations/${selectedConversationId}/messages?limit=50&beforeSeq=${nextCursorSeq}`);
      
      if (!shouldAcceptMessageHistory(
        { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
        { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
      )) {
        return;
      }
      
      if (res && res.success && Array.isArray(res.messages)) {
        const previousMessages = res.messages.map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content || "",
          sequence_no: m.sequence_no,
          status: normalizeStoredMessageStatus(m.status, m.error_code),
          error_code: m.error_code || undefined,
          request_id: m.request_id || m.requestId || undefined,
          conversation_id: m.conversation_id || initialConvId,
          error_message: normalizeStoredMessageError(m.status, m.error_code, m.error_message),
          metadata: m.metadata || null,
          usage_prompt_tokens: m.usage_prompt_tokens ?? null,
          usage_completion_tokens: m.usage_completion_tokens ?? null,
          usage_total_tokens: m.usage_total_tokens ?? null,
          duration_ms: m.duration_ms ?? null,
          user_feedback: m.user_feedback || undefined
        }));
        
        // Capture at response time, not request time: the reader may have scrolled
        // or received more streaming content while the history request was pending.
        chatScroll.prepareForPrepend();
        setMessages(prev => deduplicateMessages([...previousMessages, ...prev], selectedConversationIdRef.current));
        setNextCursorSeq(res.nextCursorSeq);
      }
    } catch (err) {
      if (shouldAcceptMessageHistory(
        { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
        { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
      )) {
        console.error("Failed to load more messages:", err);
        setError(t("dashboard:chatWorkspace.loadMessagesFailed"));
      }
    } finally {
      if (shouldAcceptMessageHistory(
        { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
        { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
      )) {
        setLoadingMoreMessages(false);
      }
    }
  };

  const refreshAuthoritativeHistory = async (instanceId: string, convId: string) => {
    const historyRequestId = ++messageLoadRequestIdRef.current;
    const currentMessageGen = messageGenerationRef.current;
    try {
      // This is a background reconciliation after an optimistic chat reply.
      // Keep the rendered conversation visible; loadingMessages is reserved for
      // the blocking initial/conversation-switch history load above.
      const res = await api.get(`/api/instances/${instanceId}/conversations/${convId}/messages?limit=50`);
      if (
        selectedIdRef.current !== instanceId ||
        selectedConversationIdRef.current !== convId ||
        messageGenerationRef.current !== currentMessageGen ||
        messageLoadRequestIdRef.current !== historyRequestId
      ) {
        return;
      }
      if (res && res.success && Array.isArray(res.messages)) {
        const mapped = res.messages.map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content || "",
          sequence_no: m.sequence_no,
          status: normalizeStoredMessageStatus(m.status, m.error_code),
          error_code: m.error_code || undefined,
          request_id: m.request_id || m.requestId || undefined,
          conversation_id: m.conversation_id || convId,
          error_message: normalizeStoredMessageError(m.status, m.error_code, m.error_message),
          metadata: m.metadata || null,
          usage_prompt_tokens: m.usage_prompt_tokens ?? null,
          usage_completion_tokens: m.usage_completion_tokens ?? null,
          usage_total_tokens: m.usage_total_tokens ?? null,
          duration_ms: m.duration_ms ?? null,
          user_feedback: m.user_feedback || undefined
        }));
        const optimisticContext = optimisticChatContextRef.current?.conversationId === convId
          ? optimisticChatContextRef.current
          : null;

        setMessages(prev => reconcileConversationMessages(mapped, prev, optimisticContext, convId));

        if (optimisticContext?.phase === "settled") {
          const requestUserIndex = mapped.findIndex((m: ChatMessage) => (
            m.role === "user" && m.request_id === optimisticContext.requestId
          ));
          const hasAssistantAfterRequest = requestUserIndex >= 0
            ? mapped.slice(requestUserIndex + 1).some((m: ChatMessage) => m.role === "assistant" && !!m.content)
            : false;
          const hasAuthoritativeAssistant = optimisticContext.assistantMessageId
            ? mapped.some((m: ChatMessage) => m.id === optimisticContext.assistantMessageId) || hasAssistantAfterRequest
            : hasAssistantAfterRequest;
          if (hasAuthoritativeAssistant && optimisticChatContextRef.current?.requestId === optimisticContext.requestId) {
            optimisticChatContextRef.current = null;
          }
        }
        setNextCursorSeq(res.nextCursorSeq);
      }
    } catch (err) {
      if (
        selectedIdRef.current === instanceId &&
        selectedConversationIdRef.current === convId &&
        messageGenerationRef.current === currentMessageGen &&
        messageLoadRequestIdRef.current === historyRequestId
      ) {
        console.error("Authoritative history refresh failed:", err);
        showToast(t("dashboard:chatWorkspace.loadMessagesFailed"), "error");
      }
    }
  };
  refreshAuthoritativeHistoryRef.current = refreshAuthoritativeHistory;

  const refreshConversationList = async (instanceId: string) => {
    try {
      const res = await api.get(`/api/instances/${instanceId}/conversations?limit=20`);
      if (selectedIdRef.current !== instanceId) return;
      if (res && res.success && Array.isArray(res.conversations)) {
        setConversations(res.conversations);
        setConversationsCursor(res.nextCursor);
      }
    } catch (err) {
      console.warn("Failed to refresh conversations from realtime event:", err);
    }
  };

  useEffect(() => {
    if (!socket) return;

    const handleConversationUpdated = (payload?: {
      userId?: string;
      instanceId?: string;
      conversationId?: string;
      source?: string;
    }) => {
      if (!payload || payload.userId !== currentUser?.id) return;
      if (!payload.instanceId || payload.instanceId !== selectedIdRef.current) return;

      void refreshConversationList(payload.instanceId);

      if (payload.conversationId && payload.conversationId === selectedConversationIdRef.current) {
        void refreshAuthoritativeHistoryRef.current(payload.instanceId, payload.conversationId);        void refreshConversationFiles(payload.instanceId, payload.conversationId);
      }
    };
    socket.on("chat_workspace:conversation_updated", handleConversationUpdated);
    return () => {
      socket.off("chat_workspace:conversation_updated", handleConversationUpdated);
    };
  }, [socket, currentUser?.id, refreshConversationFiles]);

  const handleSend = createChatWorkspaceMessageSender({
    conversationCreationInFlightRef,
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

  const handleSwitchToAssistAndDiagnose = () => {
    setChatMode("assist");
    setSelectedSkillId("explain_last_error");
    setInput("请帮我分析刚才的错误原因");
    setShowSettings(true);
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
    waitForRunRelease,
    isCurrentRunContext,
    stopActiveRunStreams,
    finalizeActiveRunUi,
    t,
  });

  const handleRetry = (msg: ChatMessage) => {
    const retryContent = msg.content?.trim();
    if (!retryContent) return;
    if (!isChatReady) {
      showToast(t("dashboard:chatWorkspace.dropFilesNotReady"), "warning");
      return;
    }
    const retryAttachments = getRetryAttachments(msg, conversationFiles);
    if (retryAttachments.unavailableIds.length > 0) {
      showToast(t("dashboard:chatWorkspace.attachmentUnavailable"), "warning");
      return;
    }

    setMessages(prev => prev.map(message => (
      message.id === msg.id
        ? { ...message, status: "completed", error_code: undefined, error_message: undefined }
        : message
    )));
    setError(null);
    void handleSend(undefined, retryContent, {
      suppressOptimisticUser: true,
      replaceMessageId: msg.id,
      attachments: retryAttachments.attachments
    });
  };

  const handleChatModeChange = (mode: PreferredChatMode) => {
    if (!selectedId || selectedIdRef.current !== selectedId) return;
    if (mode === "agent" && !runsSupported) return;
    setChatMode(mode);
    modePreference.remember(selectedId, mode);
  };

  const handleEditMessage = (msg: ChatMessage) => {
    const editContent = msg.content?.trim();
    if (!editContent) return;

    const retryAttachments = getRetryAttachments(msg, conversationFiles);
    if (retryAttachments.unavailableIds.length > 0) {
      showToast(t("dashboard:chatWorkspace.attachmentUnavailable"), "warning");
      return;
    }
    editingRetryMessageIdRef.current = msg.id;
    setPendingAttachments(retryAttachments.attachments);
    setInput(editContent);
    setError(null);
  };

  const handleClear = async () => {
    const confirmed = await showConfirm({
      title: t("dashboard:chatWorkspace.clearChatTooltip"),
      message: t("dashboard:chatWorkspace.clearChatConfirm"),
      type: "warning",
      confirmText: t("dashboard:chatWorkspace.confirm"),
      cancelText: t("dashboard:chatWorkspace.cancel")
    });
    if (confirmed) {
      setMessages([]);
      setError(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
        onOpenMobileSidebar={() => {
          setShowSettings(false);
          setMobileOverlay("history");
        }}
        onDeployNewInstance={() => navigate(APP_ROUTES.DEPLOY)}
        onInstanceChange={(value) => {
          selectInstanceId(value);
          setMessages([]);
          setError(null);
          setMobileOverlay(null);
          setMobileWorkspaceTab("result");
        }}
        onToggleSettings={() => {
          setMobileOverlay(null);
          setShowSettings(!showSettings);
        }}
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
            onClick={() => setMobileOverlay(null)}
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
          onCreateConversation={() => {
            handleCreateConversation();
            setMobileOverlay(null);
          }}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onMoveProject={handleMoveProject}
          onCloseSidebar={() => setSidebarOpen(false)}
          onCloseMobileSidebar={() => setMobileOverlay(null)}
          onScroll={handleConversationsScroll}
          onSelectConversation={(id) => {
            setSearchNavigation(null);
            selectConversationId(id);
            setMobileOverlay(null);
          }}
          onSelectSearchResult={(result: ConversationSearchResult) => {
            if (result.message_id && Number.isFinite(result.sequence_no)) {
              setSearchNavigation({
                conversationId: result.conversation_id,
                messageId: result.message_id,
                sequenceNo: Number(result.sequence_no),
                nonce: Date.now(),
                window: "search"
              });
            } else {
              setSearchNavigation(null);
            }
            selectConversationId(result.conversation_id);
            setMobileOverlay(null);
          }}
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

        {/* Sidebar Mini expand toggle when closed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-2 top-2 p-1.5 bg-surface hover:bg-surface-muted text-content-muted hover:text-slate-700 border border-outline rounded-lg z-20 md:block hidden shadow-xs dark:hover:text-slate-100"
            title={t("dashboard:chatWorkspace.expandHistory")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Mobile workspace drawer entry */}
        {selectedId && (
          <button
            type="button"
            onClick={() => {
              setShowSettings(false);
              setMobileOverlay("workspace");
            }}
            className="xl:hidden absolute right-3 top-3 z-20 h-9 w-9 rounded-xl border border-outline bg-surface/95 text-content-secondary shadow-sm inline-flex items-center justify-center active:scale-95 transition-all"
            title={t("dashboard:chatWorkspace.workspaceTitle")}
            aria-label={t("dashboard:chatWorkspace.workspaceTitle")}
            aria-expanded={mobileWorkspaceOpen}
            aria-controls="mobile-chat-workspace-panel"
          >
            <Layers className="w-4 h-4" />
          </button>
        )}

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
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-indigo-500/10 dark:bg-indigo-500/20 backdrop-blur-xs p-4 sm:p-6 transition-all duration-200 pointer-events-none">
              <div className={`flex flex-col items-center justify-center p-6 sm:p-8 rounded-3xl border-2 border-dashed bg-white/95 dark:bg-slate-900/95 shadow-2xl space-y-3 text-center max-w-md mx-auto animate-fade-in ${
                !isChatReady || !selectedConversationId
                  ? "border-amber-500/70"
                  : attachmentLimitReached
                    ? "border-rose-500/70"
                    : "border-indigo-500/70"
              }`}>
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-xs">
                  <UploadCloud className="w-6 h-6 animate-bounce" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-content">
                    {!isChatReady
                      ? t("dashboard:chatWorkspace.dropFilesNotReady")
                      : !selectedConversationId
                        ? t("dashboard:chatWorkspace.dropFilesNoConversation")
                        : attachmentLimitReached
                          ? t("dashboard:chatWorkspace.attachmentLimitReached")
                          : isUploading
                            ? t("dashboard:chatWorkspace.attachmentUploading")
                            : t("dashboard:chatWorkspace.dropFilesTitle")}
                  </h3>
                  <p className="text-xs text-content-muted mt-1">
                    {!isChatReady
                      ? t("dashboard:chatWorkspace.dropFilesNotReadyDesc")
                      : !selectedConversationId
                        ? t("dashboard:chatWorkspace.dropFilesNoConversationDesc")
                        : attachmentLimitReached
                          ? t("dashboard:chatWorkspace.attachmentLimitReachedDesc")
                          : isUploading
                            ? t("dashboard:chatWorkspace.attachmentUploadingDesc")
                            : remainingAttachmentSlots === null
                              ? t("dashboard:chatWorkspace.dropFilesDescriptionUnlimited")
                              : t("dashboard:chatWorkspace.dropFilesDescription", { count: remainingAttachmentSlots })}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Main Messages container */}
          <ChatMessagesPanel
            scrollContainerRef={scrollContainerRef}
            messagesEndRef={messagesEndRef}
            showJumpToLatest={(needsLatestHistoryWindow(selectedHistoryNavigation) || !chatScroll.isFollowing) && messages.length > 0 && !loadingMessages}
            onJumpToLatest={handleJumpToLatest}
            onRevealMessage={chatScroll.revealMessage}
            highlightedMessageRevision={selectedSearch?.nonce}
            selectedId={selectedId}
            isChatReady={isChatReady}
            selectedInstance={selectedInstance}
            selectedReadiness={selectedReadiness}
            onReadinessChecked={handleReadinessChecked}
            instances={instances}
            loadingInstances={loadingInstances}
            loadingMessages={loadingMessages}
            messages={messages}
            nextCursorSeq={nextCursorSeq}
            loadingMoreMessages={loadingMoreMessages}
            selectedConversationId={selectedConversationId}
            currentUser={currentUser}
            sending={selectedConversationIsRunning}
            activeRunId={selectedActiveRunId}
            toolSteps={selectedToolSteps}
            runExecutionState={selectedRunExecution}
            runMetrics={selectedRunMetrics}
            approvalRequests={selectedApprovalRequests}
            canRespondToApproval={runCapabilities.runApprovalResponse}
            onRespondToApproval={respondToApproval}
            error={error}
            onGoToInstanceManage={() => navigate(APP_ROUTES.INSTANCES)}
            onUsePrompt={setInput}
            onLoadMoreMessages={handleLoadMoreMessages}
            onRetry={handleRetry}
            onEditMessage={handleEditMessage}
            onSwitchToAssistAndDiagnose={handleSwitchToAssistAndDiagnose}
            conversationFiles={conversationFiles}
            onOpenConversationFile={handleOpenConversationFileFromChat}
            onOpenInstanceFilePath={handleOpenInstanceFileFromChat}
            onDownloadInstanceFilePath={handleDownloadInstanceFilePath}
            generatedArtifacts={generatedArtifacts}
            onMessageFeedbackChange={(messageId, feedback) => {
              setMessages(prev => prev.map(message => (
                message.id === messageId ? { ...message, user_feedback: feedback } : message
              )));
            }}
            highlightedMessageId={selectedSearch?.messageId ?? null}
          />

          {/* Message input area */}
          {selectedId && (
            <ChatInputBar
              creatingConversation={creatingConversation}
              input={input}
              sending={selectedConversationIsRunning}
              activeRunId={selectedActiveRunId}
              stopPending={Boolean(selectedActiveRunId && stopPending)}
              isChatReady={isChatReady}
              hasActiveConversation={Boolean(selectedConversationId)}
              selectedChannel={selectedInstance?.configSummary?.channel || "web"}
              selectedInstanceName={selectedInstance?.name}
              runMetrics={selectedRunMetrics}
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

              onSubmit={handleSend}
              onKeyDown={handleKeyDown}
              onStopRun={handleCancelOrStop}
              onInputFocus={() => {
                if (typeof window !== "undefined" && window.innerWidth < CHAT_WORKSPACE_TABLET_BREAKPOINT) {
                  window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
                }
              }}
            />
          )}
        </div>
        <ChatWorkspacePanel
          selectedId={selectedId}
          selectedConversationId={selectedConversationId}
          conversationFiles={conversationFiles}
          generatedArtifacts={generatedArtifacts}
          onRefreshGeneratedArtifacts={refreshGeneratedArtifacts}
          onPreviewGeneratedArtifact={handleOpenInstanceFileFromChat}
          onDownloadGeneratedArtifact={handleDownloadInstanceFilePath}
          onDeleteConversationFile={handleDeleteConversationFile}
          onDownloadConversationFile={handleDownloadConversationFile}
          onOpenConversationFile={handleOpenConversationFileFromChat}
          onPreviewConversationFile={handlePreviewConversationFileFromWorkspace}
          conversationFilePreview={conversationFilePreview}
          onClearConversationFilePreview={clearConversationFilePreview}
          selectedInstance={selectedInstance}
          messages={messages}
          toolSteps={selectedToolSteps}
          activeRunId={selectedActiveRunId}
          runExecutionState={selectedRunExecution}
          runMetrics={selectedRunMetrics}
          approvalRequests={selectedApprovalRequests}
          runCapabilities={runCapabilities}
          onRespondToApproval={respondToApproval}
        />

        {mobileWorkspaceOpen && typeof document !== "undefined" && createPortal(
          <div className="fixed inset-0 z-[80] flex min-h-0 flex-col overflow-hidden bg-surface xl:hidden" role="dialog" aria-modal="true" aria-label={t("dashboard:chatWorkspace.workspaceTitle")}>
            <button
              type="button"
              onClick={() => setMobileOverlay(null)}
              className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[90] h-9 w-9 rounded-full border border-outline bg-surface text-content-muted hover:text-content inline-flex items-center justify-center shadow-sm"
              aria-label={t("dashboard:files_close_preview_title")}
            >
              <X className="w-4 h-4" />
            </button>
            <ChatWorkspacePanel
                variant="mobile"
                activeTab={mobileWorkspaceTab}
                onActiveTabChange={setMobileWorkspaceTab}
                selectedId={selectedId}
                selectedConversationId={selectedConversationId}
                conversationFiles={conversationFiles}
                generatedArtifacts={generatedArtifacts}
                onRefreshGeneratedArtifacts={refreshGeneratedArtifacts}
                onPreviewGeneratedArtifact={handleOpenInstanceFileFromChat}
                onDownloadGeneratedArtifact={handleDownloadInstanceFilePath}
                onDeleteConversationFile={handleDeleteConversationFile}
                onDownloadConversationFile={handleDownloadConversationFile}
                onOpenConversationFile={handleOpenConversationFileFromChat}
                onPreviewConversationFile={handlePreviewConversationFileFromWorkspace}
                conversationFilePreview={conversationFilePreview}
                onClearConversationFilePreview={clearConversationFilePreview}
                selectedInstance={selectedInstance}
                messages={messages}
                toolSteps={selectedToolSteps}
                activeRunId={selectedActiveRunId}
                runExecutionState={selectedRunExecution}
                runMetrics={selectedRunMetrics}
                approvalRequests={selectedApprovalRequests}
                runCapabilities={runCapabilities}
                onRespondToApproval={respondToApproval}
            />
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}









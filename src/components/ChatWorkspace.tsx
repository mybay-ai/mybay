import { useState, useEffect, useRef, useMemo } from "react";
import type { Socket } from "socket.io-client";
import { useTranslation } from "react-i18next";
import { ChevronRight, Layers, UploadCloud, X } from "lucide-react";
import { api } from "../lib/api";
import { humanizeChatError } from "../lib/chatRuntimeErrors";
import type { AgentInstance, User as UserType } from "../types";
import { APP_ROUTES } from "../constants/routes";
import { useNavigate } from "react-router-dom";
import { useFeedback } from "./FeedbackProvider";
import { ChatConversationSidebar } from "./chat-workspace/ChatConversationSidebar";
import { ChatInputBar, type ChatReasoningEffort, type PendingAttachment } from "./chat-workspace/ChatInputBar";
import { ChatMessagesPanel } from "./chat-workspace/ChatMessagesPanel";
import { ChatSettingsPanel } from "./chat-workspace/ChatSettingsPanel";
import { useChatRuns } from "./chat-workspace/useChatRuns";
import { ChatWorkspaceHeader } from "./chat-workspace/ChatWorkspaceHeader";
import { ChatWorkspacePanel } from "./chat-workspace/ChatWorkspacePanel";
import { useChatWorkspaceFiles } from "./chat-workspace/useChatWorkspaceFiles";
import { useChatConversations } from "./chat-workspace/useChatConversations";
import { MAX_CHAT_USER_MESSAGE_CHARS, countChatMessageCharacters } from "../../shared/chatMessageContract";

import {
  ChatMessage,
  OptimisticChatContext,
  deduplicateMessages,
  reconcileConversationMessages,
  shouldAcceptChatResponse,
  shouldAcceptMessageHistory,
  shouldAcceptConversationHistory
} from "../lib/chatWorkspaceState";

export function generateUUIDv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    
    let uuid = "";
    for (let i = 0; i < 16; i++) {
      if (i === 4 || i === 6 || i === 8 || i === 10) {
        uuid += "-";
      }
      uuid += arr[i].toString(16).padStart(2, "0");
    }
    return uuid;
  }
  
  const error = new Error("SECURE_RANDOM_UNAVAILABLE");
  (error as any).code = "SECURE_RANDOM_UNAVAILABLE";
  throw error;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ACTIVE_CHAT_RUN_STATUSES = new Set(["queued", "dispatching", "running", "stopping", "stop_requested"]);
const CONCURRENCY_TAKEOVER_ERRORS = new Set([
  "TOO_MANY_CONCURRENT_RUNS",
  "CONCURRENT_REQUEST",
  "CONCURRENT_RUN",
  "ACTIVE_RUN_EXISTS",
  "RUN_ALREADY_ACTIVE"
]);

const getBackendErrorCode = (err: any): string => String(err?.data?.error || err?.code || err?.message || "");

const isConcurrencyTakeoverError = (err: any): boolean => {
  const code = getBackendErrorCode(err);
  if (CONCURRENCY_TAKEOVER_ERRORS.has(code)) return true;
  if ((err?.status === 409 || err?.status === 429) && /CONCURRENT|ACTIVE_RUN|RUNNING|TOO_MANY/i.test(code)) return true;
  if ((err?.status === 409 || err?.status === 429) && /concurrent|active run|running async/i.test(String(err?.data?.message || ""))) return true;
  return false;
};

const isConcurrencyTakeoverCode = (code?: string | null): boolean => (
  !!code && (CONCURRENCY_TAKEOVER_ERRORS.has(code) || /CONCURRENT|ACTIVE_RUN|RUN_ALREADY|TOO_MANY/i.test(code))
);

const STOPPED_RUN_ERROR_CODES = new Set(["RUN_STOPPED", "CANCELLED_UPSTREAM", "CANCELLED_BY_USER", "RUN_CANCELLED"]);

const isStoppedRunCode = (code?: string | null): boolean => (
  !!code && STOPPED_RUN_ERROR_CODES.has(code)
);

const normalizeStoredMessageStatus = (status?: string, errorCode?: string | null): ChatMessage["status"] => {
  if ((status === "failed" || status === "cancelled") && isStoppedRunCode(errorCode)) return "stopped";
  if (status === "failed" && isConcurrencyTakeoverCode(errorCode)) return "superseded";
  return (status as ChatMessage["status"]) || "completed";
};

const normalizeStoredMessageError = (status?: string, errorCode?: string | null, errorMessage?: string | null): string | undefined => {
  if ((status === "failed" || status === "cancelled") && isStoppedRunCode(errorCode)) return undefined;
  if (status === "failed" && isConcurrencyTakeoverCode(errorCode)) return undefined;
  if (status === "failed") return errorMessage || errorCode || undefined;
  return errorMessage || undefined;
};


type QueuedFollowUp = {
  id: string;
  content: string;
  instanceId: string;
  conversationId: string | null;
  createdAt: number;
  attachments: PendingAttachment[];
};

const buildOptimisticAttachmentMetadata = (attachments: PendingAttachment[]) => attachments.length > 0 ? {
  attachmentIds: attachments.map((file) => file.id),
  attachments: attachments.map((file) => ({ ...file }))
} : undefined;

type SendOptions = {
  suppressOptimisticUser?: boolean;
  queuedMessageIds?: string[];
  replaceMessageId?: string;
  attachments?: PendingAttachment[];
};

export function ChatWorkspace({ currentUser, socket }: { currentUser?: UserType | null; socket?: Socket | null }) {
  const { t } = useTranslation(["dashboard", "common"]);
  const navigate = useNavigate();
  const { showConfirm, showToast } = useFeedback();
  
  // States
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatReadiness, setChatReadiness] = useState<Record<string, { ready: boolean; reason?: string; message?: string }>>({});

  
  // Conversation Selection State
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [activeRunConversationId, setActiveRunConversationId] = useState<string | null>(null);

  // Message Pagination State
  const [nextCursorSeq, setNextCursorSeq] = useState<number | null>(null);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  
  // UI States
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>("balanced");
  const [chatMode, setChatMode] = useState<"quick" | "assist" | "agent">("quick");
  const [selectedSkillId, setSelectedSkillId] = useState<string>("model_config_diagnosis");
  const [mobileWorkspaceFrame, setMobileWorkspaceFrame] = useState<{ top: number; bottom: number } | null>(null);
  const [mobileWorkspaceOpen, setMobileWorkspaceOpen] = useState(false);

  // Refs
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageLoadRequestIdRef = useRef<number>(0);
  const activeChatRequestIdRef = useRef<string | null>(null);
  const shouldScrollToBottomRef = useRef<boolean>(true);
  
  const instanceGenerationRef = useRef(0);
  const messageGenerationRef = useRef(0);
  const activeChatGenerationRef = useRef(0);
  const internallySelectingConversationRef = useRef(false);
  const optimisticChatContextRef = useRef<OptimisticChatContext | null>(null);
  const activeSyncChatRequestRef = useRef<{ controller: AbortController; requestId: string; instanceId: string; conversationId: string | null } | null>(null);
  const syncCancelReconciliationTimersRef = useRef<number[]>([]);
  const pendingFollowUpsRef = useRef<QueuedFollowUp[]>([]);
  const editingRetryMessageIdRef = useRef<string | null>(null);
  const [queuedFollowUpSignal, setQueuedFollowUpSignal] = useState(0);

  const selectedIdRef = useRef(selectedId);
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);
  const refreshAuthoritativeHistoryRef = useRef<(instanceId: string, convId: string) => Promise<void>>(async () => {});

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
  const selectInstanceId = (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
  };

  const selectConversationId = (id: string | null) => {
    selectedConversationIdRef.current = id;
    setSelectedConversationId(id);
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
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    handleMoveConversationToProject,
    handleDeleteConversation,
    startRename,
    handleMoveConversation,
    handleTogglePinConversation,
    buildConversationTitleFromMessage,
    maybeRenameDefaultConversation,
    handleRenameSubmit,
    handleConversationsScroll
  } = useChatConversations({
    selectedId,
    selectedIdRef,
    selectedConversationId,
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frameId: number | null = null;
    const updateMobileWorkspaceFrame = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const root = workspaceRootRef.current;
        if (!root || window.innerWidth >= 640) {
          setMobileWorkspaceFrame(null);
          return;
        }

        const visualViewport = window.visualViewport;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
        // Keep the workspace pinned below the dashboard mobile header.
        // iOS changes visualViewport.offsetTop while the keyboard opens; deriving the
        // top position from getBoundingClientRect() makes the app header disappear.
        const dashboardHeaderOffset = 48;
        const bottomInset = Math.max(0, Math.round(window.innerHeight - viewportHeight - viewportOffsetTop));

        setMobileWorkspaceFrame({
          top: dashboardHeaderOffset,
          bottom: bottomInset
        });

        if (shouldScrollToBottomRef.current) {
          const container = scrollContainerRef.current;
          if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
          }
        }
      });
    };

    updateMobileWorkspaceFrame();
    window.addEventListener("resize", updateMobileWorkspaceFrame);
    window.addEventListener("orientationchange", updateMobileWorkspaceFrame);
    window.visualViewport?.addEventListener("resize", updateMobileWorkspaceFrame);
    window.visualViewport?.addEventListener("scroll", updateMobileWorkspaceFrame);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", updateMobileWorkspaceFrame);
      window.removeEventListener("orientationchange", updateMobileWorkspaceFrame);
      window.visualViewport?.removeEventListener("resize", updateMobileWorkspaceFrame);
      window.visualViewport?.removeEventListener("scroll", updateMobileWorkspaceFrame);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscroll = html.style.overscrollBehaviorY;
    const previousHtmlHeight = html.style.height;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehaviorY;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyRight = body.style.right;
    const previousBodyWidth = body.style.width;
    const previousBodyHeight = body.style.height;
    let lockedScrollY = 0;
    let lockApplied = false;

    const restoreScrollLock = () => {
      if (!lockApplied) return;
      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehaviorY = previousHtmlOverscroll;
      html.style.height = previousHtmlHeight;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehaviorY = previousBodyOverscroll;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.right = previousBodyRight;
      body.style.width = previousBodyWidth;
      body.style.height = previousBodyHeight;
      window.scrollTo({ top: lockedScrollY, behavior: "auto" });
      lockApplied = false;
    };

    const applyMobileScrollLock = () => {
      if (window.innerWidth < 640) {
        if (!lockApplied) {
          lockedScrollY = window.scrollY || window.pageYOffset || 0;
        }
        html.style.overflow = "hidden";
        html.style.overscrollBehaviorY = "none";
        html.style.height = "100%";
        body.style.position = "fixed";
        body.style.top = "-" + lockedScrollY + "px";
        body.style.left = "0";
        body.style.right = "0";
        body.style.width = "100%";
        body.style.height = "100%";
        body.style.overflow = "hidden";
        body.style.overscrollBehaviorY = "none";
        lockApplied = true;
      } else {
        restoreScrollLock();
      }
    };

    applyMobileScrollLock();
    window.addEventListener("resize", applyMobileScrollLock);
    window.addEventListener("orientationchange", applyMobileScrollLock);

    return () => {
      window.removeEventListener("resize", applyMobileScrollLock);
      window.removeEventListener("orientationchange", applyMobileScrollLock);
      restoreScrollLock();
    };
  }, []);

  const {
    runsCapabilityState,
    runsSupported,
    activeRunId,
    runCapabilities,
    approvalRequests,
    runMetrics,
    toolSteps,
    setRunMetrics,
    setActiveRunId,
    setToolSteps,
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
    pendingFollowUpsRef.current = [];
    setQueuedFollowUpSignal(signal => signal + 1);
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
    selectConversationId(null);
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

  // Scroll only the message container. Avoid scrollIntoView here because it can move the whole page.
  useEffect(() => {
    if (shouldScrollToBottomRef.current) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
      shouldScrollToBottomRef.current = false;
    }
  }, [messages, sending]);

  // Load instances
  useEffect(() => {
    async function loadInstances() {
      try {
        setLoadingInstances(true);
        const data = await api.get("/api/instances");
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
              const probe = await api.get(`/api/instances/${inst.id}/chat-readiness`);
              return { id: inst.id, ready: !!probe?.ready, reason: probe?.error, message: probe?.message };
            } catch (err) {
              return { id: inst.id, ready: false, reason: "PROBE_FAILED", message: t("dashboard:chatWorkspace.probeFailed") };
            }
          });

          const results = await Promise.all(readinessPromises);
          const readinessMap = results.reduce((acc: any, cur: any) => {
            acc[cur.id] = cur;
            return acc;
          }, {});

          setChatReadiness(readinessMap);

          // Determine the initial selectedId exactly once after readiness state resolves
          if (activeList.length > 0) {
            const firstReady = activeList.find((inst: any) => readinessMap[inst.id]?.ready);
            if (firstReady) {
              selectInstanceId(firstReady.id);
            } else {
              selectInstanceId(activeList[0].id);
            }
          }
        }
      } catch (err: any) {
        console.error("Failed to fetch instances for chat workspace:", err);
        setError(t("dashboard:chatWorkspace.loadInstancesError"));
      } finally {
        setLoadingInstances(false);
      }
    }
    loadInstances();
  }, []);


  // Poll/Refresh readiness of selected instance and load its conversations when selectedId changes
  useEffect(() => {
    if (!selectedId) return;
    
    const initialSelectedId = selectedId;
    const currentInstanceGen = instanceGenerationRef.current;
    
    async function checkCurrentReadinessAndLoadConversations() {
      try {
        // Probe readiness
        const probe = await api.get(`/api/instances/${selectedId}/chat-readiness`);
        if (!shouldAcceptConversationHistory(
          { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
          { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
        )) return;
        setChatReadiness(prev => ({
          ...prev,
          [selectedId]: { ready: !!probe?.ready, reason: probe?.error, message: probe?.message }
        }));
      } catch (err) {
        if (!shouldAcceptConversationHistory(
          { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
          { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
        )) return;
        setChatReadiness(prev => ({
          ...prev,
          [selectedId]: { ready: false, reason: "PROBE_FAILED", message: t("dashboard:chatWorkspace.probeFailed") }
        }));
      }

      await loadConversationsForSelectedInstance(initialSelectedId, currentInstanceGen);
    }
    
    checkCurrentReadinessAndLoadConversations();
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
    shouldScrollToBottomRef.current = true;

    async function loadConvMessages() {
      try {
        setLoadingMessages(true);
        setError(null);
        setNextCursorSeq(null);
        const res = await api.get(`/api/instances/${selectedId}/conversations/${selectedConversationId}/messages?limit=50`);
        if (!shouldAcceptMessageHistory(
          { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
          { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
        )) {
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
            setSending(true);
            setActiveRunId(res.activeRun.id);
            // Append optimistic streaming placeholder if last message is from user
            const lastMsg = mapped[mapped.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
              mapped.push({
                id: `assistant-stream-${res.activeRun.id}`,
                role: 'assistant',
                content: res.activeRun.partialOutput || "",
                status: 'pending',
                conversation_id: initialConvId
              });
            }
            // Trigger streaming reconnection
            setTimeout(() => {
              streamActiveRun(res.activeRun.id);
            }, 100);
          } else {
            setActiveRunId(null);
            setToolSteps([]);
          }

          setMessages(prev => reconcileConversationMessages(mapped, prev, optimisticChatContextRef.current, selectedConversationIdRef.current));
          setNextCursorSeq(res.nextCursorSeq);
        }
      } catch (err: any) {
        console.error("Failed to load messages:", err);
        if (shouldAcceptMessageHistory(
          { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
          { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
        )) {
          setError(t("dashboard:chatWorkspace.loadMessagesFailed"));
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
  }, [selectedId, selectedConversationId]);

  const selectedReadiness = chatReadiness[selectedId];
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
    const container = scrollContainerRef.current;
    const oldScrollHeight = container ? container.scrollHeight : 0;
    const oldScrollTop = container ? container.scrollTop : 0;
    
    const initialSelectedId = selectedId;
    const initialConvId = selectedConversationId;
    const currentMessageGen = messageGenerationRef.current;
    const historyRequestId = ++messageLoadRequestIdRef.current;
    
    shouldScrollToBottomRef.current = false;

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
        
        setMessages(prev => deduplicateMessages([...previousMessages, ...prev], selectedConversationIdRef.current));
        setNextCursorSeq(res.nextCursorSeq);

        setTimeout(() => {
          if (
            container &&
            shouldAcceptMessageHistory(
              { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
              { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
            )
          ) {
            container.scrollTop = container.scrollHeight - oldScrollHeight + oldScrollTop;
          }
        }, 0);
      }
    } catch (err) {
      console.error("Failed to load more messages:", err);
      if (shouldAcceptMessageHistory(
        { selectedId: selectedIdRef.current, selectedConversationId: selectedConversationIdRef.current, messageGeneration: messageGenerationRef.current, historyRequestId: messageLoadRequestIdRef.current },
        { selectedId: initialSelectedId, selectedConversationId: initialConvId, messageGeneration: currentMessageGen, historyRequestId }
      )) {
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
      console.error("Authoritative history refresh failed:", err);
      if (
        selectedIdRef.current === instanceId &&
        selectedConversationIdRef.current === convId &&
        messageGenerationRef.current === currentMessageGen &&
        messageLoadRequestIdRef.current === historyRequestId
      ) {
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

  const waitForRunRelease = async (instanceId: string, runId: string) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(attempt === 0 ? 180 : 320);
      try {
        const res = await api.get(`/api/instances/${instanceId}/runs/${runId}`);
        const status = String(res?.run?.status || "").toLowerCase();
        if (!status || !ACTIVE_CHAT_RUN_STATUSES.has(status)) {
          return true;
        }
      } catch (err) {
        console.warn("[Chat Interrupt] Failed to poll stopped run status:", err);
        return false;
      }
    }
    return false;
  };

  const createChatRunWithRetry = async (
    instanceId: string,
    payload: { conversationId: string | null; content: string; requestId: string; reasoningEffort?: ChatReasoningEffort; attachmentIds?: string[] },
    shouldRetryConcurrency: boolean
  ) => {
    let lastErr: any = null;
    const maxAttempts = shouldRetryConcurrency ? 6 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await api.post(`/api/instances/${instanceId}/runs`, payload);
      } catch (err: any) {
        lastErr = err;
        if (!shouldRetryConcurrency || !isConcurrencyTakeoverError(err) || attempt === maxAttempts - 1) {
          throw err;
        }
        await sleep(300 + attempt * 250);
      }
    }

    throw lastErr;
  };

  const enqueueFollowUpMessage = (content: string, attachments: PendingAttachment[]) => {
    if (!content.trim() || !selectedIdRef.current || !selectedConversationIdRef.current) return;

    let queuedMessageId: string;
    try {
      queuedMessageId = `queued-user-${generateUUIDv4()}`;
    } catch (err: any) {
      if (err?.code === "SECURE_RANDOM_UNAVAILABLE") {
        setError(t("dashboard:chatWorkspace.secureRandomUnavailable"));
        return;
      }
      throw err;
    }

    const queuedItem: QueuedFollowUp = {
      id: queuedMessageId,
      content: content.trim(),
      instanceId: selectedIdRef.current,
      conversationId: selectedConversationIdRef.current,
      createdAt: Date.now(),
      attachments: [...attachments]
    };

    pendingFollowUpsRef.current = [...pendingFollowUpsRef.current, queuedItem];

    const queuedMessage: ChatMessage = {
      id: queuedMessageId,
      role: "user",
      content: queuedItem.content,
      status: "queued",
      error_code: "QUEUED_FOLLOW_UP",
      conversation_id: queuedItem.conversationId,
      error_message: t("dashboard:chatWorkspace.messageQueued"),
      metadata: buildOptimisticAttachmentMetadata(queuedItem.attachments)
    };

    setMessages(prev => deduplicateMessages([...prev, queuedMessage], selectedConversationIdRef.current));
    shouldScrollToBottomRef.current = true;
    setQueuedFollowUpSignal(signal => signal + 1);
  };

  const handleSend = async (e?: React.FormEvent, customContent?: string, options?: SendOptions) => {
    if (e) {
      e.preventDefault();
    }

    if (uploadInFlightRef.current || isUploading) {
      showToast(t("dashboard:chatWorkspace.attachmentUploading", { defaultValue: "附件正在上传中，请稍候..." }), "warning");
      return;
    }
    const usesAttachmentOverride = options?.attachments !== undefined;
    const attachmentsForSend = [...(options?.attachments || pendingAttachments)];

    const messageContent = customContent !== undefined ? customContent : input;
    const userMsgContent = messageContent.trim();
    const editingReplaceMessageId = customContent === undefined ? editingRetryMessageIdRef.current : null;
    const sendOptions: SendOptions | undefined = editingReplaceMessageId
      ? { ...options, suppressOptimisticUser: true, replaceMessageId: editingReplaceMessageId }
      : options;
    if (!userMsgContent || !selectedId) return;
    if (countChatMessageCharacters(userMsgContent) > MAX_CHAT_USER_MESSAGE_CHARS) {
      showToast(
        t("dashboard:chatWorkspace.messageTooLong", { max: MAX_CHAT_USER_MESSAGE_CHARS.toLocaleString() }),
        "warning"
      );
      return;
    }

    if (chatMode === "agent" && !runsSupported) {
      const message = runsCapabilityState === "disabled"
        ? t("dashboard:chatWorkspace.asyncRunsDisabled")
        : runsCapabilityState === "checking"
          ? t("dashboard:chatWorkspace.asyncRunsChecking")
          : t("dashboard:chatWorkspace.asyncRunsUnavailable");
      setError(message);
      showToast(message, "warning");
      return;
    }

    const isSameConversationRunning = sending && (!activeRunConversationId || activeRunConversationId === selectedConversationIdRef.current);
    if (isSameConversationRunning) {
      if (customContent === undefined) {
        setInput("");
      }
      enqueueFollowUpMessage(userMsgContent, attachmentsForSend);
      if (attachmentsForSend.length > 0) setPendingAttachments([]);
      return;
    }

    const isInterruptingActiveRun = false;
    const suppressOptimisticUser = !!sendOptions?.suppressOptimisticUser;
    const replaceMessageId = sendOptions?.replaceMessageId;

    let asyncRunAccepted = false;
    let optimisticUserMessageInserted = false;

    // Generate UUIDs before any async interruption wait so the user message can render immediately.
    let requestId: string;
    let tempUserMsgId: string;
    let tempAssistantMsgId: string;
    try {
      requestId = generateUUIDv4();
      tempUserMsgId = replaceMessageId || `temp-user-${generateUUIDv4()}`;
      tempAssistantMsgId = `assistant-${generateUUIDv4()}`;
    } catch (err: any) {
      if (err?.code === "SECURE_RANDOM_UNAVAILABLE") {
        setError(t("dashboard:chatWorkspace.secureRandomUnavailable"));
        return;
      }
      throw err;
    }

    if (replaceMessageId && editingRetryMessageIdRef.current === replaceMessageId) {
      editingRetryMessageIdRef.current = null;
    }

    const userMsg = userMsgContent;
    const tempUserMsg: ChatMessage = {
      id: tempUserMsgId,
      role: "user" as const,
      content: userMsg,
      status: "completed",
      request_id: requestId,
      conversation_id: selectedConversationIdRef.current,
      metadata: buildOptimisticAttachmentMetadata(attachmentsForSend)
    };
    const interruptNoticeMsg: ChatMessage | null = isInterruptingActiveRun ? {
      id: `interrupt-notice-${generateUUIDv4()}`,
      role: "assistant" as const,
      content: t("dashboard:chatWorkspace.interruptNotice"),
      status: "completed",
      conversation_id: selectedConversationIdRef.current
    } : null;

    const insertOptimisticUserMessage = (conversationId: string | null) => {
      if (!conversationId || optimisticUserMessageInserted || suppressOptimisticUser) return;
      const scopedUserMsg = { ...tempUserMsg, conversation_id: conversationId };
      const scopedInterruptNotice = interruptNoticeMsg ? { ...interruptNoticeMsg, conversation_id: conversationId } : null;
      setMessages(prev => deduplicateMessages([...prev, scopedUserMsg, ...(scopedInterruptNotice ? [scopedInterruptNotice] : [])], conversationId));
      optimisticUserMessageInserted = true;
      shouldScrollToBottomRef.current = true;
    };

    const replaceExistingUserMessage = (conversationId: string | null) => {
      if (!replaceMessageId || !conversationId) return;
      setMessages(prev => deduplicateMessages(prev.map(message => (
        message.id === replaceMessageId
          ? { ...message, content: userMsg, status: "completed", conversation_id: conversationId, error_code: undefined, error_message: undefined }
          : message
      )), conversationId));
      optimisticUserMessageInserted = true;
      shouldScrollToBottomRef.current = true;
    };

    if (customContent === undefined) {
      setInput("");
    }

    if (isInterruptingActiveRun) {
      insertOptimisticUserMessage(selectedConversationId);
    }

    if (isInterruptingActiveRun && activeRunId) {
      try {
        await api.post(`/api/instances/${selectedId}/runs/${activeRunId}/stop`);
        await waitForRunRelease(selectedId, activeRunId);
      } catch (stopErr) {
        console.warn("[Chat Interrupt] Failed to request stop for active run before sending latest message:", stopErr);
      }
      stopActiveRunStreams();
      resetRunState();
      activeChatGenerationRef.current += 1;
      activeChatRequestIdRef.current = null;
      setSending(false);
      setToolSteps([]);
      setMessages(prev => prev.map(message => {
        if (message.role === "assistant" && message.status === "pending") {
          return { ...message, status: "completed", content: message.content || t("dashboard:chatWorkspace.previousTaskInterrupted") };
        }
        if (message.role === "user" && message.status === "failed" && message.error_code === "TOO_MANY_CONCURRENT_RUNS") {
          return { ...message, status: "superseded", error_message: t("dashboard:chatWorkspace.messageSuperseded") };
        }
        return message;
      }));
    }

    // Increment history request ID to immediately invalidate all in-flight history loads
    messageLoadRequestIdRef.current += 1;
    setLoadingMessages(false);

    const syncController = chatMode === "agent" ? null : new AbortController();
    if (syncController) {
      activeSyncChatRequestRef.current = {
        controller: syncController,
        requestId,
        instanceId: selectedId,
        conversationId: selectedConversationId
      };
    }

    setSending(true);
    setError(null);
    shouldScrollToBottomRef.current = true;

    let activeConvId = selectedConversationId;
    activeChatRequestIdRef.current = requestId;

    const optimisticUserMessageIds = sendOptions?.queuedMessageIds?.length
      ? sendOptions.queuedMessageIds
      : [tempUserMsgId];

    // Set initial optimistic context
    optimisticChatContextRef.current = {
      instanceId: selectedId,
      conversationId: activeConvId || "",
      requestId,
      userMessageId: optimisticUserMessageIds[0] || tempUserMsgId,
      userMessageIds: optimisticUserMessageIds,
      phase: "sending"
    };

    const initialSelectedId = selectedId;
    const initialConvId = selectedConversationId;
    const currentChatGen = activeChatGenerationRef.current;
    let chatSuccess = false;

    try {
      // Automatic conversation creation if none exists/is active
      if (!activeConvId) {
        const count = conversations.length + 1;
        const title = buildConversationTitleFromMessage(userMsg);
        const convRes = await api.post(`/api/instances/${selectedId}/conversations`, { title }, syncController ? { signal: syncController.signal } : undefined);
        
        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (convRes && convRes.success && convRes.conversation) {
          activeConvId = convRes.conversation.id;
          if (activeSyncChatRequestRef.current?.requestId === requestId) {
            activeSyncChatRequestRef.current.conversationId = activeConvId;
          }
          // Update context with the newly created conversationId
          optimisticChatContextRef.current = {
            instanceId: selectedId,
            conversationId: activeConvId,
            requestId,
            userMessageId: optimisticUserMessageIds[0] || tempUserMsgId,
            userMessageIds: optimisticUserMessageIds,
            phase: "sending"
          };
          internallySelectingConversationRef.current = true;
          setConversations(prev => [convRes.conversation, ...prev]);
          selectConversationId(activeConvId);
        } else {
          throw new Error(t("dashboard:chatWorkspace.autoCreateFailed"));
        }
      }

      if (activeConvId) {
        void maybeRenameDefaultConversation(activeConvId, userMsg);
      }

      replaceExistingUserMessage(activeConvId);
      insertOptimisticUserMessage(activeConvId);

      if (chatMode === "agent") {
        console.debug("[ChatWorkspace] Sending Agent run request.", {
          chatMode,
          runsSupported,
          runsCapabilityState,
          requestPath: `/api/instances/${selectedId}/runs`
        });

        const runRes = await createChatRunWithRetry(selectedId, {
          conversationId: activeConvId,
          content: userMsg,
          requestId,
          reasoningEffort,
          attachmentIds: attachmentsForSend.map(a => a.id)
        }, isInterruptingActiveRun);

        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (runRes && runRes.success && runRes.runId) {
          asyncRunAccepted = true;
          if (!usesAttachmentOverride) setPendingAttachments([]);
          setActiveRunId(runRes.runId);
          setActiveRunConversationId(activeConvId);
          const queuedAt = Date.now();
          setToolSteps([{ id: `queued-${runRes.runId}`, name: "chatWorkspace.toolStepAgentTaskQueued", status: "running", stepType: "tool_call", startedAt: queuedAt }]);
          setRunMetrics({ runId: runRes.runId, status: "queued", startedAt: queuedAt });
          if (isInterruptingActiveRun) {
            setMessages(prev => prev.map(message => (
              message.role === "user" && message.status === "failed" && message.error_code === "TOO_MANY_CONCURRENT_RUNS"
                ? { ...message, status: "superseded", conversation_id: message.conversation_id || selectedConversationIdRef.current, error_message: t("dashboard:chatWorkspace.messageSuperseded") }
                : message
            )));
          }

          const assistantMsg: ChatMessage = {
            id: tempAssistantMsgId,
            role: "assistant" as const,
            content: "",
            status: "pending",
            conversation_id: activeConvId
          };
          if (optimisticChatContextRef.current?.requestId === requestId) {
            optimisticChatContextRef.current = {
              ...optimisticChatContextRef.current,
              conversationId: activeConvId,
              assistantMessageId: tempAssistantMsgId,
              phase: "settled"
            };
          }
          setMessages(prev => deduplicateMessages([...prev, assistantMsg], activeConvId));

          setTimeout(() => {
            streamActiveRun(runRes.runId).catch((err) => {
              console.warn("[streamActiveRun] Unhandled promise rejection caught:", err);
            });
          }, 100);

          chatSuccess = true;
        } else {
          throw new Error(runRes?.message || t("dashboard:chatWorkspace.noAgentResponse"));
        }
      } else if (chatMode === "quick") {
        const res = await api.post(`/api/instances/${selectedId}/conversations/${activeConvId}/chat`, {
          content: userMsg,
          requestId,
          temperature,
          reasoningEffort,
          attachmentIds: attachmentsForSend.map(a => a.id)
        }, { signal: syncController!.signal });

        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (res && res.success) {
          if (!usesAttachmentOverride) setPendingAttachments([]);
          const assistantMsg: ChatMessage = {
            id: res.assistantMessageId || tempAssistantMsgId,
            role: "assistant" as const,
            content: res.message,
            status: "completed",
            conversation_id: activeConvId,
            sequence_no: res.assistantSequenceNo ?? undefined,
            usage_prompt_tokens: res.usagePromptTokens ?? res.usage?.prompt_tokens ?? res.usage?.input_tokens ?? null,
            usage_completion_tokens: res.usageCompletionTokens ?? res.usage?.completion_tokens ?? res.usage?.output_tokens ?? null,
            usage_total_tokens: res.usageTotalTokens ?? res.usage?.total_tokens ?? res.usage?.totalTokens ?? null,
            duration_ms: res.durationMs ?? null,
            metadata: null
          };
          shouldScrollToBottomRef.current = true;
          setMessages(prev => deduplicateMessages([...prev, assistantMsg], activeConvId));
          setConversations(prev => {
            const matched = prev.find(c => c.id === activeConvId);
            if (matched) {
              const updated = { ...matched, updated_at: new Date().toISOString() };
              return [updated, ...prev.filter(c => c.id !== activeConvId)];
            }
            return prev;
          });
          
          chatSuccess = true;

          if (optimisticChatContextRef.current?.requestId === requestId) {
            optimisticChatContextRef.current = {
              ...optimisticChatContextRef.current,
              assistantMessageId: res.assistantMessageId || tempAssistantMsgId,
              phase: "settled"
            };
          }
        } else {
          throw new Error(res?.message || t("dashboard:chatWorkspace.noAgentResponse"));
        }
      } else if (chatMode === "assist") {
        const res = await api.post(`/api/instances/${selectedId}/conversations/${activeConvId}/assist`, {
          content: userMsg,
          requestId,
          temperature,
          reasoningEffort,
          skillId: selectedSkillId,
          attachmentIds: attachmentsForSend.map(a => a.id)
        }, { signal: syncController!.signal });

        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (res && res.success) {
          if (!usesAttachmentOverride) setPendingAttachments([]);
          const assistantMsg: ChatMessage = {
            id: res.assistantMessageId || tempAssistantMsgId,
            role: "assistant" as const,
            content: res.message,
            status: "completed",
            conversation_id: activeConvId,
            sequence_no: res.assistantSequenceNo ?? undefined
          };
          shouldScrollToBottomRef.current = true;
          setMessages(prev => deduplicateMessages([...prev, assistantMsg], activeConvId));
          setConversations(prev => {
            const matched = prev.find(c => c.id === activeConvId);
            if (matched) {
              const updated = { ...matched, updated_at: new Date().toISOString() };
              return [updated, ...prev.filter(c => c.id !== activeConvId)];
            }
            return prev;
          });
          
          chatSuccess = true;

          if (optimisticChatContextRef.current?.requestId === requestId) {
            optimisticChatContextRef.current = {
              ...optimisticChatContextRef.current,
              assistantMessageId: res.assistantMessageId || tempAssistantMsgId,
              phase: "settled"
            };
          }
        } else {
          throw new Error(res?.message || t("dashboard:chatWorkspace.noAgentResponse"));
        }
      } else if (runsCapabilityState === "disabled") {
        throw new Error(t("dashboard:chatWorkspace.asyncRunsDisabled"));
      } else if (runsCapabilityState === "checking") {
        throw new Error(t("dashboard:chatWorkspace.asyncRunsChecking"));
      } else {
        throw new Error(t("dashboard:chatWorkspace.asyncRunsUnavailable"));
      }
    } catch (err: any) {
      if (!shouldAcceptChatResponse(
        { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
        { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
      )) {
        return;
      }
      console.error("[Chat Send Error] Full error details:", err, err?.data);
      const humanizedError = humanizeChatError(err, t("dashboard:chatWorkspace.requestFailedAgentOffline"));
      const backendErr = err.data?.error || err.code || "";
      const backendErrCode = String(backendErr).toUpperCase();
      const isTakeoverRace = isConcurrencyTakeoverError(err);
      const backendMsg = typeof err.data?.message === "string" ? err.data.message : "";

      let friendlyMsg = humanizedError.message;

      if (chatMode === "agent") {
        if (backendErrCode === "INSUFFICIENT_CREDITS") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunInsufficientCredits");
        } else if (backendErrCode === "CREDIT_LEDGER_NOT_READY") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunCreditLedgerNotReady");
        } else if (backendErrCode === "CREDIT_LEDGER_UNAVAILABLE") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunCreditLedgerUnavailable");
        } else if (backendErrCode === "FEATURE_DISABLED") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.asyncRunsDisabled");
        } else if (backendErrCode === "RUNS_NOT_SUPPORTED") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunNotSupported");
        } else if (backendErrCode === "UPSTREAM_UNAVAILABLE") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunUpstreamUnavailable");
        } else if (backendErrCode === "BEGIN_RUN_FAILED") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunBeginFailed");
        } else if (backendErrCode === "INVALID_REQUEST") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunInvalidRequest");
        } else if (!backendMsg && backendErrCode) {
          friendlyMsg = t("dashboard:chatWorkspace.agentRunFailedWithCode", { code: backendErrCode });
        }
      }
      
      if (backendErr === "chat_api_auth_redirected") {
        friendlyMsg = t("dashboard:chatWorkspace.errorInternalRoute", { message: backendMsg || t("dashboard:chatWorkspace.statusNotReady") });
      } else if (backendErr === "CONTAINER_NOT_REDEPLOYED") {
        friendlyMsg = t("dashboard:chatWorkspace.errorNotRedeployed");
      } else if (backendErr === "direct_8642_timeout") {
        friendlyMsg = t("dashboard:chatWorkspace.errorTimeout");
      } else if (backendErr === "direct_8642_refused") {
        friendlyMsg = t("dashboard:chatWorkspace.errorRefused");
      } else if (backendErr === "internal_traefik_route_404") {
        friendlyMsg = t("dashboard:chatWorkspace.errorTraefik404");
      } else if (backendErr === "chat_api_not_ready") {
        friendlyMsg = t("dashboard:chatWorkspace.errorLoading");
      } else if (backendErr === "CHAT_API_NOT_ENABLED") {
        friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.errorNotEnabled");
      } else if (backendErr === "MODEL_CONFIG_MISSING") {
        friendlyMsg = humanizedError.message || "该实例缺少快速对话所需的配置。";
      } else if (backendErr === "CHAT_TURN_METADATA_RPC_MISSING") {
        friendlyMsg = humanizedError.message || "聊天附件关联所需的数据库函数尚未升级，请先完成数据库迁移后再试。";
      } else if (backendErr === "CHAT_TURN_RPC_SCHEMA_MISMATCH") {
        friendlyMsg = humanizedError.message || "多轮对话数据库函数版本与当前代码不一致，请同步数据库迁移后再试。";
      } else if (backendErr === "DIRECT_MODEL_CHAT_FAILED") {
        const rawMsg = err.data?.message || err.message || "";
        const lowerMsg = rawMsg.toLowerCase();
        let advice = "";

        if (lowerMsg.includes("invalid temperature")) {
          advice = "请检查模型 Temperature 参数或 BYOK 渠道配置。";
        } else if (lowerMsg.includes("invalid api key") || lowerMsg.includes("unauthorized") || lowerMsg.includes("401")) {
          advice = "请检查 API Key 或凭证中心配置。";
        } else if (lowerMsg.includes("quota") || lowerMsg.includes("insufficient") || lowerMsg.includes("limit")) {
          advice = "请检查供应商额度状态或 BYOK 配置。";
        } else if (lowerMsg.includes("model") || lowerMsg.includes("not found")) {
          advice = "请检查模型名称是否仍被供应商支持。";
        } else if (lowerMsg.includes("timeout") || lowerMsg.includes("fetch failed")) {
          advice = "请检查服务器到供应商 API 的网络连通性。";
        } else {
          advice = "直接调用大模型 API 失败，请检查服务商额度或代理。";
        }

        const diagnostics = err.data?.diagnostics;
        if (diagnostics && diagnostics.provider && diagnostics.model) {
          friendlyMsg = `${advice} [供应商: ${diagnostics.provider}, 模型: ${diagnostics.model}] (详情: ${rawMsg})`;
        } else {
          friendlyMsg = `${advice} (详情: ${rawMsg})`;
        }
      } else if (backendErr === "API_KEY_MISSING") {
        friendlyMsg = humanizedError.message || "由于后端无权直接读取容器内局部 .env，请在麦贝控制台的实例设置或平台凭证中心重新配置该供应商的 API 密钥。";
      }
      
      if (optimisticUserMessageInserted) {
        const shouldQueueMessage = isTakeoverRace;
        const shouldMarkSuperseded = isInterruptingActiveRun && isTakeoverRace;
        setMessages(prev => prev
          .filter(m => m.id !== tempAssistantMsgId)
          .map(m => m.id === tempUserMsgId ? {
            ...m,
            status: shouldMarkSuperseded ? "superseded" : shouldQueueMessage ? "queued" : "failed",
            error_code: backendErr || "SEND_FAILED",
            error_message: shouldMarkSuperseded
              ? t("dashboard:chatWorkspace.messageSuperseded")
              : shouldQueueMessage
                ? t("dashboard:chatWorkspace.messageQueued")
                : friendlyMsg
          } : m)
        );
      } else if (sendOptions?.queuedMessageIds?.length) {
        setMessages(prev => prev
          .filter(m => m.id !== tempAssistantMsgId)
          .map(m => sendOptions.queuedMessageIds!.includes(m.id) ? {
            ...m,
            status: isTakeoverRace ? "queued" : "failed",
            error_code: backendErr || "SEND_FAILED",
            error_message: isTakeoverRace ? t("dashboard:chatWorkspace.messageQueued") : friendlyMsg
          } : m)
        );
      } else {
        setError(friendlyMsg);
      }
      if (optimisticChatContextRef.current?.requestId === requestId) {
        optimisticChatContextRef.current = null;
      }
    } finally {
      if (activeSyncChatRequestRef.current?.requestId === requestId) {
        activeSyncChatRequestRef.current = null;
      }
      const isRequestActive = (
        selectedIdRef.current === initialSelectedId &&
        activeChatGenerationRef.current === currentChatGen &&
        activeChatRequestIdRef.current === requestId
      );

      if (isRequestActive) {
        // Invalidate any history load request made during sending
        messageLoadRequestIdRef.current += 1;
        if (!asyncRunAccepted) {
          setSending(false);
          if (chatSuccess) {
            refreshAuthoritativeHistory(initialSelectedId, activeConvId);
          } else {
            setLoadingMessages(false);
          }
        }
      }
    }
  };

  useEffect(() => {
    if (
      sending ||
      activeRunId ||
      isUploading ||
      uploadInFlightRef.current ||
      !selectedId ||
      !selectedConversationId
    ) {
      return;
    }

    const queuedItems = pendingFollowUpsRef.current.filter(item => (
      item.instanceId === selectedId &&
      (!item.conversationId || item.conversationId === selectedConversationId)
    ));
    if (queuedItems.length === 0) return;

    const queuedItem = queuedItems[0];
    const queuedIds = [queuedItem.id];

    // Optimistically update UI status to processing
    setMessages(prev => prev.map(message => (
      queuedIds.includes(message.id)
        ? { ...message, status: "completed", error_code: undefined, error_message: t("dashboard:chatWorkspace.queuedFollowUpProcessing") }
        : message
    )));

    const mergedContent = queuedItem.content;

    let sent = false;
    const timerId = window.setTimeout(() => {
      if (uploadInFlightRef.current || isUploading) {
        // Attachment upload started during the 180ms window! Revert UI status to queued.
        setMessages(prev => prev.map(message => (
          queuedIds.includes(message.id)
            ? { ...message, status: "queued", error_code: "QUEUED_FOLLOW_UP", error_message: t("dashboard:chatWorkspace.messageQueued") }
            : message
        )));
        return;
      }

      // Deferred deletion: remove from queue only when confirmed safe to send
      sent = true;
      pendingFollowUpsRef.current = pendingFollowUpsRef.current.filter(item => !queuedIds.includes(item.id));

      void handleSend(undefined, mergedContent, {
        suppressOptimisticUser: true,
        queuedMessageIds: queuedIds,
        attachments: queuedItem.attachments
      });
    }, 180);

    return () => {
      window.clearTimeout(timerId);
      if (!sent) {
        setMessages(prev => prev.map(message => (
          queuedIds.includes(message.id) && message.status === "completed" && message.error_message === t("dashboard:chatWorkspace.queuedFollowUpProcessing")
            ? { ...message, status: "queued", error_code: "QUEUED_FOLLOW_UP", error_message: t("dashboard:chatWorkspace.messageQueued") }
            : message
        )));
      }
    };
  }, [activeRunId, isUploading, queuedFollowUpSignal, selectedConversationId, selectedId, sending]);

  const handleSwitchToAssistAndDiagnose = () => {
    setChatMode("assist");
    setSelectedSkillId("explain_last_error");
    setInput("请帮我分析刚才的错误原因");
    setShowSettings(true);
  };

  const markStoppedRunMessages = () => {
    setMessages(prev => {
      let latestUserIndex = -1;
      for (let index = prev.length - 1; index >= 0; index -= 1) {
        if (prev[index].role === "user") {
          latestUserIndex = index;
          break;
        }
      }

      return prev.map((message, index) => {
        if (message.role === "assistant" && message.status === "pending") {
          return {
            ...message,
            status: "completed",
            content: message.content || t("dashboard:chatWorkspace.previousTaskInterrupted")
          };
        }
        if (index === latestUserIndex) {
          return {
            ...message,
            status: "stopped",
            error_code: "RUN_STOPPED",
            error_message: t("dashboard:chatWorkspace.messageStopped", { defaultValue: "已停止，可编辑后重新发送" })
          };
        }
        return message;
      });
    });
  };

  const scheduleSyncCancellationReconciliation = (instanceId: string, conversationId: string) => {
    syncCancelReconciliationTimersRef.current.splice(0).forEach(timerId => window.clearTimeout(timerId));
    syncCancelReconciliationTimersRef.current = [500, 1500, 3000].map(delayMs => window.setTimeout(() => {
      if (selectedIdRef.current === instanceId && selectedConversationIdRef.current === conversationId) {
        void refreshAuthoritativeHistoryRef.current(instanceId, conversationId);
      }
    }, delayMs));
  };

  const handleCancelOrStop = async () => {
    const syncRequest = activeSyncChatRequestRef.current;
    if (syncRequest) {
      activeSyncChatRequestRef.current = null;
      syncRequest.controller.abort();
      activeChatGenerationRef.current += 1;
      activeChatRequestIdRef.current = null;
      setSending(false);
      setMessages(previous => previous.map(message => (
        message.role === "user" && message.request_id === syncRequest.requestId
          ? {
              ...message,
              status: "stopped",
              error_code: "CANCELLED_BY_USER",
              error_message: t("dashboard:chatWorkspace.messageStopped")
            }
          : message
      )));
      if (optimisticChatContextRef.current?.requestId === syncRequest.requestId) {
        optimisticChatContextRef.current = {
          ...optimisticChatContextRef.current,
          phase: "settled"
        };
      }
      if (syncRequest.conversationId) {
        scheduleSyncCancellationReconciliation(syncRequest.instanceId, syncRequest.conversationId);
      }
      return;
    }

    await handleStopActiveRun();
  };

  const handleStopActiveRun = async () => {
    const runId = activeRunId;
    await handleStopRun();
    if (selectedId && runId) {
      await waitForRunRelease(selectedId, runId);
    }
    stopActiveRunStreams();
    resetRunState();
    setActiveRunConversationId(null);
    activeChatGenerationRef.current += 1;
    activeChatRequestIdRef.current = null;
    setSending(false);
    setToolSteps([]);
    markStoppedRunMessages();
  };

  const handleRetry = (msg: ChatMessage) => {
    const retryContent = msg.content?.trim();
    if (!retryContent) return;

    setMessages(prev => prev.map(message => (
      message.id === msg.id
        ? { ...message, status: "completed", error_code: undefined, error_message: undefined }
        : message
    )));
    setError(null);
    void handleSend(undefined, retryContent, {
      suppressOptimisticUser: true,
      replaceMessageId: msg.id
    });
  };

  const handleEditMessage = (msg: ChatMessage) => {
    const editContent = msg.content?.trim();
    if (!editContent) return;

    editingRetryMessageIdRef.current = msg.id;
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedConversationIsRunning = sending && Boolean(selectedConversationId) && (!activeRunConversationId || activeRunConversationId === selectedConversationId);
  const selectedActiveRunId = selectedConversationIsRunning ? activeRunId : null;
  const selectedRunMetrics = (!activeRunConversationId || activeRunConversationId === selectedConversationId) ? runMetrics : null;

  return (
    <div
      ref={workspaceRootRef}
      style={mobileWorkspaceFrame ? ({ "--chat-workspace-mobile-top": `${mobileWorkspaceFrame.top}px`, "--chat-workspace-mobile-bottom": `${mobileWorkspaceFrame.bottom}px` } as React.CSSProperties) : undefined}
      className="flex flex-col w-full max-w-[1680px] h-[calc(100dvh-104px)] min-h-0 max-sm:fixed max-sm:left-0 max-sm:right-0 max-sm:top-[var(--chat-workspace-mobile-top,48px)] max-sm:bottom-[var(--chat-workspace-mobile-bottom,0px)] max-sm:h-auto max-sm:z-30 max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 sm:h-[calc(100dvh-104px)] sm:max-h-[920px] sm:min-h-[640px] mx-auto bg-surface-muted/70 border border-outline/80 rounded-xl sm:rounded-2xl shadow-lg shadow-slate-200/50 dark:shadow-slate-950/30 overflow-hidden animate-fade-in"
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
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        onDeployNewInstance={() => navigate(APP_ROUTES.DEPLOY)}
        onInstanceChange={(value) => {
          selectInstanceId(value);
          setMessages([]);
          setError(null);
        }}
        onToggleSettings={() => setShowSettings(!showSettings)}
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
          selectedSkillId={selectedSkillId}
          setSelectedSkillId={setSelectedSkillId}
        />
      )}

      {/* Main split layout container (Left Sidebar + Right Messages) */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative bg-surface-muted/60">
        {mobileSidebarOpen && (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-slate-950/45 sm:hidden"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label={t("dashboard:chatWorkspace.sidebarToggle")}
          />
        )}
        
        {/* Collapsible Left Sidebar (Conversation History Sidebar) */}
        <ChatConversationSidebar
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
            setMobileSidebarOpen(false);
          }}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onCloseSidebar={() => setSidebarOpen(false)}
          onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
          onScroll={handleConversationsScroll}
          onSelectConversation={(id) => {
            selectConversationId(id);
            setMobileSidebarOpen(false);
          }}
          setRenameValue={setRenameValue}
          setRenamingId={setRenamingId}
          onRenameSubmit={handleRenameSubmit}
          onStartRename={startRename}
          onMoveConversation={handleMoveConversation}
          onMoveConversationToProject={handleMoveConversationToProject}
          onTogglePinConversation={handleTogglePinConversation}
          onDeleteConversation={handleDeleteConversation}
        />

        {/* Sidebar Mini expand toggle when closed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-2 top-2 p-1.5 bg-surface hover:bg-surface-muted text-content-muted hover:text-slate-700 border border-outline rounded-lg z-20 sm:block hidden shadow-xs dark:hover:text-slate-100"
            title={t("dashboard:chatWorkspace.expandHistory")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Mobile workspace drawer entry */}
        {selectedId && (
          <button
            type="button"
            onClick={() => setMobileWorkspaceOpen(true)}
            className="sm:hidden absolute right-3 top-3 z-20 h-9 w-9 rounded-xl border border-outline bg-surface/95 text-content-secondary shadow-sm inline-flex items-center justify-center active:scale-95 transition-all"
            title={t("dashboard:chatWorkspace.workspaceTitle")}
            aria-label={t("dashboard:chatWorkspace.workspaceTitle")}
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
            selectedId={selectedId}
            isChatReady={isChatReady}
            selectedInstance={selectedInstance}
            selectedReadiness={selectedReadiness}
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
            toolSteps={toolSteps}
            runMetrics={selectedRunMetrics}
            error={error}
            onGoToInstanceManage={() => navigate(APP_ROUTES.INSTANCES)}
            onUsePrompt={setInput}
            onLoadMoreMessages={handleLoadMoreMessages}
            onRetry={handleRetry}
            onEditMessage={handleEditMessage}
            onSwitchToAssistAndDiagnose={handleSwitchToAssistAndDiagnose}
            conversationFiles={conversationFiles}
            onOpenConversationFile={handleOpenConversationFile}
            onOpenInstanceFilePath={handleOpenInstanceFilePath}
            onMessageFeedbackChange={(messageId, feedback) => {
              setMessages(prev => prev.map(message => (
                message.id === messageId ? { ...message, user_feedback: feedback } : message
              )));
            }}
          />

          {/* Message input area */}
          {selectedId && (
            <ChatInputBar
              input={input}
              sending={selectedConversationIsRunning}
              activeRunId={selectedActiveRunId}
              isChatReady={isChatReady}
              hasActiveConversation={Boolean(selectedConversationId)}
              selectedChannel={selectedInstance?.configSummary?.channel || "web"}
              selectedInstanceName={selectedInstance?.name}
              runMetrics={selectedRunMetrics}
              chatMode={chatMode}
              onChatModeChange={setChatMode}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
              agentAvailable={runsSupported}
              agentCapabilityState={runsCapabilityState}
              onInputChange={setInput}
              pendingAttachments={pendingAttachments}
              isUploading={isUploading}
              attachmentConfig={attachmentConfig}
              onUpload={handleUploadFiles}
              onRemoveAttachment={handleRemoveAttachment}

              onSubmit={handleSend}
              onKeyDown={handleKeyDown}
              onStopRun={handleCancelOrStop}
              onInputFocus={() => {
                if (typeof window !== "undefined" && window.innerWidth < 640) {
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
          onDeleteConversationFile={handleDeleteConversationFile}
          onDownloadConversationFile={handleDownloadConversationFile}
          onOpenConversationFile={handleOpenConversationFile}
          onPreviewConversationFile={handlePreviewConversationFile}
          conversationFilePreview={conversationFilePreview}
          onClearConversationFilePreview={clearConversationFilePreview}
          selectedInstance={selectedInstance}
          messages={messages}
          toolSteps={toolSteps}
          activeRunId={selectedActiveRunId}
          runMetrics={selectedRunMetrics}
          approvalRequests={approvalRequests}
          runCapabilities={runCapabilities}
          onRespondToApproval={respondToApproval}
        />

        {mobileWorkspaceOpen && (
          <div className="sm:hidden absolute inset-0 z-40 flex items-end bg-slate-950/35" role="dialog" aria-modal="true">
            <button
              type="button"
              className="absolute inset-0"
              onClick={() => setMobileWorkspaceOpen(false)}
              aria-label={t("dashboard:files_close_preview_title")}
            />
            <div className="relative flex h-[min(78dvh,720px)] max-h-[calc(100dvh-72px)] min-h-[360px] w-full flex-col rounded-t-3xl border border-outline bg-surface shadow-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setMobileWorkspaceOpen(false)}
                className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full border border-outline bg-surface text-slate-500 hover:text-slate-800 inline-flex items-center justify-center shadow-sm dark:text-slate-300 dark:hover:text-white"
                aria-label={t("dashboard:files_close_preview_title")}
              >
                <X className="w-4 h-4" />
              </button>
              <ChatWorkspacePanel
                variant="mobile"
                selectedId={selectedId}
                selectedConversationId={selectedConversationId}
                conversationFiles={conversationFiles}
                onDeleteConversationFile={handleDeleteConversationFile}
                onDownloadConversationFile={handleDownloadConversationFile}
                onOpenConversationFile={handleOpenConversationFile}
                onPreviewConversationFile={handlePreviewConversationFile}
                conversationFilePreview={conversationFilePreview}
                onClearConversationFilePreview={clearConversationFilePreview}
                selectedInstance={selectedInstance}
                messages={messages}
                toolSteps={toolSteps}
                activeRunId={selectedActiveRunId}
                runMetrics={selectedRunMetrics}
                approvalRequests={approvalRequests}
                runCapabilities={runCapabilities}
                onRespondToApproval={respondToApproval}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}












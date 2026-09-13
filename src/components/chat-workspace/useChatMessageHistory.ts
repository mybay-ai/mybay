import { useEffect, type Dispatch, type SetStateAction, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { shouldAcceptMessageHistory, reconcileConversationMessages, type ChatMessage, type OptimisticChatContext } from "../../lib/chatWorkspaceState";
import { completeLatestHistoryWindow, getHistorySearchQuery, type ChatHistoryNavigation } from "./chatHistoryNavigation";
import { mapStoredChatMessage, type StoredChatMessage } from "./mapStoredChatMessage";
import { recoverActiveRunMessages } from "./run/runRecovery";
import type { useChatRuns } from "./useChatRuns";
import type { createChatSelectionPersistence } from "./chatSelectionPersistence";

type Setter<T> = Dispatch<SetStateAction<T>>;
type RunRecovery = Pick<ReturnType<typeof useChatRuns>, "setActiveRunId" | "setRunMetrics" | "initializeRunExecution" | "streamActiveRun" | "stopActiveRunStreams" | "resetRunState">;
interface HistoryOptions extends RunRecovery {
  selectedId: string;
  selectedConversationId: string | null;
  searchNavigation: ChatHistoryNavigation | null;
  selectedIdRef: RefObject<string>;
  selectedConversationIdRef: RefObject<string | null>;
  messageGenerationRef: RefObject<number>;
  messageLoadRequestIdRef: RefObject<number>;
  instanceGenerationRef: RefObject<number>;
  historyAbortRef: RefObject<AbortController | null>;
  optimisticChatContextRef: RefObject<OptimisticChatContext | null>;
  setMessages: Setter<ChatMessage[]>;
  setNextCursorSeq: Setter<number | null>;
  setLoadingMessages: Setter<boolean>;
  setError: Setter<string | null>;
  setSending: Setter<boolean>;
  setActiveRunConversationId: Setter<string | null>;
  setSearchNavigation: Setter<ChatHistoryNavigation | null>;
  selectionPersistence: ReturnType<typeof createChatSelectionPersistence>;
  selectConversationId: (id: string | null) => void;
  loadConversationsForSelectedInstance: (id: string, generation: number, signal?: AbortSignal) => Promise<void>;
}

/** Restore selected history and resume its active run only while the request context is current. */
export function useChatMessageHistory({ selectedId, selectedConversationId, searchNavigation, selectedIdRef, selectedConversationIdRef, messageGenerationRef, messageLoadRequestIdRef, instanceGenerationRef, historyAbortRef, optimisticChatContextRef, setMessages, setNextCursorSeq, setLoadingMessages, setError, setSending, setActiveRunConversationId, setSearchNavigation, selectionPersistence, selectConversationId, loadConversationsForSelectedInstance, setActiveRunId, setRunMetrics, initializeRunExecution, streamActiveRun, stopActiveRunStreams, resetRunState }: HistoryOptions) {
  const { t } = useTranslation(["dashboard", "common"]);
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
          let mapped: ChatMessage[] = res.messages.map((m: StoredChatMessage) => mapStoredChatMessage(m, selectedConversationIdRef.current));

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

}

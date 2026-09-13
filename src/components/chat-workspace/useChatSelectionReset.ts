import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { ChatMessage, OptimisticChatContext } from "../../lib/chatWorkspaceState";

interface MutableRef<T> {
  current: T;
}

interface ActiveSyncChatRequest {
  controller: AbortController;
  requestId: string;
  instanceId: string;
  conversationId: string | null;
}

interface UseChatSelectionResetOptions {
  selectedId: string;
  selectedConversationId: string | null;
  activeSyncChatRequestRef: MutableRef<ActiveSyncChatRequest | null>;
  syncCancelReconciliationTimersRef: MutableRef<number[]>;
  instanceGenerationRef: MutableRef<number>;
  messageGenerationRef: MutableRef<number>;
  activeChatGenerationRef: MutableRef<number>;
  activeChatRequestIdRef: MutableRef<string | null>;
  optimisticChatContextRef: MutableRef<OptimisticChatContext | null>;
  messageLoadRequestIdRef: MutableRef<number>;
  internallySelectingConversationRef: MutableRef<boolean>;
  clearQueuedFollowUps: () => void;
  stopActiveRunStreams: () => void;
  resetConversationsForInstance: () => void;
  resetRunState: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setNextCursorSeq: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadingMoreMessages: Dispatch<SetStateAction<boolean>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setActiveRunConversationId: Dispatch<SetStateAction<string | null>>;
}

function cancelPendingSynchronization(
  activeSyncChatRequestRef: MutableRef<ActiveSyncChatRequest | null>,
  syncCancelReconciliationTimersRef: MutableRef<number[]>,
) {
  activeSyncChatRequestRef.current?.controller.abort();
  activeSyncChatRequestRef.current = null;
  syncCancelReconciliationTimersRef.current.splice(0).forEach(timerId => globalThis.clearTimeout(timerId));
}

/** Resets request and presentation state when the active instance or conversation changes. */
export function useChatSelectionReset({
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
}: UseChatSelectionResetOptions) {
  useEffect(() => {
    cancelPendingSynchronization(activeSyncChatRequestRef, syncCancelReconciliationTimersRef);
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
  }, [selectedId]);

  useEffect(() => {
    if (internallySelectingConversationRef.current) {
      internallySelectingConversationRef.current = false;
      setNextCursorSeq(null);
      setLoadingMoreMessages(false);
      return;
    }

    cancelPendingSynchronization(activeSyncChatRequestRef, syncCancelReconciliationTimersRef);
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
}

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { Socket } from "socket.io-client";
import { api } from "../../lib/api";
import {
  reconcileConversationMessages,
  type ChatMessage,
  type OptimisticChatContext,
} from "../../lib/chatWorkspaceState";
import { mapStoredChatMessage, type StoredChatMessage } from "./mapStoredChatMessage";

type Setter<T> = Dispatch<SetStateAction<T>>;

interface UseChatRealtimeSyncOptions {
  socket?: Socket | null;
  userId?: string;
  selectedIdRef: RefObject<string>;
  selectedConversationIdRef: RefObject<string | null>;
  messageGenerationRef: RefObject<number>;
  messageLoadRequestIdRef: RefObject<number>;
  optimisticChatContextRef: RefObject<OptimisticChatContext | null>;
  refreshAuthoritativeHistoryRef: RefObject<(instanceId: string, conversationId: string) => Promise<void>>;
  refreshConversationFiles: (instanceId: string, conversationId: string) => Promise<unknown>;
  setMessages: Setter<ChatMessage[]>;
  setNextCursorSeq: Setter<number | null>;
  setConversations: Setter<any[]>;
  setConversationsCursor: Setter<string | null>;
  showToast: (message: string, type?: "success" | "error" | "warning" | "info") => void;
  t: TFunction;
}

export function useChatRealtimeSync({
  socket,
  userId,
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
}: UseChatRealtimeSyncOptions) {
  const refreshAuthoritativeHistory = async (instanceId: string, conversationId: string) => {
    const historyRequestId = ++messageLoadRequestIdRef.current;
    const messageGeneration = messageGenerationRef.current;
    try {
      const response = await api.get(`/api/instances/${instanceId}/conversations/${conversationId}/messages?limit=50`);
      const stillSelected = selectedIdRef.current === instanceId
        && selectedConversationIdRef.current === conversationId
        && messageGenerationRef.current === messageGeneration
        && messageLoadRequestIdRef.current === historyRequestId;
      if (!stillSelected) return;

      if (response?.success && Array.isArray(response.messages)) {
        const mapped = response.messages.map((message: StoredChatMessage) => mapStoredChatMessage(message, conversationId));
        const optimisticContext = optimisticChatContextRef.current?.conversationId === conversationId
          ? optimisticChatContextRef.current
          : null;
        setMessages(previous => reconcileConversationMessages(mapped, previous, optimisticContext, conversationId));

        if (optimisticContext?.phase === "settled") {
          const requestUserIndex = mapped.findIndex(message => message.role === "user" && message.request_id === optimisticContext.requestId);
          const hasAssistantAfterRequest = requestUserIndex >= 0
            && mapped.slice(requestUserIndex + 1).some(message => message.role === "assistant" && !!message.content);
          const hasAuthoritativeAssistant = optimisticContext.assistantMessageId
            ? mapped.some(message => message.id === optimisticContext.assistantMessageId) || hasAssistantAfterRequest
            : hasAssistantAfterRequest;
          if (hasAuthoritativeAssistant && optimisticChatContextRef.current?.requestId === optimisticContext.requestId) {
            optimisticChatContextRef.current = null;
          }
        }
        setNextCursorSeq(response.nextCursorSeq);
      }
    } catch (error) {
      const stillSelected = selectedIdRef.current === instanceId
        && selectedConversationIdRef.current === conversationId
        && messageGenerationRef.current === messageGeneration
        && messageLoadRequestIdRef.current === historyRequestId;
      if (stillSelected) {
        console.error("Authoritative history refresh failed:", error);
        showToast(t("dashboard:chatWorkspace.loadMessagesFailed"), "error");
      }
    }
  };
  refreshAuthoritativeHistoryRef.current = refreshAuthoritativeHistory;

  useEffect(() => {
    if (!socket) return;

    const refreshConversationList = async (instanceId: string) => {
      try {
        const response = await api.get(`/api/instances/${instanceId}/conversations?limit=20`);
        if (selectedIdRef.current !== instanceId) return;
        if (response?.success && Array.isArray(response.conversations)) {
          setConversations(response.conversations);
          setConversationsCursor(response.nextCursor);
        }
      } catch (error) {
        console.warn("Failed to refresh conversations from realtime event:", error);
      }
    };

    const handleConversationUpdated = (payload?: {
      userId?: string;
      instanceId?: string;
      conversationId?: string;
    }) => {
      if (!payload || payload.userId !== userId) return;
      if (!payload.instanceId || payload.instanceId !== selectedIdRef.current) return;

      void refreshConversationList(payload.instanceId);
      if (payload.conversationId && payload.conversationId === selectedConversationIdRef.current) {
        void refreshAuthoritativeHistoryRef.current(payload.instanceId, payload.conversationId);
        void refreshConversationFiles(payload.instanceId, payload.conversationId);
      }
    };

    socket.on("chat_workspace:conversation_updated", handleConversationUpdated);
    return () => {
      socket.off("chat_workspace:conversation_updated", handleConversationUpdated);
    };
  }, [socket, userId, refreshConversationFiles, refreshAuthoritativeHistoryRef, selectedConversationIdRef, selectedIdRef, setConversations, setConversationsCursor]);

  return { refreshAuthoritativeHistory };
}

import type { Dispatch, SetStateAction, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { deduplicateMessages, shouldAcceptMessageHistory, type ChatMessage } from "../../lib/chatWorkspaceState";
import { mapStoredChatMessage, type StoredChatMessage } from "./mapStoredChatMessage";

type Setter<T> = Dispatch<SetStateAction<T>>;
interface PaginationOptions {
  selectedId: string;
  selectedConversationId: string | null;
  nextCursorSeq: number | null;
  loadingMoreMessages: boolean;
  selectedIdRef: RefObject<string>;
  selectedConversationIdRef: RefObject<string | null>;
  messageGenerationRef: RefObject<number>;
  messageLoadRequestIdRef: RefObject<number>;
  chatScroll: { pause: () => void; prepareForPrepend: () => void };
  setLoadingMoreMessages: Setter<boolean>;
  setMessages: Setter<ChatMessage[]>;
  setNextCursorSeq: Setter<number | null>;
  setError: Setter<string | null>;
}

export function useChatHistoryPagination({ selectedId, selectedConversationId, nextCursorSeq, loadingMoreMessages, selectedIdRef, selectedConversationIdRef, messageGenerationRef, messageLoadRequestIdRef, chatScroll, setLoadingMoreMessages, setMessages, setNextCursorSeq, setError }: PaginationOptions) {
  const { t } = useTranslation(["dashboard", "common"]);
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
        const previousMessages = res.messages.map((m: StoredChatMessage) => mapStoredChatMessage(m, initialConvId));

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

  return { handleLoadMoreMessages };
}

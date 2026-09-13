import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { needsLatestHistoryWindow, requestLatestHistoryWindow, type ChatHistoryNavigation } from "./chatHistoryNavigation";
import { useChatAutoFollow } from "./useChatAutoFollow";

interface MutableRef<T> {
  current: T;
}

interface UseChatHistoryViewportOptions {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  shouldScrollToBottomRef: RefObject<boolean>;
  selectedId: string;
  selectedConversationId: string | null;
  searchNavigation: ChatHistoryNavigation | null;
  messages: ChatMessage[];
  sending: boolean;
  loadingMessages: boolean;
  messageLoadRequestIdRef: MutableRef<number>;
  setLoadingMoreMessages: Dispatch<SetStateAction<boolean>>;
  setLoadingMessages: Dispatch<SetStateAction<boolean>>;
  setSearchNavigation: Dispatch<SetStateAction<ChatHistoryNavigation | null>>;
}

/** Owns the active history window and its viewport-following behavior. */
export function useChatHistoryViewport({
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
}: UseChatHistoryViewportOptions) {
  const selectedHistoryNavigation = searchNavigation?.conversationId === selectedConversationId
    ? searchNavigation
    : null;
  const selectedSearch = selectedHistoryNavigation?.window === "search"
    ? selectedHistoryNavigation
    : null;
  const chatScroll = useChatAutoFollow({
    scrollContainerRef,
    bottomAnchorRef: messagesEndRef,
    forceScrollRef: shouldScrollToBottomRef,
    contextKey: JSON.stringify([selectedId, selectedConversationId, selectedHistoryNavigation?.nonce]),
    startFollowing: !selectedSearch,
    contentRevision: messages,
    layoutRevision: sending,
  });

  const handleJumpToLatest = useCallback(() => {
    if (needsLatestHistoryWindow(selectedHistoryNavigation)) {
      messageLoadRequestIdRef.current += 1;
      setLoadingMoreMessages(false);
      setLoadingMessages(true);
      setSearchNavigation(previous => requestLatestHistoryWindow(previous, selectedConversationId));
      return;
    }
    chatScroll.jumpToLatest();
  }, [chatScroll, messageLoadRequestIdRef, selectedConversationId, selectedHistoryNavigation, setLoadingMessages, setLoadingMoreMessages, setSearchNavigation]);

  return {
    selectedHistoryNavigation,
    selectedSearch,
    chatScroll,
    handleJumpToLatest,
    showJumpToLatest: (needsLatestHistoryWindow(selectedHistoryNavigation) || !chatScroll.isFollowing)
      && messages.length > 0
      && !loadingMessages,
  };
}

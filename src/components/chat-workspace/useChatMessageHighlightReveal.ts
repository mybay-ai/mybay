import { useEffect, useRef, type RefObject } from "react";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { centerChatMessage } from "./chatAutoFollow";

type UseChatMessageHighlightRevealOptions = {
  scrollContainerRef: RefObject<HTMLDivElement>;
  selectedId: string;
  selectedConversationId: string | null;
  highlightedMessageId?: string | null;
  highlightedMessageRevision?: number;
  messages: ChatMessage[];
  onRevealMessage?: (message: HTMLElement) => void;
};

export function createChatMessageSelector(messageId: string): string {
  const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(messageId)
    : messageId.replace(/["\\]/g, "\\$&");
  return `[data-chat-message-id="${escapedId}"]`;
}

export function useChatMessageHighlightReveal({
  scrollContainerRef,
  selectedId,
  selectedConversationId,
  highlightedMessageId,
  highlightedMessageRevision,
  messages,
  onRevealMessage
}: UseChatMessageHighlightRevealOptions) {
  const lastRevealed = useRef<string | null>(null);

  useEffect(() => {
    if (!highlightedMessageId) {
      lastRevealed.current = null;
      return;
    }
    const revealKey = JSON.stringify([selectedId, selectedConversationId, highlightedMessageId, highlightedMessageRevision]);
    if (lastRevealed.current === revealKey) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(createChatMessageSelector(highlightedMessageId));
    if (!target) return;
    if (onRevealMessage) onRevealMessage(target);
    else centerChatMessage(container, target);
    lastRevealed.current = revealKey;
  }, [highlightedMessageId, highlightedMessageRevision, selectedId, selectedConversationId, messages, scrollContainerRef, onRevealMessage]);
}

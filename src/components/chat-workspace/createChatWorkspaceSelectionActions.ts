import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import type { ChatHistoryNavigation } from "./chatHistoryNavigation";
import type { PreferredChatMode } from "./chatModePreference";

interface MutableRef<T> {
  current: T;
}

interface ChatModePreference {
  modeFor: (instanceId: string) => PreferredChatMode;
}

interface ChatSelectionPersistence {
  rememberInstance: (instanceId: string) => void;
  rememberConversation: (instanceId: string, conversationId: string | null) => void;
}

interface CreateChatWorkspaceSelectionActionsOptions {
  historyAbortRef: MutableRef<AbortController | null>;
  instanceGenerationRef: MutableRef<number>;
  messageLoadRequestIdRef: MutableRef<number>;
  selectionRevisionRef: MutableRef<number>;
  selectedIdRef: MutableRef<string>;
  selectedConversationIdRef: MutableRef<string | null>;
  internallySelectingConversationRef: MutableRef<boolean>;
  setSelectedId: Dispatch<SetStateAction<string>>;
  setSelectedConversationId: Dispatch<SetStateAction<string | null>>;
  setChatMode: Dispatch<SetStateAction<"quick" | "assist" | "agent">>;
  setSearchNavigation: Dispatch<SetStateAction<ChatHistoryNavigation | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setNextCursorSeq: Dispatch<SetStateAction<number | null>>;
  setLoadingMoreMessages: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  modePreference: ChatModePreference;
  selectionPersistence: ChatSelectionPersistence;
}

/** Creates atomic instance/conversation transitions and invalidates stale requests. */
export function createChatWorkspaceSelectionActions({
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
}: CreateChatWorkspaceSelectionActionsOptions) {
  const selectInstanceId = (id: string) => {
    if (selectedIdRef.current === id) return;
    historyAbortRef.current?.abort();
    instanceGenerationRef.current += 1;
    messageLoadRequestIdRef.current += 1;
    selectionRevisionRef.current += 1;
    selectedIdRef.current = id;
    selectedConversationIdRef.current = null;
    setSelectedId(id);
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

  return { selectInstanceId, selectConversationId };
}

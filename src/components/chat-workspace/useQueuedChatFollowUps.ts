import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { deduplicateMessages, type ChatMessage } from "../../lib/chatWorkspaceState";
import type { PendingAttachment } from "./ChatInputBar";
import {
  buildOptimisticAttachmentMetadata,
  generateUUIDv4,
  type QueuedFollowUp,
  type SendOptions,
} from "./chatWorkspaceSendPolicy";

type QueuedFollowUpSender = (content: string, options: SendOptions) => void;

export function useQueuedChatFollowUps(options: {
  selectedId: string;
  selectedConversationId: string | null;
  selectedIdRef: MutableRefObject<string>;
  selectedConversationIdRef: MutableRefObject<string | null>;
  activeRunId: string | null;
  sending: boolean;
  creatingConversation?: boolean;
  conversationCreationInFlightRef?: MutableRefObject<boolean>;
  isUploading: boolean;
  uploadInFlightRef: MutableRefObject<boolean>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  shouldScrollToBottomRef: MutableRefObject<boolean>;
  t: (key: string) => string;
}) {
  const {
    selectedId,
    selectedConversationId,
    selectedIdRef,
    selectedConversationIdRef,
    activeRunId,
    sending,
    creatingConversation,
    conversationCreationInFlightRef,
    isUploading,
    uploadInFlightRef,
    setMessages,
    setError,
    shouldScrollToBottomRef,
    t,
  } = options;
  const pendingFollowUpsRef = useRef<QueuedFollowUp[]>([]);
  const queuedFollowUpSenderRef = useRef<QueuedFollowUpSender | null>(null);
  const [queueSignal, setQueueSignal] = useState(0);

  const clearQueuedFollowUps = () => {
    pendingFollowUpsRef.current = [];
    setQueueSignal(signal => signal + 1);
  };

  const enqueueFollowUpMessage = (content: string, attachments: PendingAttachment[]) => {
    if (!content.trim() || !selectedIdRef.current || !selectedConversationIdRef.current) return false;

    let queuedMessageId: string;
    try {
      queuedMessageId = `queued-user-${generateUUIDv4()}`;
    } catch (error: any) {
      if (error?.code === "SECURE_RANDOM_UNAVAILABLE") {
        setError(t("dashboard:chatWorkspace.secureRandomUnavailable"));
        return false;
      }
      throw error;
    }

    const queuedItem: QueuedFollowUp = {
      id: queuedMessageId,
      content: content.trim(),
      instanceId: selectedIdRef.current,
      conversationId: selectedConversationIdRef.current,
      createdAt: Date.now(),
      attachments: [...attachments],
    };
    pendingFollowUpsRef.current = [...pendingFollowUpsRef.current, queuedItem];
    setMessages(previous => deduplicateMessages([...previous, {
      id: queuedMessageId,
      role: "user",
      content: queuedItem.content,
      status: "queued",
      error_code: "QUEUED_FOLLOW_UP",
      conversation_id: queuedItem.conversationId,
      error_message: t("dashboard:chatWorkspace.messageQueued"),
      metadata: buildOptimisticAttachmentMetadata(queuedItem.attachments),
    }], selectedConversationIdRef.current));
    shouldScrollToBottomRef.current = true;
    setQueueSignal(signal => signal + 1);
    return true;
  };

  useEffect(() => {
    if (creatingConversation || conversationCreationInFlightRef?.current || sending || activeRunId || isUploading || uploadInFlightRef.current || !selectedId || !selectedConversationId) return;

    const queuedItem = pendingFollowUpsRef.current.find(item => (
      item.instanceId === selectedId && (!item.conversationId || item.conversationId === selectedConversationId)
    ));
    if (!queuedItem) return;

    const queuedMessageId = queuedItem.id;
    setMessages(previous => previous.map(message => (
      message.id === queuedMessageId
        ? { ...message, status: "completed", error_code: undefined, error_message: t("dashboard:chatWorkspace.queuedFollowUpProcessing") }
        : message
    )));

    let sent = false;
    const timerId = window.setTimeout(() => {
      if (conversationCreationInFlightRef?.current || uploadInFlightRef.current || isUploading) {
        setMessages(previous => previous.map(message => (
          message.id === queuedMessageId
            ? { ...message, status: "queued", error_code: "QUEUED_FOLLOW_UP", error_message: t("dashboard:chatWorkspace.messageQueued") }
            : message
        )));
        return;
      }

      sent = true;
      pendingFollowUpsRef.current = pendingFollowUpsRef.current.filter(item => item.id !== queuedMessageId);
      queuedFollowUpSenderRef.current?.(queuedItem.content, {
        suppressOptimisticUser: true,
        queuedMessageIds: [queuedMessageId],
        attachments: queuedItem.attachments,
      });
    }, 180);

    return () => {
      window.clearTimeout(timerId);
      if (!sent) {
        setMessages(previous => previous.map(message => (
          message.id === queuedMessageId
          && message.status === "completed"
          && message.error_message === t("dashboard:chatWorkspace.queuedFollowUpProcessing")
            ? { ...message, status: "queued", error_code: "QUEUED_FOLLOW_UP", error_message: t("dashboard:chatWorkspace.messageQueued") }
            : message
        )));
      }
    };
  }, [activeRunId, creatingConversation, isUploading, queueSignal, selectedConversationId, selectedId, sending]);

  return { clearQueuedFollowUps, enqueueFollowUpMessage, queuedFollowUpSenderRef };
}

import type React from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { ChatGroupConfig } from "../../../shared/chatCollaboration";
import { api } from "../../lib/api";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import type { SendOptions } from "./chatWorkspaceSendPolicy";
import type { PendingAttachment } from "./ChatInputBar";
import type { PreferredChatMode } from "./chatModePreference";
import { getRetryAttachments } from "./run/retryAttachments";

type Setter<T> = Dispatch<SetStateAction<T>>;
type ToastType = "success" | "error" | "warning" | "info";
type ConversationRecord = { id: string; collaboration?: ChatGroupConfig | null; [key: string]: unknown };

interface MessageActionOptions {
  selectedId: string;
  selectedConversationId: string | null;
  selectedIdRef: MutableRefObject<string>;
  selectedConversation: ConversationRecord | null;
  isChatReady: boolean;
  runsSupported: boolean;
  conversationFiles: PendingAttachment[];
  editingRetryMessageIdRef: MutableRefObject<string | null>;
  modePreference: { remember: (instanceId: string, mode: PreferredChatMode) => void };
  handleSend: (event?: React.FormEvent, customContent?: string, options?: SendOptions) => Promise<void>;
  setMessages: Setter<ChatMessage[]>;
  setConversations: Setter<ConversationRecord[]>;
  setPendingAttachments: Setter<PendingAttachment[]>;
  setInput: (content: string) => void;
  setError: Setter<string | null>;
  setChatMode: Setter<"quick" | "assist" | "agent">;
  setSelectedSkillId: Setter<string>;
  setShowSettings: Setter<boolean>;
  showToast: (message: string, type?: ToastType) => void;
  showConfirm: (options: {
    title: string;
    message: string;
    type: "warning";
    confirmText: string;
    cancelText: string;
  }) => Promise<boolean>;
  t: TFunction;
}

export function createChatWorkspaceMessageActions(options: MessageActionOptions) {
  const {
    selectedId,
    selectedConversationId,
    selectedIdRef,
    selectedConversation,
    isChatReady,
    runsSupported,
    conversationFiles,
    editingRetryMessageIdRef,
    modePreference,
    handleSend,
    setMessages,
    setConversations,
    setPendingAttachments,
    setInput,
    setError,
    setChatMode,
    setSelectedSkillId,
    setShowSettings,
    showToast,
    showConfirm,
    t,
  } = options;

  const handleSwitchToAssistAndDiagnose = () => {
    setChatMode("assist");
    setSelectedSkillId("explain_last_error");
    setInput("请帮我分析刚才的错误原因");
    setShowSettings(true);
  };

  const handleRetry = (message: ChatMessage) => {
    const retryContent = message.content?.trim();
    if (!retryContent) return;
    if (!isChatReady) {
      showToast(t("dashboard:chatWorkspace.dropFilesNotReady"), "warning");
      return;
    }
    const retryAttachments = getRetryAttachments(message, conversationFiles);
    if (retryAttachments.unavailableIds.length > 0) {
      showToast(t("dashboard:chatWorkspace.attachmentUnavailable"), "warning");
      return;
    }

    setMessages(previous => previous.map(item => item.id === message.id
      ? { ...item, status: "completed", error_code: undefined, error_message: undefined }
      : item));
    setError(null);
    void handleSend(undefined, retryContent, {
      suppressOptimisticUser: true,
      replaceMessageId: message.id,
      attachments: retryAttachments.attachments,
    });
  };

  const handleChatModeChange = (mode: PreferredChatMode) => {
    if (!selectedId || selectedIdRef.current !== selectedId) return;
    if (mode !== "agent" && selectedConversation?.collaboration?.mode === "group") {
      showToast(t("dashboard:chatWorkspace.groupRoomRequiresAgent"), "warning");
      return;
    }
    if (mode === "agent" && !runsSupported) return;
    setChatMode(mode);
    modePreference.remember(selectedId, mode);
  };

  const handleCollaborationChange = async (collaboration: ChatGroupConfig | null) => {
    if (!selectedId || !selectedConversationId) return;
    try {
      const response = await api.patch(
        `/api/instances/${encodeURIComponent(selectedId)}/conversations/${encodeURIComponent(selectedConversationId)}`,
        { collaboration },
      );
      if (!response?.success || !response.conversation) throw new Error("GROUP_ROOM_SAVE_FAILED");
      setConversations(previous => previous.map(conversation => (
        conversation.id === selectedConversationId ? response.conversation : conversation
      )));
      if (collaboration) handleChatModeChange("agent");
      showToast(t(collaboration
        ? "dashboard:chatWorkspace.groupRoomSaved"
        : "dashboard:chatWorkspace.groupRoomDisabled"), "success");
    } catch (error) {
      console.error("Failed to update group room:", error);
      showToast(t("dashboard:chatWorkspace.groupRoomSaveFailed"), "error");
      throw error;
    }
  };

  const handleEditMessage = (message: ChatMessage) => {
    const editContent = message.content?.trim();
    if (!editContent) return;
    const retryAttachments = getRetryAttachments(message, conversationFiles);
    if (retryAttachments.unavailableIds.length > 0) {
      showToast(t("dashboard:chatWorkspace.attachmentUnavailable"), "warning");
      return;
    }
    editingRetryMessageIdRef.current = message.id;
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
      cancelText: t("dashboard:chatWorkspace.cancel"),
    });
    if (confirmed) {
      setMessages([]);
      setError(null);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleMessageFeedbackChange = (messageId: string, feedback: "like" | "dislike" | null) => {
    setMessages(previous => previous.map(message => (
      message.id === messageId ? { ...message, user_feedback: feedback } : message
    )));
  };

  return {
    handleSwitchToAssistAndDiagnose,
    handleRetry,
    handleChatModeChange,
    handleCollaborationChange,
    handleEditMessage,
    handleClear,
    handleKeyDown,
    handleMessageFeedbackChange,
  };
}

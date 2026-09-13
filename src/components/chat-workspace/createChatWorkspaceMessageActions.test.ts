import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { createChatWorkspaceMessageActions } from "./createChatWorkspaceMessageActions";

vi.mock("../../lib/api", () => ({ api: { patch: vi.fn() } }));

function options(): Parameters<typeof createChatWorkspaceMessageActions>[0] {
  return {
    selectedId: "instance-a",
    selectedConversationId: "conversation-a",
    selectedIdRef: { current: "instance-a" },
    selectedConversation: { id: "conversation-a" },
    isChatReady: true,
    runsSupported: true,
    conversationFiles: [{ id: "file-a", name: "file.txt" } as any],
    editingRetryMessageIdRef: { current: null },
    modePreference: { remember: vi.fn() },
    handleSend: vi.fn(async () => {}),
    setMessages: vi.fn(),
    setConversations: vi.fn(),
    setPendingAttachments: vi.fn(),
    setInput: vi.fn(),
    setError: vi.fn(),
    setChatMode: vi.fn(),
    setSelectedSkillId: vi.fn(),
    setShowSettings: vi.fn(),
    showToast: vi.fn(),
    showConfirm: vi.fn(async () => true),
    t: ((key: string) => key) as any,
  };
}

function failedMessage(): ChatMessage {
  return {
    id: "message-a",
    role: "user",
    content: " retry me ",
    status: "failed",
    error_code: "UPSTREAM_FAILED",
    error_message: "failed",
    metadata: { attachmentIds: ["file-a"] },
  };
}

describe("chat workspace message actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restores retry state and reuses available attachments", () => {
    const input = options();
    createChatWorkspaceMessageActions(input).handleRetry(failedMessage());
    const update = vi.mocked(input.setMessages).mock.calls[0][0] as (messages: ChatMessage[]) => ChatMessage[];
    expect(update([failedMessage()])[0]).toMatchObject({ status: "completed", error_code: undefined, error_message: undefined });
    expect(input.handleSend).toHaveBeenCalledWith(undefined, "retry me", {
      suppressOptimisticUser: true,
      replaceMessageId: "message-a",
      attachments: [expect.objectContaining({ id: "file-a" })],
    });
  });

  it("blocks retry when the instance is not ready or an attachment is missing", () => {
    const notReady = options();
    notReady.isChatReady = false;
    createChatWorkspaceMessageActions(notReady).handleRetry(failedMessage());
    expect(notReady.handleSend).not.toHaveBeenCalled();
    expect(notReady.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.dropFilesNotReady", "warning");

    const missingAttachment = options();
    missingAttachment.conversationFiles = [];
    createChatWorkspaceMessageActions(missingAttachment).handleEditMessage(failedMessage());
    expect(missingAttachment.setInput).not.toHaveBeenCalled();
    expect(missingAttachment.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.attachmentUnavailable", "warning");
  });

  it("keeps group conversations in Agent mode", () => {
    const input = options();
    input.selectedConversation = { id: "conversation-a", collaboration: { mode: "group", peerIds: ["peer-a"], maxRounds: 1 } };
    createChatWorkspaceMessageActions(input).handleChatModeChange("quick");
    expect(input.setChatMode).not.toHaveBeenCalled();
    expect(input.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.groupRoomRequiresAgent", "warning");
  });

  it("persists collaboration and switches an enabled room to Agent mode", async () => {
    vi.mocked(api.patch).mockResolvedValue({ success: true, conversation: { id: "conversation-a", collaboration: { mode: "group" } } });
    const input = options();
    const collaboration = { mode: "group" as const, peerIds: ["peer-a"], maxRounds: 1 };
    await createChatWorkspaceMessageActions(input).handleCollaborationChange(collaboration);
    expect(api.patch).toHaveBeenCalledWith("/api/instances/instance-a/conversations/conversation-a", { collaboration });
    expect(input.setChatMode).toHaveBeenCalledWith("agent");
    expect(input.modePreference.remember).toHaveBeenCalledWith("instance-a", "agent");
    expect(input.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.groupRoomSaved", "success");
  });

  it("clears only after confirmation and submits Enter outside IME composition", async () => {
    const input = options();
    const actions = createChatWorkspaceMessageActions(input);
    await actions.handleClear();
    expect(input.setMessages).toHaveBeenCalledWith([]);

    const preventDefault = vi.fn();
    actions.handleKeyDown({ key: "Enter", shiftKey: false, preventDefault, nativeEvent: { isComposing: false, keyCode: 13 } } as any);
    expect(preventDefault).toHaveBeenCalled();
    expect(input.handleSend).toHaveBeenCalledWith();

    vi.mocked(input.handleSend).mockClear();
    actions.handleKeyDown({ key: "Enter", shiftKey: false, preventDefault, nativeEvent: { isComposing: true, keyCode: 229 } } as any);
    expect(input.handleSend).not.toHaveBeenCalled();
  });

  it("updates feedback only on the selected message", () => {
    const input = options();
    createChatWorkspaceMessageActions(input).handleMessageFeedbackChange("message-a", "like");
    const update = vi.mocked(input.setMessages).mock.calls[0][0] as (messages: ChatMessage[]) => ChatMessage[];
    const untouched = { ...failedMessage(), id: "message-b" };

    expect(update([failedMessage(), untouched])).toEqual([
      expect.objectContaining({ id: "message-a", user_feedback: "like" }),
      untouched,
    ]);
  });
});

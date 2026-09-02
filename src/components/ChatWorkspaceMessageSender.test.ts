import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../lib/chatWorkspaceState";

vi.mock("../lib/api", () => ({ api: { post: vi.fn() } }));
vi.mock("../lib/chatRuntimeErrors", () => ({ humanizeChatError: () => ({ message: "Visible provider failure" }) }));

import { api } from "../lib/api";
import { createChatWorkspaceMessageSender } from "./ChatWorkspaceMessageSender";

describe("synchronous chat failure after authoritative history refresh", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["quick", "assist"])("marks the persisted user bubble failed in %s mode", async (chatMode) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let messages: ChatMessage[] = [{ id: "previous-user", role: "user", content: "previous", status: "completed", conversation_id: "conversation-1", request_id: "previous-request" }];
    const setMessages = (update: (previous: ChatMessage[]) => ChatMessage[]) => { messages = update(messages); };
    vi.mocked(api.post).mockImplementation(async (_url, payload: any) => {
      // A realtime history response replaces the temporary ID before POST fails.
      messages = messages.map(message => message.request_id === payload.requestId ? { ...message, id: "persisted-user" } : message);
      throw { data: { error: "TEST_PROVIDER_FAILURE", message: "Visible provider failure" } };
    });
    const send = createChatWorkspaceMessageSender({
      uploadInFlightRef: { current: false }, isUploading: false, pendingAttachments: [], input: "test",
      editingRetryMessageIdRef: { current: null }, selectedId: "instance-1", chatMode, sending: false,
      selectedConversationId: "conversation-1", selectedConversationIdRef: { current: "conversation-1" },
      selectedIdRef: { current: "instance-1" }, activeChatGenerationRef: { current: 0 },
      activeChatRequestIdRef: { current: null }, messageLoadRequestIdRef: { current: 0 },
      activeSyncChatRequestRef: { current: null }, optimisticChatContextRef: { current: null },
      shouldScrollToBottomRef: { current: false }, setMessages, setInput: vi.fn(), setError: vi.fn(),
      setSending: vi.fn(), setLoadingMessages: vi.fn(), maybeRenameDefaultConversation: vi.fn(),
      t: (key: string) => key, reasoningEffort: "medium", temperature: 0.7,
    });

    await send();

    expect(messages.find(message => message.id === "persisted-user")).toMatchObject({
      status: "failed", error_code: "TEST_PROVIDER_FAILURE", error_message: "Visible provider failure",
    });
    expect(messages.find(message => message.id === "previous-user")).toMatchObject({ status: "completed" });
  });
});


it("keeps the draft and never submits to the old conversation during creation", async () => {
  vi.mocked(api.post).mockClear();
  const setInput = vi.fn(), setMessages = vi.fn(), showToast = vi.fn();
  await createChatWorkspaceMessageSender({
    conversationCreationInFlightRef: { current: true }, input: "keep my draft",
    selectedConversationId: "old", setInput, setMessages, showToast, t: (key: string) => key,
  })();
  expect(api.post).not.toHaveBeenCalled();
  expect(setInput).not.toHaveBeenCalled();
  expect(setMessages).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalled();
});

it("keeps the draft and never creates an empty conversation while history is restoring", async () => {
  vi.mocked(api.post).mockClear();
  const setInput = vi.fn(), setMessages = vi.fn(), showToast = vi.fn();
  await createChatWorkspaceMessageSender({
    loadingConversations: true,
    conversationCreationInFlightRef: { current: false },
    uploadInFlightRef: { current: false },
    isUploading: false,
    pendingAttachments: [],
    input: "keep restored draft",
    selectedId: "instance-1",
    selectedConversationId: null,
    selectedConversationIdRef: { current: null },
    setInput,
    setMessages,
    showToast,
    t: (key: string) => key,
  })();
  expect(api.post).not.toHaveBeenCalled();
  expect(setInput).not.toHaveBeenCalled();
  expect(setMessages).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.loadingConversations", "warning");
});

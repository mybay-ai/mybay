import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileConversationMessages, type ChatMessage } from "../lib/chatWorkspaceState";
import { MAX_CHAT_USER_MESSAGE_CHARS } from "../../shared/chatMessageContract";
import { createRunExecutionState } from "./chat-workspace/run/runReducer";
import { markRunMessagesStopped } from "./chat-workspace/run/runTerminalMessages";

vi.mock("../lib/api", () => ({ api: { post: vi.fn() } }));
vi.mock("../lib/chatRuntimeErrors", () => ({ humanizeChatError: () => ({ message: "test failure" }) }));
import { api } from "../lib/api";
import { createChatWorkspaceMessageSender } from "./ChatWorkspaceMessageSender";

function fixture(overrides: Record<string, unknown> = {}, initialMessages: ChatMessage[] = []) {
  let messages: ChatMessage[] = initialMessages;
  const context = {
    uploadInFlightRef: { current: false }, isUploading: false,
    input: "\nAFTER", pendingLongTexts: [{ id: "a", leadingText: "BEFORE\n", content: "MATERIAL" }],
    pendingAttachments: [{ id: "file-1", originalName: "test.txt", mimeType: "text/plain", size: 1 }],
    editingRetryMessageIdRef: { current: null }, selectedId: "instance-1", chatMode: "quick", sending: false,
    runsSupported: true, selectedConversationId: "conversation-1", selectedConversationIdRef: { current: "conversation-1" },
    selectedIdRef: { current: "instance-1" }, activeChatGenerationRef: { current: 0 },
    activeChatRequestIdRef: { current: null }, messageLoadRequestIdRef: { current: 0 },
    activeSyncChatRequestRef: { current: null }, optimisticChatContextRef: { current: null },
    shouldScrollToBottomRef: { current: false },
    setMessages: (update: (previous: ChatMessage[]) => ChatMessage[]) => { messages = update(messages); },
    setInput: vi.fn(), setError: vi.fn(), setSending: vi.fn(), setLoadingMessages: vi.fn(),
    setPendingAttachments: vi.fn(), setConversations: vi.fn(), maybeRenameDefaultConversation: vi.fn(),
    refreshAuthoritativeHistory: vi.fn(async () => {}),
    enqueueFollowUpMessage: vi.fn(() => true), showToast: vi.fn(),
    t: (key: string) => key, reasoningEffort: "balanced", temperature: 0.7,
    createChatRunWithRetry: vi.fn(async (_instanceId: string, _payload: unknown, _retryConcurrency: boolean, _isCurrent?: () => boolean) => ({ success: true, runId: "run-1" })),
    setActiveRunId: vi.fn(), setActiveRunConversationId: vi.fn(), initializeRunExecution: vi.fn(),
    setRunMetrics: vi.fn(), streamActiveRun: vi.fn(async () => {}),
    ...overrides,
  };
  return { context, send: createChatWorkspaceMessageSender(context), messages: () => messages };
}

describe("long-text sender integration", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.mocked(api.post).mockReset(); });

  it.each(["quick", "assist", "agent"])("sends full ordered text, not card IDs, through %s", async chatMode => {
    vi.useFakeTimers();
    vi.mocked(api.post).mockResolvedValue({ success: true, message: "ok" });
    const { context, send, messages } = fixture({ chatMode });
    await send();
    const payload = chatMode === "agent" ? context.createChatRunWithRetry.mock.calls[0]?.[1] : vi.mocked(api.post).mock.calls[0]?.[1];
    expect(payload).toMatchObject({ content: "BEFORE\nMATERIAL\nAFTER", attachmentIds: ["file-1"] });
    expect(payload).not.toHaveProperty("pendingLongTexts");
    expect(messages().find(message => message.role === "user")?.content).toBe("BEFORE\nMATERIAL\nAFTER");
    expect(context.setInput).toHaveBeenCalledWith("");
    await vi.runAllTimersAsync();
  });

  it("sends a card-only draft", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, message: "ok" });
    const { send } = fixture({ input: "", pendingLongTexts: [{ id: "a", leadingText: "", content: "MATERIAL" }] });
    await send();
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ content: "MATERIAL" });
  });

  it("queues an immutable text snapshot plus attachments and clears the accepted draft", async () => {
    const { context, send } = fixture({ sending: true });
    await send();
    expect(context.enqueueFollowUpMessage).toHaveBeenCalledWith("BEFORE\nMATERIAL\nAFTER", context.pendingAttachments);
    expect(context.setInput).toHaveBeenCalledWith("");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("retains the draft and attachments if enqueue rejects", async () => {
    const { context, send } = fixture({ sending: true, enqueueFollowUpMessage: vi.fn(() => false) });
    await send();
    expect(context.setInput).not.toHaveBeenCalled();
    expect(context.setPendingAttachments).not.toHaveBeenCalled();
  });

  it.each([false, true])("custom retry/queued dispatch does not mix or clear draft (running=%s)", async sending => {
    vi.mocked(api.post).mockResolvedValue({ success: true, message: "ok" });
    const { context, send } = fixture({ sending });
    await send(undefined, "RETRY", { attachments: [] });
    if (sending) expect(context.enqueueFollowUpMessage).toHaveBeenCalledWith("RETRY", []);
    else expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ content: "RETRY", attachmentIds: [] });
    expect(context.setInput).not.toHaveBeenCalled();
    expect(context.setPendingAttachments).not.toHaveBeenCalled();
  });

  it.each([
    { isUploading: true },
    { uploadInFlightRef: { current: true } },
    { chatMode: "agent", runsSupported: false },
    { pendingLongTexts: [{ id: "a", leadingText: "", content: "🙂".repeat(MAX_CHAT_USER_MESSAGE_CHARS) }] },
  ])("retains the complete draft on preflight rejection %#", async overrides => {
    const { context, send } = fixture(overrides);
    await send();
    expect(context.setInput).not.toHaveBeenCalled();
    expect(context.setPendingAttachments).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(context.showToast).toHaveBeenCalled();
  });

  it("retains the entire failed text in the user bubble for editing/retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.post).mockRejectedValue(new Error("test failure"));
    const { send, messages } = fixture();
    await send();
    expect(messages().find(message => message.role === "user")).toMatchObject({ content: "BEFORE\nMATERIAL\nAFTER", status: "failed" });
  });

  it.each(["checking", "disabled", "explicitly_unsupported", "unavailable"])("does not send or clear a restored Agent draft while capability is %s", async runsCapabilityState => {
    const { context, send, messages } = fixture({ chatMode: "agent", runsSupported: false, runsCapabilityState });
    await send();
    expect(api.post).not.toHaveBeenCalled();
    expect(context.createChatRunWithRetry).not.toHaveBeenCalled();
    expect(context.setInput).not.toHaveBeenCalled();
    expect(context.setPendingAttachments).not.toHaveBeenCalled();
    expect(context.showToast).toHaveBeenCalled();
    expect(messages()).toEqual([]);
  });

  it.each(["quick", "assist"])("retries a provider failure in %s without duplicating the user bubble or mixing a new draft", async chatMode => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.post)
      .mockRejectedValueOnce({ status: 503, data: { error: "TEST_PROVIDER_UNAVAILABLE" } })
      .mockResolvedValueOnce({ success: true, message: "retry succeeded", assistantMessageId: "retry-assistant" });
    const { context, send, messages } = fixture({ chatMode });
    await send();
    const failed = messages().find(message => message.role === "user")!;
    expect(failed.status).toBe("failed");
    context.setInput.mockClear();
    context.setPendingAttachments.mockClear();
    const retry = createChatWorkspaceMessageSender({ ...context, input: "UNSENT NEW DRAFT" });
    await retry(undefined, failed.content, { suppressOptimisticUser: true, replaceMessageId: failed.id, attachments: [] });
    expect(api.post).toHaveBeenCalledTimes(2);
    const first = vi.mocked(api.post).mock.calls[0][1] as any;
    const second = vi.mocked(api.post).mock.calls[1][1] as any;
    expect(second.content).toBe(first.content);
    expect(second.requestId).not.toBe(first.requestId); // Explicit retry is a new attempt.
    expect(messages().filter(message => message.role === "user")).toEqual([
      expect.objectContaining({ id: failed.id, content: failed.content, status: "completed" }),
    ]);
    expect(messages().filter(message => message.role === "assistant")).toEqual([
      expect.objectContaining({ id: "retry-assistant", content: "retry succeeded", status: "completed" }),
    ]);
    expect(context.setInput).not.toHaveBeenCalled();
    expect(context.setPendingAttachments).not.toHaveBeenCalled();
    expect(context.setSending).toHaveBeenLastCalledWith(false);
  });

  it.each(["quick", "assist", "agent"])("a late %s response cannot re-enable forced scrolling after the reader pauses", async chatMode => {
    vi.useFakeTimers();
    const { context, send } = fixture({ chatMode });
    const response = async () => {
      expect(context.shouldScrollToBottomRef.current).toBe(true);
      context.shouldScrollToBottomRef.current = false; // reader scrolls up while awaiting provider
      return { success: true, message: "ok", runId: "run-1" };
    };
    vi.mocked(api.post).mockImplementation(response);
    context.createChatRunWithRetry.mockImplementation(response);
    await send(); await vi.runAllTimersAsync();
    expect(context.shouldScrollToBottomRef.current).toBe(false);
  });

  it("background queued dispatch does not force scrolling", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, message: "ok" });
    const { context, send } = fixture();
    await send(undefined, "queued", { queuedMessageIds: ["queued-1"], attachments: [] });
    expect(context.shouldScrollToBottomRef.current).toBe(false);
  });

  it("enables bounded post-stop retries with a live request-context guard", async () => {
    vi.useFakeTimers();
    const { context, send } = fixture({ chatMode: "agent" });
    await send();
    const [, , retryConcurrency, isCurrent] = context.createChatRunWithRetry.mock.calls[0];
    expect(retryConcurrency).toBe(true);
    expect(isCurrent?.()).toBe(true);
    context.activeChatGenerationRef.current += 1;
    expect(isCurrent?.()).toBe(false);
    await vi.runAllTimersAsync();
  });

  it("makes an exhausted post-stop rejection retryable instead of claiming it is queued", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { context, send, messages } = fixture({ chatMode: "agent" });
    context.createChatRunWithRetry.mockRejectedValue({ status: 429, data: { error: "TOO_MANY_CONCURRENT_RUNS" } });
    await send();
    expect(messages()).toEqual([expect.objectContaining({
      role: "user", content: "BEFORE\nMATERIAL\nAFTER", status: "failed",
      error_code: "TOO_MANY_CONCURRENT_RUNS", error_message: "dashboard:chatWorkspace.agentRunBusyRetry",
    })]);
    expect(context.enqueueFollowUpMessage).not.toHaveBeenCalled();
    expect(context.setSending).toHaveBeenLastCalledWith(false);
    expect(context.setPendingAttachments).not.toHaveBeenCalled();
  });

  it("keeps a dequeued follow-up retryable after rejection without clearing a newer draft", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const queued: ChatMessage = { id: "queued-1", role: "user", content: "queued instruction", conversation_id: "conversation-1", status: "queued" };
    const { context, send, messages } = fixture({ chatMode: "agent" }, [queued]);
    context.createChatRunWithRetry.mockRejectedValue({ status: 409, data: { error: "ACTIVE_RUN_EXISTS" } });
    await send(undefined, queued.content, { suppressOptimisticUser: true, queuedMessageIds: [queued.id], attachments: [] });
    expect(messages()).toEqual([expect.objectContaining({
      id: queued.id, content: queued.content, status: "failed",
      error_message: "dashboard:chatWorkspace.agentRunBusyRetry",
    })]);
    expect(context.setInput).not.toHaveBeenCalled();
    expect(context.setPendingAttachments).not.toHaveBeenCalled();
    expect(context.setSending).toHaveBeenLastCalledWith(false);
  });

  it("binds the placeholder before the first stream event so stopped history cannot duplicate it", async () => {
    const { context, send, messages } = fixture({ chatMode: "agent" });
    let messagesWhenStreamStarted: ChatMessage[] = [];
    context.streamActiveRun.mockImplementation(async () => {
      messagesWhenStreamStarted = messages();
    });
    await send();
    const user = messages().find(message => message.role === "user")!;
    const assistant = messages().find(message => message.role === "assistant")!;
    expect(assistant).toMatchObject({ request_id: user.request_id, metadata: { runId: "run-1", requestId: user.request_id } });
    expect(messagesWhenStreamStarted.find(message => message.role === "assistant")).toMatchObject({
      request_id: user.request_id,
      metadata: { runId: "run-1", requestId: user.request_id },
    });
    const execution = createRunExecutionState({
      runId: "run-1", conversationId: "conversation-1", requestId: user.request_id!,
      assistantMessageId: assistant.id, status: "running",
    });
    const stopped = markRunMessagesStopped(messages(), execution, "stopped");
    const persisted: ChatMessage[] = [
      { ...user, id: "persisted-user", sequence_no: 1 },
      { ...assistant, id: "persisted-assistant", sequence_no: 2, status: "stopped" },
    ];
    const reconciled = reconcileConversationMessages(persisted, stopped, null, "conversation-1");
    expect(reconciled.map(message => message.id)).toEqual(["persisted-user", "persisted-assistant"]);
    expect(context.streamActiveRun).toHaveBeenCalledWith(
      "run-1",
      "instance-1",
      "conversation-1",
      expect.objectContaining({ submittedAt: expect.any(Number), acceptedAt: expect.any(Number) }),
    );
  });
});

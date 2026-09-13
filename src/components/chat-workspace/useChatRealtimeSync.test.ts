import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useChatRealtimeSync } from "./useChatRealtimeSync";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", () => ({ useEffect: (effect: () => void | (() => void)) => effects.push(effect) }));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn() } }));

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function storedMessage(id: string, role: "user" | "assistant", requestId = "request-a") {
  return { id, role, content: id, status: "completed", request_id: requestId, sequence_no: role === "user" ? 1 : 2 };
}

function options() {
  const listeners = new Map<string, (payload?: any) => void>();
  const socket = {
    on: vi.fn((event: string, listener: (payload?: any) => void) => listeners.set(event, listener)),
    off: vi.fn((event: string) => listeners.delete(event)),
  };
  return {
    input: {
      socket: socket as any,
      userId: "user-a",
      selectedIdRef: { current: "instance-a" },
      selectedConversationIdRef: { current: "conversation-a" },
      messageGenerationRef: { current: 1 },
      messageLoadRequestIdRef: { current: 0 },
      optimisticChatContextRef: { current: null },
      refreshAuthoritativeHistoryRef: { current: async () => {} },
      refreshConversationFiles: vi.fn(async () => {}),
      setMessages: vi.fn(),
      setNextCursorSeq: vi.fn(),
      setConversations: vi.fn(),
      setConversationsCursor: vi.fn(),
      showToast: vi.fn(),
      t: ((key: string) => key) as any,
    },
    listeners,
    socket,
  };
}

describe("chat realtime reconciliation", () => {
  beforeEach(() => { effects.length = 0; vi.clearAllMocks(); });

  it("ignores an authoritative response after the selected conversation changes", async () => {
    const request = deferred();
    vi.mocked(api.get).mockReturnValue(request.promise);
    const { input } = options();
    const { refreshAuthoritativeHistory } = useChatRealtimeSync(input);
    const pending = refreshAuthoritativeHistory("instance-a", "conversation-a");
    input.selectedConversationIdRef.current = "conversation-b";
    request.resolve({ success: true, messages: [storedMessage("assistant-a", "assistant")], nextCursorSeq: 2 });
    await pending;
    expect(input.setMessages).not.toHaveBeenCalled();
    expect(input.setNextCursorSeq).not.toHaveBeenCalled();
  });

  it("clears settled optimistic state only after an authoritative assistant arrives", async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      messages: [storedMessage("user-a", "user"), storedMessage("assistant-a", "assistant")],
      nextCursorSeq: null,
    });
    const { input } = options();
    input.optimisticChatContextRef.current = {
      requestId: "request-a", conversationId: "conversation-a", assistantMessageId: "assistant-a", phase: "settled",
    } as any;
    const { refreshAuthoritativeHistory } = useChatRealtimeSync(input);
    await refreshAuthoritativeHistory("instance-a", "conversation-a");
    expect(input.optimisticChatContextRef.current).toBeNull();
    expect(input.setMessages).toHaveBeenCalledTimes(1);
  });

  it("refreshes the selected conversation and unregisters the socket listener", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, conversations: [{ id: "conversation-a" }], nextCursor: "cursor-b" })
      .mockResolvedValueOnce({ success: true, messages: [], nextCursorSeq: null });
    const { input, listeners, socket } = options();
    useChatRealtimeSync(input);
    const cleanup = effects[0]();
    listeners.get("chat_workspace:conversation_updated")?.({
      userId: "user-a", instanceId: "instance-a", conversationId: "conversation-a",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(input.setConversations).toHaveBeenCalledWith([{ id: "conversation-a" }]);
    expect(input.setConversationsCursor).toHaveBeenCalledWith("cursor-b");
    expect(input.refreshConversationFiles).toHaveBeenCalledWith("instance-a", "conversation-a");
    if (cleanup) cleanup();
    expect(socket.off).toHaveBeenCalledWith("chat_workspace:conversation_updated", expect.any(Function));
  });
});

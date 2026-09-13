import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatHistoryViewport } from "./useChatHistoryViewport";

const jumpToLatest = vi.hoisted(() => vi.fn());
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("./useChatAutoFollow", () => ({
  useChatAutoFollow: vi.fn(() => ({
    isFollowing: false,
    pause: vi.fn(),
    jumpToLatest,
    prepareForPrepend: vi.fn(),
    revealMessage: vi.fn(),
  })),
}));

function options(searchNavigation: any = null) {
  return {
    scrollContainerRef: { current: null },
    messagesEndRef: { current: null },
    shouldScrollToBottomRef: { current: false },
    selectedId: "instance-a",
    selectedConversationId: "conversation-a",
    searchNavigation,
    messages: [{ id: "message-a", role: "assistant", content: "hello" }] as any,
    sending: false,
    loadingMessages: false,
    messageLoadRequestIdRef: { current: 2 },
    setLoadingMoreMessages: vi.fn(),
    setLoadingMessages: vi.fn(),
    setSearchNavigation: vi.fn(),
  };
}

describe("chat history viewport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalidates the search request before loading the latest window", () => {
    const input = options({ conversationId: "conversation-a", messageId: "message-a", sequenceNo: 10, nonce: 3, window: "search" });
    const result = useChatHistoryViewport(input);
    result.handleJumpToLatest();

    expect(input.messageLoadRequestIdRef.current).toBe(3);
    expect(input.setLoadingMoreMessages).toHaveBeenCalledWith(false);
    expect(input.setLoadingMessages).toHaveBeenCalledWith(true);
    const update = input.setSearchNavigation.mock.calls[0][0];
    expect(update(input.searchNavigation)).toMatchObject({ window: "latest-loading", nonce: 4 });
    expect(jumpToLatest).not.toHaveBeenCalled();
  });

  it("jumps within the current latest window without reloading history", () => {
    const input = options();
    const result = useChatHistoryViewport(input);
    result.handleJumpToLatest();

    expect(jumpToLatest).toHaveBeenCalledTimes(1);
    expect(input.setSearchNavigation).not.toHaveBeenCalled();
    expect(result.showJumpToLatest).toBe(true);
  });

  it("ignores navigation state from another conversation", () => {
    const input = options({ conversationId: "conversation-b", messageId: "message-b", sequenceNo: 1, nonce: 1, window: "search" });
    const result = useChatHistoryViewport(input);
    expect(result.selectedHistoryNavigation).toBeNull();
    expect(result.selectedSearch).toBeNull();
  });
});

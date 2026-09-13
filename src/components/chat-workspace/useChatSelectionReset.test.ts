import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSelectionReset } from "./useChatSelectionReset";

const effects = vi.hoisted(() => [] as Array<() => void>);
vi.mock("react", () => ({ useEffect: (effect: () => void) => effects.push(effect) }));

function options() {
  const controller = new AbortController();
  return {
    controller,
    input: {
      selectedId: "instance-a",
      selectedConversationId: "conversation-a",
      activeSyncChatRequestRef: { current: { controller, requestId: "request-a", instanceId: "instance-a", conversationId: "conversation-a" } },
      syncCancelReconciliationTimersRef: { current: [] as number[] },
      instanceGenerationRef: { current: 1 },
      messageGenerationRef: { current: 2 },
      activeChatGenerationRef: { current: 3 },
      activeChatRequestIdRef: { current: "request-a" as string | null },
      optimisticChatContextRef: { current: { requestId: "request-a" } as any },
      messageLoadRequestIdRef: { current: 4 },
      internallySelectingConversationRef: { current: false },
      clearQueuedFollowUps: vi.fn(),
      stopActiveRunStreams: vi.fn(),
      resetConversationsForInstance: vi.fn(),
      resetRunState: vi.fn(),
      setMessages: vi.fn(),
      setNextCursorSeq: vi.fn(),
      setError: vi.fn(),
      setLoadingMoreMessages: vi.fn(),
      setSending: vi.fn(),
      setActiveRunConversationId: vi.fn(),
    },
  };
}

describe("chat selection reset", () => {
  beforeEach(() => {
    effects.length = 0;
    vi.clearAllMocks();
  });

  it("fully resets instance-scoped requests and presentation state", () => {
    const { controller, input } = options();
    useChatSelectionReset(input);
    effects[0]();

    expect(controller.signal.aborted).toBe(true);
    expect(input.activeSyncChatRequestRef.current).toBeNull();
    expect(input.instanceGenerationRef.current).toBe(2);
    expect(input.messageGenerationRef.current).toBe(3);
    expect(input.activeChatGenerationRef.current).toBe(4);
    expect(input.messageLoadRequestIdRef.current).toBe(5);
    expect(input.clearQueuedFollowUps).toHaveBeenCalledTimes(1);
    expect(input.stopActiveRunStreams).toHaveBeenCalledTimes(1);
    expect(input.resetConversationsForInstance).toHaveBeenCalledTimes(1);
    expect(input.setMessages).toHaveBeenCalledWith([]);
    expect(input.setActiveRunConversationId).toHaveBeenCalledWith(null);
  });

  it("keeps restored messages when a conversation is selected internally", () => {
    const { input } = options();
    input.internallySelectingConversationRef.current = true;
    useChatSelectionReset(input);
    effects[1]();

    expect(input.internallySelectingConversationRef.current).toBe(false);
    expect(input.stopActiveRunStreams).not.toHaveBeenCalled();
    expect(input.resetRunState).not.toHaveBeenCalled();
    expect(input.messageGenerationRef.current).toBe(2);
    expect(input.setNextCursorSeq).toHaveBeenCalledWith(null);
    expect(input.setLoadingMoreMessages).toHaveBeenCalledWith(false);
  });

  it("invalidates active work for a manual conversation change", () => {
    const { controller, input } = options();
    useChatSelectionReset(input);
    effects[1]();

    expect(controller.signal.aborted).toBe(true);
    expect(input.messageGenerationRef.current).toBe(3);
    expect(input.activeChatGenerationRef.current).toBe(4);
    expect(input.messageLoadRequestIdRef.current).toBe(5);
    expect(input.stopActiveRunStreams).toHaveBeenCalledTimes(1);
    expect(input.resetRunState).toHaveBeenCalledTimes(1);
    expect(input.resetConversationsForInstance).not.toHaveBeenCalled();
  });
});

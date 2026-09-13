import { describe, expect, it, vi } from "vitest";
import { createChatWorkspaceSelectionActions } from "./createChatWorkspaceSelectionActions";

function options() {
  const controller = new AbortController();
  return {
    controller,
    input: {
      historyAbortRef: { current: controller },
      instanceGenerationRef: { current: 3 },
      messageLoadRequestIdRef: { current: 5 },
      selectionRevisionRef: { current: 7 },
      selectedIdRef: { current: "instance-a" },
      selectedConversationIdRef: { current: "conversation-a" as string | null },
      internallySelectingConversationRef: { current: false },
      setSelectedId: vi.fn(),
      setSelectedConversationId: vi.fn(),
      setChatMode: vi.fn(),
      setSearchNavigation: vi.fn(),
      setMessages: vi.fn(),
      setNextCursorSeq: vi.fn(),
      setLoadingMoreMessages: vi.fn(),
      setError: vi.fn(),
      modePreference: { modeFor: vi.fn(() => "agent" as const) },
      selectionPersistence: {
        rememberInstance: vi.fn(),
        rememberConversation: vi.fn(),
      },
    },
  };
}

describe("chat workspace selection actions", () => {
  it("switches the instance and conversation pair atomically", () => {
    const { controller, input } = options();
    const { selectInstanceId } = createChatWorkspaceSelectionActions(input);

    selectInstanceId("instance-b");

    expect(controller.signal.aborted).toBe(true);
    expect(input.instanceGenerationRef.current).toBe(4);
    expect(input.messageLoadRequestIdRef.current).toBe(6);
    expect(input.selectionRevisionRef.current).toBe(8);
    expect(input.selectedIdRef.current).toBe("instance-b");
    expect(input.selectedConversationIdRef.current).toBeNull();
    expect(input.setSelectedId).toHaveBeenCalledWith("instance-b");
    expect(input.setSelectedConversationId).toHaveBeenCalledWith(null);
    expect(input.setChatMode).toHaveBeenCalledWith("agent");
    expect(input.setMessages).toHaveBeenCalledWith([]);
    expect(input.selectionPersistence.rememberInstance).toHaveBeenCalledWith("instance-b");
  });

  it("invalidates manual conversation changes but preserves internal restoration state", () => {
    const manual = options();
    createChatWorkspaceSelectionActions(manual.input).selectConversationId("conversation-b");
    expect(manual.controller.signal.aborted).toBe(true);
    expect(manual.input.messageLoadRequestIdRef.current).toBe(6);
    expect(manual.input.setMessages).toHaveBeenCalledWith([]);
    expect(manual.input.selectionPersistence.rememberConversation).toHaveBeenCalledWith("instance-a", "conversation-b");

    const restored = options();
    restored.input.internallySelectingConversationRef.current = true;
    createChatWorkspaceSelectionActions(restored.input).selectConversationId("conversation-b");
    expect(restored.input.setMessages).not.toHaveBeenCalled();
    expect(restored.input.setLoadingMoreMessages).not.toHaveBeenCalled();
    expect(restored.input.setSelectedConversationId).toHaveBeenCalledWith("conversation-b");
  });

  it("does not invalidate requests when the selection is unchanged", () => {
    const { input } = options();
    createChatWorkspaceSelectionActions(input).selectInstanceId("instance-a");
    expect(input.instanceGenerationRef.current).toBe(3);
    expect(input.setSelectedId).not.toHaveBeenCalled();
    expect(input.selectionPersistence.rememberInstance).not.toHaveBeenCalled();
  });
});

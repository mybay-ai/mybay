import { describe, expect, it, vi } from "vitest";
import type { ConversationSearchResult } from "../../../shared/conversationSearch";
import { createChatWorkspaceNavigationActions } from "./createChatWorkspaceNavigationActions";

function options() {
  return {
    deployRoute: "/app/deploy",
    navigate: vi.fn(),
    handleCreateConversation: vi.fn(),
    selectInstanceId: vi.fn(),
    selectConversationId: vi.fn(),
    openMobileHistory: vi.fn(),
    openMobileWorkspace: vi.fn(),
    closeMobileOverlay: vi.fn(),
    closeMobileOverlayAndResetWorkspace: vi.fn(),
    setShowSettings: vi.fn(),
    setSidebarOpen: vi.fn(),
    setMessages: vi.fn(),
    setError: vi.fn(),
    setSearchNavigation: vi.fn(),
    now: vi.fn(() => 1234),
  };
}

function searchResult(overrides: Partial<ConversationSearchResult> = {}): ConversationSearchResult {
  return {
    conversation_id: "conversation-a",
    conversation_title: "Conversation A",
    project_id: null,
    matched_field: "message",
    message_id: "message-a",
    message_role: "assistant",
    sequence_no: 7,
    snippet: "match",
    matched_at: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("chat workspace navigation actions", () => {
  it("opens mobile panels after closing conflicting settings", () => {
    const input = options();
    const actions = createChatWorkspaceNavigationActions(input);

    actions.handleOpenMobileHistory();
    actions.handleOpenMobileWorkspace();

    expect(input.setShowSettings).toHaveBeenNthCalledWith(1, false);
    expect(input.setShowSettings).toHaveBeenNthCalledWith(2, false);
    expect(input.openMobileHistory).toHaveBeenCalledOnce();
    expect(input.openMobileWorkspace).toHaveBeenCalledOnce();
  });

  it("routes deployment and resets transient state when switching instances", () => {
    const input = options();
    const actions = createChatWorkspaceNavigationActions(input);

    actions.handleDeployNewInstance();
    actions.handleInstanceChange("instance-b");

    expect(input.navigate).toHaveBeenCalledWith("/app/deploy");
    expect(input.selectInstanceId).toHaveBeenCalledWith("instance-b");
    expect(input.setMessages).toHaveBeenCalledWith([]);
    expect(input.setError).toHaveBeenCalledWith(null);
    expect(input.closeMobileOverlayAndResetWorkspace).toHaveBeenCalledOnce();
  });

  it("toggles settings after closing mobile overlays", () => {
    const input = options();
    createChatWorkspaceNavigationActions(input).handleToggleSettings();

    expect(input.closeMobileOverlay).toHaveBeenCalledOnce();
    const toggle = input.setShowSettings.mock.calls[0]?.[0] as (current: boolean) => boolean;
    expect(toggle(false)).toBe(true);
    expect(toggle(true)).toBe(false);
  });

  it("preserves the project when creating a conversation from the sidebar", () => {
    const input = options();
    createChatWorkspaceNavigationActions(input).handleCreateConversationFromSidebar("project-a");

    expect(input.handleCreateConversation).toHaveBeenCalledWith("project-a");
    expect(input.closeMobileOverlay).toHaveBeenCalledOnce();
  });

  it("selects a conversation and clears stale search navigation", () => {
    const input = options();
    createChatWorkspaceNavigationActions(input).handleSelectConversation("conversation-b");

    expect(input.setSearchNavigation).toHaveBeenCalledWith(null);
    expect(input.selectConversationId).toHaveBeenCalledWith("conversation-b");
    expect(input.closeMobileOverlay).toHaveBeenCalledOnce();
  });

  it("builds deterministic navigation for a message search result", () => {
    const input = options();
    createChatWorkspaceNavigationActions(input).handleSelectSearchResult(searchResult());

    expect(input.setSearchNavigation).toHaveBeenCalledWith({
      conversationId: "conversation-a",
      messageId: "message-a",
      sequenceNo: 7,
      nonce: 1234,
      window: "search",
    });
    expect(input.selectConversationId).toHaveBeenCalledWith("conversation-a");
    expect(input.closeMobileOverlay).toHaveBeenCalledOnce();
  });

  it.each([
    { message_id: null },
    { sequence_no: null },
  ])("clears search navigation when the result has no message location", overrides => {
    const input = options();
    createChatWorkspaceNavigationActions(input).handleSelectSearchResult(searchResult(overrides));

    expect(input.setSearchNavigation).toHaveBeenCalledWith(null);
    expect(input.now).not.toHaveBeenCalled();
  });

  it("opens the collapsed desktop sidebar", () => {
    const input = options();
    createChatWorkspaceNavigationActions(input).handleOpenSidebar();
    expect(input.setSidebarOpen).toHaveBeenCalledWith(true);
  });
});

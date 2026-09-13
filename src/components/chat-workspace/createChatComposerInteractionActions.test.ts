import { describe, expect, it, vi } from "vitest";
import { createChatComposerInteractionActions } from "./createChatComposerInteractionActions";

function options(width: number | null = 390) {
  return {
    selectedIdRef: { current: "instance-a" },
    selectedConversationIdRef: { current: "conversation-a" as string | null },
    handleUploadFiles: vi.fn(),
    getViewportWidth: () => width,
    requestFrame: vi.fn((callback: () => void) => callback()),
    scrollToTop: vi.fn(),
  };
}

describe("chat composer page interactions", () => {
  it("uploads workspace files only for the current instance and conversation", () => {
    const input = options();
    const files = [{ name: "report.md" }] as File[];
    const accepted = createChatComposerInteractionActions(input)
      .handleAddWorkspaceFiles("instance-a", "conversation-a", files);

    expect(accepted).toBe(true);
    expect(input.handleUploadFiles).toHaveBeenCalledWith(files);
  });

  it.each([
    ["instance-b", "conversation-a"],
    ["instance-a", "conversation-b"],
  ])("rejects files from stale selection %s/%s", (instanceId, conversationId) => {
    const input = options();
    const accepted = createChatComposerInteractionActions(input)
      .handleAddWorkspaceFiles(instanceId, conversationId, []);

    expect(accepted).toBe(false);
    expect(input.handleUploadFiles).not.toHaveBeenCalled();
  });

  it.each([390, 767])("scrolls the page before the mobile keyboard opens at %spx", width => {
    const input = options(width);
    const handled = createChatComposerInteractionActions(input).handleComposerInputFocus();

    expect(handled).toBe(true);
    expect(input.requestFrame).toHaveBeenCalledOnce();
    expect(input.scrollToTop).toHaveBeenCalledOnce();
  });

  it.each([null, 768, 1440])("leaves non-mobile focus unchanged at %s", width => {
    const input = options(width);
    const handled = createChatComposerInteractionActions(input).handleComposerInputFocus();

    expect(handled).toBe(false);
    expect(input.requestFrame).not.toHaveBeenCalled();
    expect(input.scrollToTop).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createChatComposerCommandActions, resolveComposerCommandHelpKey } from "./createChatComposerCommandActions";

function options() {
  return {
    runtimeType: "hermes",
    handleCreateConversation: vi.fn(),
    handleClear: vi.fn(),
    handleCancelOrStop: vi.fn(),
    setDesktopWorkspaceTab: vi.fn(),
    selectMobileWorkspaceTab: vi.fn(),
    revealMobileWorkspaceTabOnNarrowViewport: vi.fn(() => false),
    closeMobileOverlay: vi.fn(),
    setShowSettings: vi.fn(),
    showToast: vi.fn(),
    t: ((key: string) => key) as any,
  };
}

describe("chat composer command actions", () => {
  it("routes lifecycle commands to their existing actions", () => {
    const input = options();
    const { handleComposerCommand } = createChatComposerCommandActions(input);

    handleComposerCommand("new");
    handleComposerCommand("clear");
    handleComposerCommand("stop");

    expect(input.handleCreateConversation).toHaveBeenCalledOnce();
    expect(input.handleClear).toHaveBeenCalledOnce();
    expect(input.handleCancelOrStop).toHaveBeenCalledOnce();
  });

  it.each([
    ["files", "files"],
    ["status", "steps"],
  ] as const)("opens the %s command in the matching workspace tab", (command, tab) => {
    const input = options();
    input.revealMobileWorkspaceTabOnNarrowViewport.mockReturnValue(true);
    createChatComposerCommandActions(input).handleComposerCommand(command);

    expect(input.setDesktopWorkspaceTab).toHaveBeenCalledWith(tab);
    expect(input.selectMobileWorkspaceTab).toHaveBeenCalledWith(tab);
    expect(input.revealMobileWorkspaceTabOnNarrowViewport).toHaveBeenCalledWith(tab);
    expect(input.setShowSettings).toHaveBeenCalledWith(false);
  });

  it("does not close desktop settings when the workspace stays inline", () => {
    const input = options();
    createChatComposerCommandActions(input).handleComposerCommand("files");
    expect(input.setShowSettings).not.toHaveBeenCalled();
  });

  it("closes mobile overlays before showing model settings", () => {
    const input = options();
    createChatComposerCommandActions(input).handleComposerCommand("model");
    expect(input.closeMobileOverlay).toHaveBeenCalledOnce();
    expect(input.setShowSettings).toHaveBeenCalledWith(true);
  });

  it("uses runtime-specific help copy", () => {
    expect(resolveComposerCommandHelpKey("PI")).toBe("dashboard:chatWorkspace.composerCommandHelpMessagePi");
    expect(resolveComposerCommandHelpKey("codex")).toBe("dashboard:chatWorkspace.composerCommandHelpMessage");

    const input = options();
    input.runtimeType = "pi";
    createChatComposerCommandActions(input).handleComposerCommand("help");
    expect(input.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.composerCommandHelpMessagePi", "info");
  });

  it.each(["agents", "call", "all"] as const)("leaves the internally handled %s command untouched", command => {
    const input = options();
    createChatComposerCommandActions(input).handleComposerCommand(command);
    expect(input.handleCreateConversation).not.toHaveBeenCalled();
    expect(input.setDesktopWorkspaceTab).not.toHaveBeenCalled();
    expect(input.showToast).not.toHaveBeenCalled();
  });
});

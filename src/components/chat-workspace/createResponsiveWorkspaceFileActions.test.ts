import { describe, expect, it, vi } from "vitest";
import { createResponsiveWorkspaceFileActions } from "./createResponsiveWorkspaceFileActions";

function options() {
  return {
    handleOpenInstanceFilePath: vi.fn(async () => {}),
    handleOpenConversationFile: vi.fn(async () => {}),
    handlePreviewConversationFile: vi.fn(async () => {}),
    revealMobileWorkspacePreview: vi.fn(),
  };
}

describe("responsive workspace file actions", () => {
  it("reveals the preview workspace after an instance file opens", async () => {
    const input = options();
    const actions = createResponsiveWorkspaceFileActions(input);
    await actions.handleOpenInstanceFileFromChat("/opt/data/report.md");

    expect(input.handleOpenInstanceFilePath).toHaveBeenCalledWith("/opt/data/report.md");
    expect(input.revealMobileWorkspacePreview).toHaveBeenCalledOnce();
  });

  it("reveals the preview workspace after a conversation file opens", async () => {
    const input = options();
    const file = { id: "file-a", name: "report.md" } as any;
    const actions = createResponsiveWorkspaceFileActions(input);
    await actions.handleOpenConversationFileFromChat(file);

    expect(input.handleOpenConversationFile).toHaveBeenCalledWith(file);
    expect(input.revealMobileWorkspacePreview).toHaveBeenCalledOnce();
  });

  it("does not reveal the workspace when preview loading fails", async () => {
    const input = options();
    input.handlePreviewConversationFile.mockRejectedValue(new Error("preview failed"));
    const actions = createResponsiveWorkspaceFileActions(input);

    await expect(actions.handlePreviewConversationFileFromWorkspace({ id: "file-a" } as any)).rejects.toThrow("preview failed");
    expect(input.revealMobileWorkspacePreview).not.toHaveBeenCalled();
  });
});

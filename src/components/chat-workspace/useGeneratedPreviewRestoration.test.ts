import { describe, expect, it, vi } from "vitest";
import { generatedPreviewSelectionStorageKey } from "./previewSelectionStorage";
import { restoreGeneratedPreviewSelection } from "./useGeneratedPreviewRestoration";

function storage(path: string) {
  const values = new Map([[generatedPreviewSelectionStorageKey("instance-a", "conversation-a"), path]]);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  };
}

describe("generated preview restoration", () => {
  it("opens a persisted preview when the artifact becomes ready", () => {
    const saved = storage("outputs/report.md");
    const open = vi.fn();
    restoreGeneratedPreviewSelection({
      storage: saved,
      selectedId: "instance-a",
      selectedConversationId: "conversation-a",
      generatedArtifacts: [{ path: "outputs/report.md", status: "ready" } as any],
      conversationFilePreview: null,
      handleOpenInstanceFilePath: open,
      clearConversationFilePreview: vi.fn(),
    });
    expect(open).toHaveBeenCalledWith("/opt/data/outputs/report.md");
  });

  it("clears a persisted missing artifact and its active preview", () => {
    const saved = storage("outputs/missing.md");
    const clearPreview = vi.fn();
    restoreGeneratedPreviewSelection({
      storage: saved,
      selectedId: "instance-a",
      selectedConversationId: "conversation-a",
      generatedArtifacts: [{ path: "outputs/missing.md", status: "missing" } as any],
      conversationFilePreview: { source: "instance", instancePath: "outputs/missing.md" },
      handleOpenInstanceFilePath: vi.fn(),
      clearConversationFilePreview: clearPreview,
    });
    expect(saved.values.size).toBe(0);
    expect(clearPreview).toHaveBeenCalledTimes(1);
  });
});

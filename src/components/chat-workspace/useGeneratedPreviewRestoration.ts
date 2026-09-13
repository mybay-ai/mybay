import { useEffect } from "react";
import type { GeneratedArtifact } from "./generatedArtifacts";
import { getGeneratedArtifactActionPath, isGeneratedArtifactPreviewable } from "./generatedArtifacts";
import { clearGeneratedPreviewSelection, loadGeneratedPreviewSelection } from "./previewSelectionStorage";

interface ConversationFilePreview {
  source?: string;
  instancePath?: string;
}

interface GeneratedPreviewRestorationOptions {
  storage: Pick<Storage, "getItem" | "removeItem"> | null;
  selectedId: string;
  selectedConversationId: string | null;
  generatedArtifacts: GeneratedArtifact[];
  conversationFilePreview: ConversationFilePreview | null;
  handleOpenInstanceFilePath: (path: string) => void | Promise<void>;
  clearConversationFilePreview: () => void;
}

export function restoreGeneratedPreviewSelection({
  storage,
  selectedId,
  selectedConversationId,
  generatedArtifacts,
  conversationFilePreview,
  handleOpenInstanceFilePath,
  clearConversationFilePreview,
}: GeneratedPreviewRestorationOptions) {
  if (!selectedId || !selectedConversationId) return;
  const selectedPath = loadGeneratedPreviewSelection(storage, selectedId, selectedConversationId);
  if (!selectedPath) return;
  const artifact = generatedArtifacts.find(item => item.path === selectedPath);
  if (artifact && isGeneratedArtifactPreviewable(artifact) && !conversationFilePreview) {
    void handleOpenInstanceFilePath(getGeneratedArtifactActionPath(artifact));
    return;
  }
  if (artifact?.status !== "missing") return;
  clearGeneratedPreviewSelection(storage, selectedId, selectedConversationId);
  if (conversationFilePreview?.source === "instance" && conversationFilePreview.instancePath === artifact.path) {
    clearConversationFilePreview();
  }
}

/** Restores the per-conversation generated artifact preview after history loads. */
export function useGeneratedPreviewRestoration(options: Omit<GeneratedPreviewRestorationOptions, "storage">) {
  useEffect(() => {
    restoreGeneratedPreviewSelection({
      ...options,
      storage: typeof window === "undefined" ? null : window.sessionStorage,
    });
  }, [
    options.clearConversationFilePreview,
    options.conversationFilePreview,
    options.generatedArtifacts,
    options.handleOpenInstanceFilePath,
    options.selectedConversationId,
    options.selectedId,
  ]);
}

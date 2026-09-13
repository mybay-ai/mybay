import type { PendingAttachment } from "./ChatInputBar";

interface ResponsiveWorkspaceFileActionsOptions {
  handleOpenInstanceFilePath: (filePath: string) => void | Promise<void>;
  handleOpenConversationFile: (file: PendingAttachment) => void | Promise<void>;
  handlePreviewConversationFile: (file: PendingAttachment) => void | Promise<void>;
  revealMobileWorkspacePreview: () => void;
}

/** Adds responsive workspace reveal behavior to successful file-open operations. */
export function createResponsiveWorkspaceFileActions({
  handleOpenInstanceFilePath,
  handleOpenConversationFile,
  handlePreviewConversationFile,
  revealMobileWorkspacePreview,
}: ResponsiveWorkspaceFileActionsOptions) {
  const handleOpenInstanceFileFromChat = async (filePath: string) => {
    await handleOpenInstanceFilePath(filePath);
    revealMobileWorkspacePreview();
  };

  const handleOpenConversationFileFromChat = async (file: PendingAttachment) => {
    await handleOpenConversationFile(file);
    revealMobileWorkspacePreview();
  };

  const handlePreviewConversationFileFromWorkspace = async (file: PendingAttachment) => {
    await handlePreviewConversationFile(file);
    revealMobileWorkspacePreview();
  };

  return {
    handleOpenInstanceFileFromChat,
    handleOpenConversationFileFromChat,
    handlePreviewConversationFileFromWorkspace,
  };
}

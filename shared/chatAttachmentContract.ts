export type ChatAttachmentConfig = {
  maxFiles: number | null;
  maxFileSizeBytes: number | null;
  allowedExtensions: string[] | null;
};

export const DEFAULT_CHAT_ATTACHMENT_CONFIG: ChatAttachmentConfig = {
  maxFiles: 20,
  maxFileSizeBytes: 100 * 1024 * 1024,
  allowedExtensions: [
    ".pdf", ".docx", ".txt", ".csv", ".xlsx",
    ".png", ".jpg", ".jpeg", ".webp", ".md", ".json", ".log"
  ]
};

export const DIRECT_CHAT_ATTACHMENT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".log"];

export function isChatAttachmentLimitReached(count: number, maxFiles: number | null): boolean {
  return maxFiles !== null && count >= maxFiles;
}

export function remainingChatAttachmentSlots(count: number, maxFiles: number | null): number | null {
  return maxFiles === null ? null : Math.max(0, maxFiles - count);
}

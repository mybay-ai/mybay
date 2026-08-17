import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { PendingAttachment } from "../ChatInputBar";

export function getRetryAttachments(message: ChatMessage, conversationFiles: PendingAttachment[]) {
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const ids = Array.isArray(metadata.attachmentIds)
    ? metadata.attachmentIds.filter((id): id is string => typeof id === "string")
    : [];
  const snapshots = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const snapshotIds = snapshots
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map(item => item.id)
    .filter((id): id is string => typeof id === "string");
  const attachmentIds = Array.from(new Set([...ids, ...snapshotIds]));
  const attachments = attachmentIds
    .map(id => conversationFiles.find(file => file.id === id))
    .filter((file): file is PendingAttachment => Boolean(file));
  const availableIds = new Set(attachments.map(file => file.id));
  return {
    attachments,
    unavailableIds: attachmentIds.filter(id => !availableIds.has(id))
  };
}

import type { PendingAttachment } from "./ChatInputBar";

export function generateUUIDv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let uuid = "";
    for (let index = 0; index < 16; index++) {
      if (index === 4 || index === 6 || index === 8 || index === 10) uuid += "-";
      uuid += bytes[index].toString(16).padStart(2, "0");
    }
    return uuid;
  }
  const error = new Error("SECURE_RANDOM_UNAVAILABLE");
  (error as any).code = "SECURE_RANDOM_UNAVAILABLE";
  throw error;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type QueuedFollowUp = {
  id: string;
  content: string;
  instanceId: string;
  conversationId: string | null;
  createdAt: number;
  attachments: PendingAttachment[];
};

export function buildOptimisticAttachmentMetadata(attachments: PendingAttachment[]) {
  return attachments.length > 0 ? {
    attachmentIds: attachments.map((file) => file.id),
    attachments: attachments.map((file) => ({ ...file })),
  } : undefined;
}

export type SendOptions = {
  suppressOptimisticUser?: boolean;
  queuedMessageIds?: string[];
  replaceMessageId?: string;
  attachments?: PendingAttachment[];
};

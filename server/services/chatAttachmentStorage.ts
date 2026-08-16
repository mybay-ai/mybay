import fs from "node:fs";
import path from "node:path";

function assertSafeSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value || "")) throw new Error(`Invalid ${label}.`);
}

export function resolveConversationAttachmentDirectory(
  instanceId: string,
  conversationId: string,
  dataRoot = path.resolve(process.cwd(), "data")
) {
  assertSafeSegment(instanceId, "instance identifier");
  assertSafeSegment(conversationId, "conversation identifier");
  const chatUploadsRoot = path.resolve(dataRoot, "instances", instanceId, "chat_uploads");
  const conversationDir = path.resolve(chatUploadsRoot, conversationId);
  if (!conversationDir.startsWith(chatUploadsRoot + path.sep)) throw new Error("Invalid attachment directory path.");
  return conversationDir;
}

export async function deleteConversationAttachmentDirectory(
  instanceId: string,
  conversationId: string,
  dataRoot?: string
) {
  const conversationDir = resolveConversationAttachmentDirectory(instanceId, conversationId, dataRoot);
  await fs.promises.rm(conversationDir, { recursive: true, force: true });
}

export async function deleteChatAttachmentFile(input: {
  instanceId: string;
  conversationId: string;
  storagePath: string;
  dataRoot?: string;
}) {
  const conversationDir = resolveConversationAttachmentDirectory(
    input.instanceId,
    input.conversationId,
    input.dataRoot
  );
  const storagePath = path.resolve(input.storagePath);
  if (!storagePath.startsWith(conversationDir + path.sep)) throw new Error("Invalid attachment file path.");
  const stat = await fs.promises.lstat(storagePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Attachment path is not a regular file.");
  await fs.promises.unlink(storagePath);
  await fs.promises.rmdir(conversationDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  });
}

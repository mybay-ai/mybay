import fs from "node:fs";
import path from "node:path";
import { filesRepo, type FileRecord } from "../repositories/filesRepo";

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

export async function inspectChatAttachmentFile(input: {
  instanceId: string;
  conversationId: string;
  storagePath: string;
  dataRoot?: string;
}) {
  const conversationDir = resolveConversationAttachmentDirectory(input.instanceId, input.conversationId, input.dataRoot);
  const storagePath = path.resolve(input.storagePath);
  if (!storagePath.startsWith(conversationDir + path.sep)) throw new Error("Invalid attachment file path.");
  try {
    const stat = await fs.promises.lstat(storagePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Attachment path is not a regular file.");
    const [realConversationDir, realStoragePath] = await Promise.all([
      fs.promises.realpath(conversationDir),
      fs.promises.realpath(storagePath),
    ]);
    if (!realStoragePath.startsWith(realConversationDir + path.sep)) throw new Error("Invalid attachment file path.");
    return { exists: true as const, storagePath: realStoragePath };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { exists: false as const, storagePath };
    throw error;
  }
}

export async function deleteChatAttachmentFile(input: {
  instanceId: string;
  conversationId: string;
  storagePath: string;
  dataRoot?: string;
}) {
  const conversationDir = resolveConversationAttachmentDirectory(input.instanceId, input.conversationId, input.dataRoot);
  const inspected = await inspectChatAttachmentFile(input);
  if (!inspected.exists) {
    const missing = new Error("Attachment file is missing.") as NodeJS.ErrnoException;
    missing.code = "ENOENT";
    throw missing;
  }
  await fs.promises.unlink(inspected.storagePath);
  await fs.promises.rmdir(conversationDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  });
}

export async function purgeDeletedChatAttachments(options: {
  limit?: number;
  dataRoot?: string;
  listPending?: (limit: number) => Promise<FileRecord[]>;
  markComplete?: (id: string) => Promise<unknown>;
} = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const listPending = options.listPending ?? ((value) => filesRepo.listPendingDeleted(value));
  const markComplete = options.markComplete ?? ((id) => filesRepo.markCleanupComplete(id));
  const rows = await listPending(limit);
  let purged = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (!row.instance_id || !row.conversation_id) throw new Error("Invalid attachment ownership metadata.");
      await deleteChatAttachmentFile({
        instanceId: row.instance_id,
        conversationId: row.conversation_id,
        storagePath: row.storage_path,
        dataRoot: options.dataRoot,
      });
      await markComplete(row.id);
      purged += 1;
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        await markComplete(row.id);
        purged += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { inspected: rows.length, purged, failed };
}

export async function purgeOrphanChatAttachments(options: {
  limit?: number;
  minimumAgeMs?: number;
  nowMs?: number;
  dataRoot?: string;
  isActive?: (input: { instanceId: string; conversationId: string; filename: string }) => Promise<boolean>;
} = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const minimumAgeMs = Math.max(0, options.minimumAgeMs ?? 60 * 60 * 1000);
  const nowMs = options.nowMs ?? Date.now();
  const dataRoot = path.resolve(options.dataRoot ?? path.resolve(process.cwd(), "data"));
  const instancesRoot = path.resolve(dataRoot, "instances");
  const isActive = options.isActive ?? ((input) => filesRepo.hasActiveStorageIdentity(input.instanceId, input.conversationId, input.filename));
  if (!fs.existsSync(instancesRoot)) return { inspected: 0, purged: 0, failed: 0 };

  let inspected = 0;
  let purged = 0;
  let failed = 0;
  outer: for (const instanceEntry of await fs.promises.readdir(instancesRoot, { withFileTypes: true })) {
    if (!instanceEntry.isDirectory() || instanceEntry.isSymbolicLink()) continue;
    const uploadsRoot = path.join(instancesRoot, instanceEntry.name, "chat_uploads");
    let uploadStat: fs.Stats;
    try {
      uploadStat = await fs.promises.lstat(uploadsRoot);
    } catch (error: any) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!uploadStat.isDirectory() || uploadStat.isSymbolicLink()) continue;
    for (const conversationEntry of await fs.promises.readdir(uploadsRoot, { withFileTypes: true })) {
      if (!conversationEntry.isDirectory() || conversationEntry.isSymbolicLink()) continue;
      const conversationRoot = path.join(uploadsRoot, conversationEntry.name);
      for (const fileEntry of await fs.promises.readdir(conversationRoot, { withFileTypes: true })) {
        if (inspected >= limit) break outer;
        if (!fileEntry.isFile() || fileEntry.isSymbolicLink()) continue;
        const filePath = path.join(conversationRoot, fileEntry.name);
        const stat = await fs.promises.lstat(filePath);
        if (nowMs - stat.mtimeMs < minimumAgeMs) continue;
        inspected += 1;
        try {
          if (await isActive({ instanceId: instanceEntry.name, conversationId: conversationEntry.name, filename: fileEntry.name })) continue;
          await deleteChatAttachmentFile({
            instanceId: instanceEntry.name,
            conversationId: conversationEntry.name,
            storagePath: filePath,
            dataRoot,
          });
          purged += 1;
        } catch {
          failed += 1;
        }
      }
    }
  }
  return { inspected, purged, failed };
}

export async function reconcileChatAttachmentStorage() {
  const deleted = await purgeDeletedChatAttachments();
  const orphaned = await purgeOrphanChatAttachments();
  return { deleted, orphaned };
}

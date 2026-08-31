import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
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
  try {
    inspectConversationAttachmentDirectory(instanceId, conversationId, dataRoot);
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await fs.promises.rm(conversationDir, { recursive: true, force: true });
}

// Anchor every managed component, not only the final file: a replaced ancestor
// must not redirect an upload, read, or cleanup into another conversation.
export function inspectConversationAttachmentDirectory(
  instanceId: string,
  conversationId: string,
  dataRoot = path.resolve(process.cwd(), "data"),
  create = false,
) {
  const directory = resolveConversationAttachmentDirectory(instanceId, conversationId, dataRoot);
  let current = path.resolve(dataRoot);
  const root = fs.realpathSync(current);
  for (const segment of path.relative(current, directory).split(path.sep)) {
    current = path.join(current, segment);
    if (create) {
      try { fs.mkdirSync(current, { mode: 0o755 }); }
      catch (error: any) { if (error?.code !== "EEXIST") throw error; }
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()
      || fs.realpathSync(current) !== path.join(root, path.relative(path.resolve(dataRoot), current))) {
      throw new Error("Invalid attachment directory path.");
    }
  }
  return directory;
}

export async function inspectChatAttachmentFile(input: {
  instanceId: string;
  conversationId: string;
  storagePath: string;
  dataRoot?: string;
}) {
  const conversationDir = resolveConversationAttachmentDirectory(input.instanceId, input.conversationId, input.dataRoot);
  const storagePath = path.resolve(input.storagePath);
  if (path.dirname(storagePath) !== conversationDir) throw new Error("Invalid attachment file path.");
  try {
    inspectConversationAttachmentDirectory(input.instanceId, input.conversationId, input.dataRoot);
    const stat = await fs.promises.lstat(storagePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw new Error("Attachment path is not a regular file.");
    const [realConversationDir, realStoragePath] = await Promise.all([
      fs.promises.realpath(conversationDir),
      fs.promises.realpath(storagePath),
    ]);
    if (!realStoragePath.startsWith(realConversationDir + path.sep)) throw new Error("Invalid attachment file path.");
    return { exists: true as const, storagePath: realStoragePath, stat };
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

export async function readChatAttachmentText(input: {
  instanceId: string;
  conversationId: string;
  storagePath: string;
  expectedSize?: number | null;
  dataRoot?: string;
}, maxCharacters = 12000) {
  const inspected = await inspectChatAttachmentFile(input);
  if (!inspected.exists) throw new Error("Attachment file is missing.");
  const limit = Math.max(0, Math.min(12000, Math.floor(maxCharacters)));
  // NONBLOCK also prevents a file swapped for a FIFO from hanging the request.
  const handle = await fs.promises.open(inspected.storagePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== inspected.stat.dev || stat.ino !== inspected.stat.ino
      || (input.expectedSize != null && stat.size !== input.expectedSize)) {
      throw new Error("Attachment file changed.");
    }
    const buffer = Buffer.alloc(limit * 4 + 4);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const decoder = new StringDecoder("utf8");
    const raw = decoder.write(buffer.subarray(0, offset)) + (offset >= stat.size ? decoder.end() : "");
    let content = raw.slice(0, limit);
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
    return { content, truncated: raw.length > content.length || stat.size > offset };
  } finally {
    await handle.close();
  }
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

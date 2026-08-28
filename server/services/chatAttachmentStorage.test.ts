import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteChatAttachmentFile,
  deleteConversationAttachmentDirectory,
  purgeDeletedChatAttachments,
  purgeOrphanChatAttachments,
} from "./chatAttachmentStorage";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mybay-chat-attachment-"));
  roots.push(root);
  const dir = path.join(root, "instances", "instance-1", "chat_uploads", "conversation-1");
  await fs.promises.mkdir(dir, { recursive: true });
  return { root, dir };
}

describe("chat attachment storage cleanup", () => {
  it("deletes a physical attachment and removes its empty conversation directory", async () => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "file.txt");
    await fs.promises.writeFile(file, "hello");
    await deleteChatAttachmentFile({ instanceId: "instance-1", conversationId: "conversation-1", storagePath: file, dataRoot: root });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("deletes all physical attachments when a conversation is removed", async () => {
    const { root, dir } = await fixture();
    await fs.promises.writeFile(path.join(dir, "one.txt"), "one");
    await fs.promises.writeFile(path.join(dir, "two.txt"), "two");
    await deleteConversationAttachmentDirectory("instance-1", "conversation-1", root);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("rejects paths outside the conversation directory", async () => {
    const { root } = await fixture();
    const outside = path.join(root, "outside.txt");
    await fs.promises.writeFile(outside, "keep");
    await expect(deleteChatAttachmentFile({ instanceId: "instance-1", conversationId: "conversation-1", storagePath: outside, dataRoot: root })).rejects.toThrow("Invalid attachment file path");
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("purges soft-deleted bytes and marks their tombstones complete", async () => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "deleted.txt");
    await fs.promises.writeFile(file, "deleted");
    const completed: string[] = [];

    const result = await purgeDeletedChatAttachments({
      dataRoot: root,
      listPending: async () => [{
        id: "file-1",
        owner_id: "owner-1",
        instance_id: "instance-1",
        conversation_id: "conversation-1",
        original_name: "deleted.txt",
        filename: "deleted.txt",
        mime_type: "text/plain",
        size: 7,
        storage_path: file,
        deleted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }],
      markComplete: async (id) => { completed.push(id); },
    });

    expect(result).toEqual({ inspected: 1, purged: 1, failed: 0 });
    expect(completed).toEqual(["file-1"]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("treats already-missing deleted bytes as completed cleanup", async () => {
    const { root, dir } = await fixture();
    const completed: string[] = [];
    const result = await purgeDeletedChatAttachments({
      dataRoot: root,
      listPending: async () => [{
        id: "file-missing",
        owner_id: "owner-1",
        instance_id: "instance-1",
        conversation_id: "conversation-1",
        filename: "missing.txt",
        mime_type: "text/plain",
        size: 0,
        storage_path: path.join(dir, "missing.txt"),
        deleted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }],
      markComplete: async (id) => { completed.push(id); },
    });

    expect(result).toEqual({ inspected: 1, purged: 1, failed: 0 });
    expect(completed).toEqual(["file-missing"]);
  });

  it("purges only old orphan bytes and preserves active or recent uploads", async () => {
    const { root, dir } = await fixture();
    const orphan = path.join(dir, "orphan.txt");
    const active = path.join(dir, "active.txt");
    const recent = path.join(dir, "recent.txt");
    await Promise.all([
      fs.promises.writeFile(orphan, "orphan"),
      fs.promises.writeFile(active, "active"),
      fs.promises.writeFile(recent, "recent"),
    ]);
    const nowMs = Date.now();
    const old = new Date(nowMs - 2 * 60 * 60 * 1000);
    await Promise.all([fs.promises.utimes(orphan, old, old), fs.promises.utimes(active, old, old)]);

    const result = await purgeOrphanChatAttachments({
      dataRoot: root,
      nowMs,
      minimumAgeMs: 60 * 60 * 1000,
      isActive: async ({ filename }) => filename === "active.txt",
    });

    expect(result).toEqual({ inspected: 2, purged: 1, failed: 0 });
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(active)).toBe(true);
    expect(fs.existsSync(recent)).toBe(true);
  });
});

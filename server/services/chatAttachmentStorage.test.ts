import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteChatAttachmentFile, deleteConversationAttachmentDirectory } from "./chatAttachmentStorage";

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
});

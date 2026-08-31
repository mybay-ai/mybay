import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveInstanceAuthority: vi.fn(),
  resolveConversationAuthority: vi.fn(),
  resolveConversationFilesAuthority: vi.fn(),
  inspectChatAttachmentFile: vi.fn(),
}));

vi.mock("../services/instances/resourceAuthorityService", () => mocks);
vi.mock("../services/chatAttachmentStorage", () => mocks);

import { loadAndValidateChatAttachments } from "./chatAttachments";

const instanceAuthority = {
  ok: true as const,
  actor: { kind: "user" as const, id: "owner-a" },
  instance: { id: "instance-a", owner_id: "owner-a", user_id: "owner-a" },
  ownerId: "owner-a",
};
const conversationAuthority = {
  ...instanceAuthority,
  conversation: { id: "conversation-a", user_id: "owner-a", instance_id: "instance-a" },
};
const fileId = "11111111-1111-4111-8111-111111111111";

describe("chat attachment authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectChatAttachmentFile.mockResolvedValue({ exists: true, stat: { size: 5 } });
    mocks.resolveInstanceAuthority.mockResolvedValue(instanceAuthority);
    mocks.resolveConversationAuthority.mockResolvedValue(conversationAuthority);
    mocks.resolveConversationFilesAuthority.mockResolvedValue({
      ok: true,
      files: [{ id: fileId, owner_id: "owner-a", instance_id: "instance-a", conversation_id: "conversation-a", filename: "file.txt", storage_path: "/data/file.txt", size: 5 }],
    });
  });

  it("resolves the complete owner-instance-conversation-file chain", async () => {
    await expect(loadAndValidateChatAttachments({
      attachmentIds: [fileId],
      userId: "owner-a",
      instanceId: "instance-a",
      conversationId: "conversation-a",
    })).resolves.toHaveLength(1);
    expect(mocks.resolveInstanceAuthority).toHaveBeenCalledWith({
      actor: { kind: "user", id: "owner-a" },
      instanceId: "instance-a",
    });
    expect(mocks.resolveConversationFilesAuthority).toHaveBeenCalledWith({
      conversation: conversationAuthority,
      fileIds: [fileId],
    });
  });

  it("rejects duplicate IDs before any resource lookup", async () => {
    await expect(loadAndValidateChatAttachments({
      attachmentIds: [fileId, fileId],
      userId: "owner-a",
      instanceId: "instance-a",
      conversationId: "conversation-a",
    })).rejects.toMatchObject({ status: 400, error: "INVALID_REQUEST" });
    expect(mocks.resolveInstanceAuthority).not.toHaveBeenCalled();
  });

  it.each([
    { exists: false },
    { exists: true, stat: { size: 99 } },
  ])("rejects missing or modified physical attachments before starting work", async (result) => {
    mocks.inspectChatAttachmentFile.mockResolvedValue(result);
    await expect(loadAndValidateChatAttachments({ attachmentIds: [fileId], userId: "owner-a", instanceId: "instance-a", conversationId: "conversation-a" }))
      .rejects.toMatchObject({ status: 409, error: "ATTACHMENT_UNAVAILABLE" });
  });

  it("does not disclose physical paths when inspection fails", async () => {
    mocks.inspectChatAttachmentFile.mockRejectedValue(new Error("private/path"));
    await expect(loadAndValidateChatAttachments({ attachmentIds: [fileId], userId: "owner-a", instanceId: "instance-a", conversationId: "conversation-a" }))
      .rejects.toMatchObject({ status: 409, error: "ATTACHMENT_UNAVAILABLE", message: expect.not.stringContaining("private/path") });
  });

  it("rejects a supplied authority context from another conversation", async () => {
    await expect(loadAndValidateChatAttachments({
      attachmentIds: [fileId],
      userId: "owner-a",
      instanceId: "instance-a",
      conversationId: "conversation-b",
      authority: conversationAuthority,
    })).rejects.toMatchObject({ status: 403, error: "FORBIDDEN" });
    expect(mocks.resolveConversationFilesAuthority).not.toHaveBeenCalled();
  });

  it("does not reveal whether a foreign attachment exists", async () => {
    mocks.resolveConversationFilesAuthority.mockResolvedValue({ ok: false, status: 404, code: "FILE_NOT_FOUND" });
    await expect(loadAndValidateChatAttachments({
      attachmentIds: [fileId],
      userId: "owner-a",
      instanceId: "instance-a",
      conversationId: "conversation-a",
    })).rejects.toMatchObject({ status: 404, error: "FILE_NOT_FOUND" });
  });
});

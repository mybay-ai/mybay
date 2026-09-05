import { describe, expect, it } from "vitest";
import { buildAgentAttachmentContextForPrompt, buildChatAttachmentMetadata, getAttachmentDisplayName, isChatAttachmentDeleted } from "./chatAttachments";

describe("chat attachment message metadata", () => {
  it("stores an immutable display snapshot alongside attachment ids", () => {
    const metadata = buildChatAttachmentMetadata([{
      id: "file-id",
      owner_id: "owner-id",
      instance_id: "instance-id",
      conversation_id: "conversation-id",
      deleted_at: null,
      original_name: "report.pdf",
      filename: "stored.pdf",
      mime_type: "application/pdf",
      size: 123,
      storage_path: "/tmp/stored.pdf",
    }]);
    expect(metadata).toEqual({
      attachmentIds: ["file-id"],
      attachments: [{ id: "file-id", originalName: "report.pdf", mimeType: "application/pdf", size: 123 }],
    });
  });

  it("does not treat legacy local records without deleted_at as deleted", () => {
    expect(isChatAttachmentDeleted({})).toBe(false);
    expect(isChatAttachmentDeleted({ deleted_at: undefined })).toBe(false);
    expect(isChatAttachmentDeleted({ deleted_at: null })).toBe(false);
    expect(isChatAttachmentDeleted({ deleted_at: "" })).toBe(false);
    expect(isChatAttachmentDeleted({ deleted_at: "2026-08-16T12:00:00.000Z" })).toBe(true);
  });

  it("repairs a legacy mojibake display name before it reaches chat metadata", () => {
    const original_name = Buffer.from("8月3日.mp4", "utf8").toString("latin1");
    expect(getAttachmentDisplayName({ original_name, filename: "stored.mp4" })).toBe("8月3日.mp4");
  });

  it("exposes only the mounted instance path and safe metadata to an Agent Runtime", () => {
    const context = buildAgentAttachmentContextForPrompt([{
      conversation_id: "chat-1",
      original_name: "report.txt",
      filename: "stored-1.txt",
      mime_type: "text/plain",
      size: 42,
      storage_path: "C:/host/private/data/instances/agent/chat_uploads/chat-1/stored-1.txt",
    }]);
    expect(context).toContain("/opt/data/chat_uploads/chat-1/stored-1.txt");
    expect(context).toContain("report.txt");
    expect(context).not.toContain("C:/host/private");
  });
});

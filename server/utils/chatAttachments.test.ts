import { describe, expect, it } from "vitest";
import { buildChatAttachmentMetadata, isChatAttachmentDeleted } from "./chatAttachments";

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
});

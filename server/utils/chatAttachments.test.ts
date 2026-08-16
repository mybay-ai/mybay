import { describe, expect, it } from "vitest";
import { buildChatAttachmentMetadata } from "./chatAttachments";

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
});

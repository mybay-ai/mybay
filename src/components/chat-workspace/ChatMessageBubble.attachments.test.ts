import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { getMessageAttachments } from "./ChatMessageBubble";

describe("message attachment rendering model", () => {
  it("uses the stored snapshot after a file has been deleted", () => {
    const message: ChatMessage = {
      id: "message-1",
      role: "user",
      content: "review this",
      metadata: {
        attachmentIds: ["file-1"],
        attachments: [{ id: "file-1", originalName: "report.pdf", mimeType: "application/pdf", size: 42 }],
      },
    };
    expect(getMessageAttachments(message, [])).toEqual([{
      available: false,
      file: { id: "file-1", originalName: "report.pdf", mimeType: "application/pdf", size: 42 },
    }]);
  });

  it("keeps old attachmentIds-only messages compatible with active conversation files", () => {
    const message: ChatMessage = { id: "message-1", role: "user", content: "review this", metadata: { attachmentIds: ["file-1"] } };
    const file = { id: "file-1", originalName: "notes.txt", mimeType: "text/plain", size: 10 };
    expect(getMessageAttachments(message, [file])).toEqual([{ available: true, file }]);
  });
});

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { getRetryAttachments } from "./retryAttachments";

describe("getRetryAttachments", () => {
  it("restores only attachments that are still available", () => {
    const message: ChatMessage = {
      id: "u1",
      role: "user",
      content: "inspect",
      metadata: { attachmentIds: ["file-1", "deleted-file"] }
    };
    const result = getRetryAttachments(message, [
      { id: "file-1", originalName: "one.txt", mimeType: "text/plain", size: 3 }
    ]);
    expect(result.attachments.map(file => file.id)).toEqual(["file-1"]);
    expect(result.unavailableIds).toEqual(["deleted-file"]);
  });

  it("also reads attachment ids from metadata snapshots", () => {
    const message: ChatMessage = {
      id: "u1",
      role: "user",
      content: "inspect",
      metadata: { attachments: [{ id: "file-1", originalName: "one.txt" }] }
    };
    expect(getRetryAttachments(message, [
      { id: "file-1", originalName: "one.txt", mimeType: "text/plain", size: 3 }
    ]).attachments).toHaveLength(1);
  });
});

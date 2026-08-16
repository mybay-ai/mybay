import { describe, expect, it } from "vitest";
import { getChatAttachmentConfig } from "./chatAttachmentConfig";

describe("chat attachment configuration", () => {
  it("uses safe open-source defaults", () => {
    const config = getChatAttachmentConfig({});
    expect(config.maxFiles).toBe(20);
    expect(config.maxFileSizeBytes).toBe(100 * 1024 * 1024);
    expect(config.allowedExtensions).toContain(".json");
  });

  it("supports explicit unlimited settings", () => {
    const config = getChatAttachmentConfig({
      CHAT_ATTACHMENT_MAX_FILES: "unlimited",
      CHAT_ATTACHMENT_MAX_FILE_MB: "0",
      CHAT_ATTACHMENT_ALLOWED_EXTENSIONS: "*",
    });
    expect(config).toEqual({ maxFiles: null, maxFileSizeBytes: null, allowedExtensions: null });
  });

  it("normalizes configured extensions and rejects invalid numeric values", () => {
    const config = getChatAttachmentConfig({
      CHAT_ATTACHMENT_MAX_FILES: "invalid",
      CHAT_ATTACHMENT_MAX_FILE_MB: "25",
      CHAT_ATTACHMENT_ALLOWED_EXTENSIONS: "txt, .PDF, txt",
    });
    expect(config.maxFiles).toBe(20);
    expect(config.maxFileSizeBytes).toBe(25 * 1024 * 1024);
    expect(config.allowedExtensions).toEqual([".txt", ".pdf"]);
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatWorkspaceDropOverlay, resolveChatWorkspaceDropState } from "./ChatWorkspaceDropOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number | null }) => `${key}${options?.count == null ? "" : `:${options.count}`}` }),
}));

describe("chat workspace drop overlay", () => {
  it.each([
    [{ isChatReady: false, hasActiveConversation: false, attachmentLimitReached: true, isUploading: true }, "not-ready"],
    [{ isChatReady: true, hasActiveConversation: false, attachmentLimitReached: true, isUploading: true }, "no-conversation"],
    [{ isChatReady: true, hasActiveConversation: true, attachmentLimitReached: true, isUploading: true }, "limit"],
    [{ isChatReady: true, hasActiveConversation: true, attachmentLimitReached: false, isUploading: true }, "uploading"],
    [{ isChatReady: true, hasActiveConversation: true, attachmentLimitReached: false, isUploading: false }, "ready"],
  ] as const)("resolves upload-state precedence", (input, expected) => {
    expect(resolveChatWorkspaceDropState(input)).toBe(expected);
  });

  it("renders the remaining attachment capacity", () => {
    const html = renderToStaticMarkup(
      <ChatWorkspaceDropOverlay
        isChatReady
        hasActiveConversation
        attachmentLimitReached={false}
        isUploading={false}
        remainingAttachmentSlots={3}
      />,
    );
    expect(html).toContain("dashboard:chatWorkspace.dropFilesTitle");
    expect(html).toContain("dashboard:chatWorkspace.dropFilesDescription:3");
    expect(html).toContain("border-indigo-500/70");
  });

  it("uses unlimited copy when the runtime has no attachment cap", () => {
    const html = renderToStaticMarkup(
      <ChatWorkspaceDropOverlay
        isChatReady
        hasActiveConversation
        attachmentLimitReached={false}
        isUploading={false}
        remainingAttachmentSlots={null}
      />,
    );
    expect(html).toContain("dashboard:chatWorkspace.dropFilesDescriptionUnlimited");
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatAttachmentUploads } from "./ChatAttachmentUploads";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe("attachment queue presentation", () => {
  it("distinguishes server confirmation from success and keeps retry actions for failures", () => {
    const html = renderToStaticMarkup(<ChatAttachmentUploads items={[
      { id: "one", name: "<script>.txt", size: 1, progress: 100, status: "confirming" },
      { id: "two", name: "failed.txt", size: 1, progress: 0, status: "failed" },
    ]} onCancel={() => {}} onRetry={() => {}} onDismiss={() => {}} />);
    expect(html).toContain("uploadStatus_confirming"); expect(html).toContain('value="100"');
    expect(html).toContain("uploadRetry"); expect(html).toContain("uploadCancel");
    expect(html).toContain("&lt;script&gt;.txt"); expect(html).not.toContain("<script>");
  });
});

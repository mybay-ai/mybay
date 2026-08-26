import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspacePreviewTab } from "./WorkspacePreviewTab";

const t = ((key: string) => key) as any;

describe("WorkspacePreviewTab local security boundary", () => {
  it("renders HTML only inside the restricted srcDoc sandbox", () => {
    const html = renderToStaticMarkup(createElement(WorkspacePreviewTab, {
      t,
      conversationFiles: [],
      conversationFilePreview: {
        file: { id: "file-1", originalName: "index.html", mimeType: "text/html", size: 100 },
        kind: "html",
        source: "conversation",
        text: '<script>fetch("https://example.com")</script>',
      },
    }));

    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-forms");
    expect(html).not.toContain("allow-popups");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src &#x27;none&#x27;");
  });

  it("does not expose an executable blob open action for instance HTML", () => {
    const html = renderToStaticMarkup(createElement(WorkspacePreviewTab, {
      t,
      conversationFiles: [],
      conversationFilePreview: {
        file: { id: "instance:index.html", originalName: "index.html", mimeType: "text/html", size: 100 },
        kind: "html",
        source: "instance",
        url: "blob:http://localhost/unsafe-html",
        text: "<h1>Preview</h1>",
      },
    }));

    expect(html).not.toContain('target="_blank"');
    expect(html).toContain('download="index.html"');
  });

  it("keeps raw HTML inside Markdown escaped", () => {
    const html = renderToStaticMarkup(createElement(WorkspacePreviewTab, {
      t,
      conversationFiles: [],
      conversationFilePreview: {
        file: { id: "file-2", originalName: "notes.md", mimeType: "text/markdown", size: 100 },
        kind: "markdown",
        source: "conversation",
        text: '# Notes\n<script>alert("xss")</script>',
      },
    }));

    expect(html).toContain("<h1>Notes</h1>");
    expect(html).not.toContain("<script>");
  });
});

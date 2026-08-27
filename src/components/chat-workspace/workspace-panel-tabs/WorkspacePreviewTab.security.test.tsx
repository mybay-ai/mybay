import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getVideoPreviewErrorTranslationKey, WorkspacePreviewTab } from "./WorkspacePreviewTab";

const t = ((key: string) => key) as any;

describe("WorkspacePreviewTab local security boundary", () => {
  it("renders HTML in one restricted srcDoc sandbox instead of a nested iframe shell", () => {
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
    expect(html.match(/<iframe/g)).toHaveLength(1);
    expect(html).toContain('data-html-preview-frame="single-sandbox"');
    expect(html).toContain("dashboard:chatWorkspace.webPreviewSourceMode");
    expect(html).toContain("dashboard:chatWorkspace.webPreviewPageMode");
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

  it("uses the isolated authenticated endpoint for interactive instance HTML", () => {
    const previewUrl = "/api/instances/instance-1/files/html-preview?path=outputs%2Fweb%2Fdemo%2Findex.html";
    const html = renderToStaticMarkup(createElement(WorkspacePreviewTab, {
      t,
      conversationFiles: [],
      conversationFilePreview: {
        file: { id: "instance:outputs/web/demo/index.html", originalName: "index.html", mimeType: "text/html", size: 100 },
        kind: "html",
        source: "instance",
        url: "blob:http://localhost/download-copy",
        htmlPreviewUrl: previewUrl,
        text: "<script>window.previewReady = true</script>",
      },
    }));

    expect(html).toContain(`src="${previewUrl.replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain("srcDoc=");
    expect(html).not.toContain("window.previewReady");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('download="index.html"');
  });

  it("uses the isolated single-file endpoint for interactive conversation HTML", () => {
    const previewUrl = "/api/instances/instance-1/conversations/conversation-1/files/file-1/html-preview";
    const html = renderToStaticMarkup(createElement(WorkspacePreviewTab, {
      t,
      conversationFiles: [],
      conversationFilePreview: {
        file: { id: "file-1", originalName: "interactive.html", mimeType: "text/html", size: 100 },
        kind: "html",
        source: "conversation",
        url: "blob:http://localhost/download-copy",
        htmlPreviewUrl: previewUrl,
        text: "<script>window.previewReady = true</script>",
      },
      onOpenConversationFile: () => undefined,
      onDownloadConversationFile: () => undefined,
    }));

    expect(html).toContain(`src="${previewUrl}"`);
    expect(html).not.toContain("window.previewReady");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain("dashboard:chatWorkspace.runResultSummaryOpenFile");
    expect(html).toContain("dashboard:chatWorkspace.runResultSummaryDownloadFile");
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

  it("renders locally converted Office HTML in a fully restricted iframe", () => {
    const html = renderToStaticMarkup(createElement(WorkspacePreviewTab, {
      t,
      conversationFiles: [],
      conversationFilePreview: {
        file: { id: "file-office", originalName: "report.docx", mimeType: "application/octet-stream", size: 100 },
        kind: "office",
        source: "conversation",
        officeHtml: "<!doctype html><html><body><p>Report</p></body></html>",
      },
    }));
    expect(html).toContain('sandbox=""');
    expect(html).not.toContain("allow-scripts");
    expect(html).toContain("Report");
  });

  it("renders MP4 and MOV files through native video controls", () => {
    const html = renderToStaticMarkup(createElement(WorkspacePreviewTab, {
      t,
      conversationFiles: [],
      conversationFilePreview: {
        file: { id: "file-video", originalName: "clip.mov", mimeType: "video/quicktime", size: 100 },
        kind: "video",
        source: "conversation",
        url: "/api/instances/instance-1/conversations/conversation-1/files/file-video/media-preview",
      },
    }));
    expect(html).toContain("<video");
    expect(html).toContain("controls=\"\"");
    expect(html).toContain("dashboard:chatWorkspace.workspaceVideoPreviewHint");
    expect(html).toContain('data-video-stream-preview="true"');
    expect(html).not.toContain("blob:http://localhost/video");
  });

  it("maps native media errors to actionable diagnostics", () => {
    expect(getVideoPreviewErrorTranslationKey(1)).toContain("Aborted");
    expect(getVideoPreviewErrorTranslationKey(2)).toContain("Network");
    expect(getVideoPreviewErrorTranslationKey(3)).toContain("Decode");
    expect(getVideoPreviewErrorTranslationKey(4)).toContain("Unsupported");
    expect(getVideoPreviewErrorTranslationKey()).toContain("Unknown");
  });
});

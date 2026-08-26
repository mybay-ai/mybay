import { describe, expect, it } from "vitest";
import {
  buildSandboxedHtmlPreviewDocument,
  buildSandboxedHtmlPreviewShell,
  HTML_PREVIEW_IFRAME_SANDBOX,
  isHtmlPreviewFile,
  isSvgPreviewFile,
  LOCAL_TEXT_PREVIEW_MAX_BYTES,
} from "./previewSecurity";

describe("local attachment preview security", () => {
  it("injects a restrictive CSP before untrusted HTML content", () => {
    const result = buildSandboxedHtmlPreviewDocument('<html><head><script>fetch("https://example.com")</script></head></html>');
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(result.indexOf("<script>"));
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("form-action 'none'");
  });

  it("wraps fragments and escapes source inside the new-window sandbox shell", () => {
    const result = buildSandboxedHtmlPreviewShell('<script>top.location="/escape"</script>', 'bad" title');
    expect(result).toContain(`sandbox="${HTML_PREVIEW_IFRAME_SANDBOX}"`);
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain('<script>top.location="/escape"</script>');
    expect(result).toContain("bad&quot; title");
  });

  it("keeps preview memory limits separate from upload limits and detects active formats", () => {
    expect(LOCAL_TEXT_PREVIEW_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(isHtmlPreviewFile("index.html")).toBe(true);
    expect(isHtmlPreviewFile("notes.txt", "text/html")).toBe(true);
    expect(isSvgPreviewFile("icon.svg")).toBe(true);
    expect(isSvgPreviewFile("photo.png", "image/png")).toBe(false);
  });
});

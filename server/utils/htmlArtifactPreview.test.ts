import { describe, expect, it } from "vitest";
import {
  HTML_ARTIFACT_PREVIEW_CSP,
  HTML_ARTIFACT_PREVIEW_MAX_BYTES,
  HTML_SINGLE_FILE_PREVIEW_CSP,
  extractHtmlArtifactAssetReferences,
  inspectHtmlArtifactPreviewProject,
  isAllowedHtmlPreviewAsset,
  isHtmlArtifactPreview,
  normalizeHtmlPreviewProjectRoot,
} from "./htmlArtifactPreview";
import fs from "fs";
import os from "os";
import path from "path";

describe("HTML artifact preview policy", () => {
  it("allows local scripts while keeping the document isolated and offline", () => {
    expect(HTML_ARTIFACT_PREVIEW_CSP).toContain("sandbox allow-scripts");
    expect(HTML_ARTIFACT_PREVIEW_CSP).toContain("script-src 'self' 'unsafe-inline'");
    expect(HTML_ARTIFACT_PREVIEW_CSP).toContain("connect-src 'none'");
    expect(HTML_ARTIFACT_PREVIEW_CSP).toContain("form-action 'none'");
    expect(HTML_ARTIFACT_PREVIEW_CSP).not.toContain("allow-same-origin");
  });

  it("limits interactive previews to small HTML documents", () => {
    expect(HTML_ARTIFACT_PREVIEW_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(isHtmlArtifactPreview("outputs/web/demo/index.html", "text/plain")).toBe(true);
    expect(isHtmlArtifactPreview("artifact.bin", "text/html; charset=utf-8")).toBe(true);
    expect(isHtmlArtifactPreview("report.pdf", "application/pdf")).toBe(false);
  });

  it("limits project resources to explicitly previewable web assets", () => {
    expect(isAllowedHtmlPreviewAsset("styles/site.css")).toBe(true);
    expect(isAllowedHtmlPreviewAsset("scripts/app.mjs")).toBe(true);
    expect(isAllowedHtmlPreviewAsset("images/hero.svg")).toBe(true);
    expect(isAllowedHtmlPreviewAsset("media/demo.mov")).toBe(true);
    expect(isAllowedHtmlPreviewAsset("private.sqlite")).toBe(false);
    expect(isAllowedHtmlPreviewAsset("notes.env")).toBe(false);
  });

  it("keeps uploaded single-file HTML offline without same-origin assets", () => {
    expect(HTML_SINGLE_FILE_PREVIEW_CSP).toContain("sandbox allow-scripts");
    expect(HTML_SINGLE_FILE_PREVIEW_CSP).toContain("script-src 'unsafe-inline'");
    expect(HTML_SINGLE_FILE_PREVIEW_CSP).not.toContain("script-src 'self'");
    expect(HTML_SINGLE_FILE_PREVIEW_CSP).toContain("connect-src 'none'");
  });

  it("derives a project root without accepting traversal", () => {
    expect(normalizeHtmlPreviewProjectRoot("outputs/web/demo/index.html")).toEqual({
      projectRoot: "outputs/web/demo",
      entryPath: "index.html",
    });
    expect(normalizeHtmlPreviewProjectRoot("outputs/web/demo/pages/about.html")).toEqual({
      projectRoot: "outputs/web/demo",
      entryPath: "pages/about.html",
    });
    expect(normalizeHtmlPreviewProjectRoot("index.html")).toEqual({ projectRoot: ".", entryPath: "index.html" });
    expect(normalizeHtmlPreviewProjectRoot("outputs/web/../secret.html")).toBeNull();
    expect(normalizeHtmlPreviewProjectRoot("outputs\\web\\index.html")).toBeNull();
  });

  it("extracts only local HTML asset references", () => {
    expect(extractHtmlArtifactAssetReferences(`
      <link rel="stylesheet" href="./styles.css?rev=1">
      <script src='./app.js'></script>
      <img src="data:image/png;base64,abc">
      <script src="https://example.com/remote.js"></script>
    `)).toEqual(["./styles.css", "./app.js", "https://example.com/remote.js"]);
  });

  it("remaps a uniquely relocated bundle and reports truly missing assets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-html-preview-"));
    try {
      fs.mkdirSync(path.join(root, "preview"), { recursive: true });
      fs.writeFileSync(path.join(root, "preview", "app.bundle.js"), "console.log('ok')");
      const inspection = inspectHtmlArtifactPreviewProject({
        projectRootAbsolute: root,
        entryPath: "preview.html",
        source: '<script src="./app.bundle.js"></script><link href="./missing.css" rel="stylesheet">',
      });
      expect(inspection.status).toBe("incomplete");
      expect(inspection.aliases).toEqual({ "app.bundle.js": "preview/app.bundle.js" });
      expect(inspection.missing.map(item => item.requestPath)).toEqual(["missing.css"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

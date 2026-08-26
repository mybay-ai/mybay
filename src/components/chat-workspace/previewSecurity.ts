export const LOCAL_TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const HTML_PREVIEW_IFRAME_SANDBOX = "allow-scripts";

export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const SECURITY_HEAD = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta name="referrer" content="no-referrer">`;

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSandboxedHtmlPreviewDocument(source: string): string {
  if (/<head(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${SECURITY_HEAD}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<html(?:\s[^>]*)?>/i, match => `${match}<head>${SECURITY_HEAD}</head>`);
  }
  return `<!doctype html><html><head>${SECURITY_HEAD}</head><body>${source}</body></html>`;
}

export function buildSandboxedHtmlPreviewShell(source: string, title: string): string {
  const previewDocument = escapeHtmlAttribute(buildSandboxedHtmlPreviewDocument(source));
  const safeTitle = escapeHtmlAttribute(title || "HTML Preview");
  const shellCsp = HTML_PREVIEW_CSP.replace("frame-src 'none'", "frame-src 'self'");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${shellCsp}"><meta name="referrer" content="no-referrer"><title>${safeTitle}</title><style>html,body,iframe{box-sizing:border-box;width:100%;height:100%;margin:0;border:0}body{overflow:hidden;background:#fff}</style></head><body><iframe title="${safeTitle}" sandbox="${HTML_PREVIEW_IFRAME_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${previewDocument}"></iframe></body></html>`;
}

export function isHtmlPreviewFile(fileName: string, mimeType = ""): boolean {
  return /\.html?$/i.test(fileName) || /(?:text|application)\/x?html/i.test(mimeType);
}

export function isSvgPreviewFile(fileName: string, mimeType = ""): boolean {
  return /\.svg$/i.test(fileName) || mimeType.toLowerCase().includes("image/svg+xml");
}

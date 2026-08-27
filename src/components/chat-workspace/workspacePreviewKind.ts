export type WorkspacePreviewKind = "image" | "html" | "pdf" | "video" | "markdown" | "text" | "office" | "unsupported";

export function getWorkspacePreviewKind(fileName: string, mimeType = ""): WorkspacePreviewKind {
  const normalizedMime = mimeType.toLowerCase();
  const name = fileName.toLowerCase();
  if (normalizedMime.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(name)) return "image";
  if (normalizedMime.includes("html") || /\.html?$/i.test(name)) return "html";
  if (normalizedMime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (normalizedMime.startsWith("video/") || /\.(mp4|mov)$/i.test(name)) return "video";
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (normalizedMime.startsWith("text/") || /\.(txt|csv|tsv|json|jsonl|log|yaml|yml|xml|ini|conf|env|ts|tsx)$/i.test(name)) return "text";
  if (/\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf)$/i.test(name)) return "office";
  return "unsupported";
}

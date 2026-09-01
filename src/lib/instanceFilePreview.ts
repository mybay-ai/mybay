import { api } from "./api";
import type { InstanceFileItem } from "./instanceFiles";
import { getWorkspacePreviewKind } from "../components/chat-workspace/workspacePreviewKind";

export type InstancePreviewKind = "image" | "pdf" | "html" | "markdown" | "text" | "office" | "video" | "audio" | "unsupported";
export interface InstancePreview {
  kind: InstancePreviewKind;
  text?: string;
  blob?: Blob;
  url?: string;
  officeHtml?: string;
  truncated?: boolean;
  pageError?: string;
}
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
export const BINARY_PREVIEW_LIMIT = 20 * 1024 * 1024;

export function getInstancePreviewKind(name: string, mime = ""): InstancePreviewKind {
  if (/\.(mp3|wav|ogg)$/i.test(name)) return "audio";
  if (/\.(mp4|mov|webm)$/i.test(name)) return "video";
  // Only advertise formats the local Office extractor actually supports.
  if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(name)) return "office";
  if (/\.(odt|ods|odp|rtf)$/i.test(name)) return "unsupported";
  if (/\.(js|jsx|mjs|cjs|py|sh|css|sql|toml|go|rs|java|c|cpp|h)$/i.test(name)) return "text";
  return getWorkspacePreviewKind(name, mime);
}

export function previewLimitError() { return Object.assign(new Error("PREVIEW_TOO_LARGE"), { code: "PREVIEW_TOO_LARGE" }); }

export async function readBoundedPreview(response: Response, limit: number, signal: AbortSignal): Promise<Blob> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw previewLimitError();
  }
  if (!response.body) return new Blob([]);
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw previewLimitError(); }
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export async function loadInstancePreview(instanceId: string, file: InstanceFileItem, signal: AbortSignal): Promise<InstancePreview> {
  const prefix = `/api/instances/${encodeURIComponent(instanceId)}/files`;
  const query = `?path=${encodeURIComponent(file.path)}`;
  // Fetch authoritative metadata and run the existing ownership/export guard.
  const metadata = await api.get(`${prefix}/metadata${query}`, { signal });
  signal.throwIfAborted();
  const kind = getInstancePreviewKind(file.name, metadata.mime || file.mime || "");
  if (kind === "unsupported") return { kind };
  if (kind === "audio" || kind === "video") return { kind, url: `${prefix}/media-preview${query}` };
  const limit = ["text", "markdown", "html"].includes(kind) ? TEXT_PREVIEW_LIMIT : BINARY_PREVIEW_LIMIT;
  if (Number(metadata.size) > limit) throw previewLimitError();
  if (kind === "office") {
    const result = await api.get(`${prefix}/office-preview${query}`, { signal });
    signal.throwIfAborted();
    if (typeof result?.html !== "string" || !result.html) throw new Error("OFFICE_PREVIEW_FAILED");
    return { kind, officeHtml: result.html, truncated: Boolean(result.truncated) };
  }
  const response = await api.getRaw(`${prefix}/download${query}`, { signal });
  const blob = await readBoundedPreview(response, limit, signal);
  if (kind === "image" || kind === "pdf") {
    return { kind, blob: new Blob([blob], { type: kind === "pdf" ? "application/pdf" : metadata.mime || blob.type }) };
  }
  const text = await blob.text();
  signal.throwIfAborted();
  if (kind !== "html") return { kind, text };
  if (metadata.artifact?.previewStatus === "incomplete") return { kind, text, pageError: "HTML_PREVIEW_DEPENDENCIES_MISSING" };
  try {
    // Probe the secured entry first so HTTP failures do not masquerade as a
    // successful iframe load. Retain only its path-scoped public session URL.
    const page = await api.getRaw(`${prefix}/html-preview${query}`, { signal });
    await page.body?.cancel();
    const session = new URL(page.url);
    if (!session.pathname.startsWith(`${prefix}/html-preview-session/`)) throw new Error("HTML_PREVIEW_FAILED");
    return { kind, text, url: session.pathname + session.search };
  } catch (error: any) {
    signal.throwIfAborted();
    return { kind, text, pageError: error.message || "HTML_PREVIEW_FAILED" };
  }
}

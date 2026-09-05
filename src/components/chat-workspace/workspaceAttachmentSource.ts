import { api } from "../../lib/api";

export type WorkspaceAttachmentEntry = { name: string; path: string; type: "file" | "directory"; size: number | null; mime: string | null; isSymlink?: boolean };
export function workspaceAttachmentIssue(file: WorkspaceAttachmentEntry, extensions: string[] | null, maxBytes: number | null) {
  if (file.isSymlink) return "workspaceAttachLink";
  if (file.type === "directory") return null;
  const extension = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase();
  if (extensions !== null && (!extension || !extensions.includes(extension))) return "workspaceAttachType";
  if (!file.size || file.size < 0) return "workspaceAttachEmpty";
  if (maxBytes !== null && file.size > maxBytes) return "workspaceAttachSize";
  return null;
}

// Reuse authenticated export and the normal upload pipeline. File paths never
// become attachment identities: the upload creates a conversation-owned copy.
export async function readWorkspaceAttachments(options: {
  instanceId: string; entries: WorkspaceAttachmentEntry[]; extensions: string[] | null;
  maxBytes: number | null; remaining: number | null; signal: AbortSignal;
  onProgress: (name: string, index: number) => void;
  get?: (url: string, options: RequestInit) => Promise<Response>;
}): Promise<File[]> {
  const { entries, signal, maxBytes } = options;
  const selected = [...new Map(entries.map(entry => [entry.path, entry])).values()];
  if (options.remaining !== null && selected.length > options.remaining) throw new Error("workspaceAttachCount");
  for (const entry of selected) {
    const issue = workspaceAttachmentIssue(entry, options.extensions, maxBytes);
    if (issue || entry.type !== "file") throw new Error(issue || "workspaceAttachType");
  }
  const files: File[] = [];
  for (const [index, entry] of selected.entries()) {
    signal.throwIfAborted();
    options.onProgress(entry.name, index + 1);
    const response = await (options.get || api.getRaw)(`/api/instances/${encodeURIComponent(options.instanceId)}/files/download?path=${encodeURIComponent(entry.path)}`, { signal });
    if (!response.ok) throw new Error("workspaceAttachReadFailed");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("workspaceAttachReadFailed");
    const parts: BlobPart[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (maxBytes !== null && size > maxBytes) throw new Error("workspaceAttachSize");
        parts.push(chunk.value.slice().buffer as ArrayBuffer);
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!size) throw new Error("workspaceAttachEmpty");
    files.push(new File(parts, entry.name, { type: response.headers.get("content-type") || entry.mime || "application/octet-stream" }));
  }
  signal.throwIfAborted();
  return files;
}

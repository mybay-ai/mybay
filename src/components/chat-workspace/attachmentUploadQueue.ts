import type { ChatUploadOptions, UploadedChatFile } from "../../lib/chatFileUpload";
import { generateUUIDv4 } from "./chatWorkspaceSendPolicy";

export type AttachmentUploadItem = { id: string; name: string; size: number; status: "queued" | "uploading" | "confirming" | "failed" | "cancelled"; progress: number | null; error?: string };
type Entry = AttachmentUploadItem & { file: File; controller?: AbortController };

// One transport at a time; stable ids survive uncertain/cancelled responses.
export function createAttachmentUploadQueue(options: {
  upload: (file: File, options: ChatUploadOptions) => Promise<UploadedChatFile>;
  onChange: (items: AttachmentUploadItem[]) => void;
  onUploaded: (file: UploadedChatFile) => void;
}) {
  let entries: Entry[] = [];
  let disposed = false;
  let running = false;
  const publish = () => { if (!disposed) options.onChange(entries.map(({ file: _file, controller: _controller, ...item }) => item)); };
  const pump = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed) {
        const entry = entries.find(item => item.status === "queued");
        if (!entry) break;
        entry.status = "uploading";
        entry.controller = new AbortController();
        publish();
        try {
          const file = await options.upload(entry.file, {
            uploadId: entry.id, signal: entry.controller.signal,
            onProgress: progress => {
              if (entry.controller?.signal.aborted || disposed) return;
              entry.progress = progress;
              entry.status = progress === 100 ? "confirming" : "uploading";
              publish();
            },
          });
          if (disposed) break;
          // A completed response wins even when cancel raced with completion.
          if (entries.includes(entry)) {
            entries = entries.filter(item => item !== entry);
            options.onUploaded(file);
          }
        } catch (error) {
          if (!disposed && entries.includes(entry)) {
            entry.status = entry.controller.signal.aborted ? "cancelled" : "failed";
            entry.error = error instanceof Error ? error.message : String(error);
          }
        } finally { entry.controller = undefined; publish(); }
      }
    } finally { running = false; }
  };
  return {
    add(files: File[]) {
      if (disposed) return;
      entries.push(...files.map(file => ({ file, id: generateUUIDv4(), name: file.name, size: file.size, status: "queued" as const, progress: 0 })));
      publish(); void pump();
    },
    retry(id: string) {
      const entry = entries.find(item => item.id === id);
      if (!entry || entry.controller || !["failed", "cancelled"].includes(entry.status)) return;
      entry.status = "queued"; entry.progress = 0; entry.error = undefined; publish(); void pump();
    },
    cancel(id: string) {
      const entry = entries.find(item => item.id === id);
      if (!entry || !["queued", "uploading", "confirming"].includes(entry.status)) return;
      entry.status = "cancelled"; entry.controller?.abort(); publish();
    },
    dismiss(id: string) {
      const entry = entries.find(item => item.id === id);
      if (entry && !entry.controller && ["failed", "cancelled"].includes(entry.status)) { entries = entries.filter(item => item !== entry); publish(); }
    },
    size: () => entries.length,
    dispose() { disposed = true; for (const entry of entries) entry.controller?.abort(); entries = []; },
  };
}

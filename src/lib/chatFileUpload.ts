import { getAuthToken } from "./auth";
import { humanizeChatError } from "./chatRuntimeErrors";

export type UploadedChatFile = { id: string; originalName: string; mimeType: string; size: number };
export type ChatUploadOptions = {
  uploadId: string;
  signal: AbortSignal;
  onProgress: (percent: number | null) => void;
};

function isUploadedChatFile(value: unknown): value is UploadedChatFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<UploadedChatFile>;
  return typeof file.id === "string" && file.id.length > 0
    && typeof file.originalName === "string" && file.originalName.length > 0
    && typeof file.mimeType === "string" && file.mimeType.length > 0
    && typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size > 0;
}

export function uploadChatFile(instanceId: string, conversationId: string, file: File, options: ChatUploadOptions): Promise<UploadedChatFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const abort = () => { xhr.abort(); finish(new DOMException("Upload cancelled", "AbortError")); };
    const finish = (error?: Error, result?: UploadedChatFile) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", abort);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = null;
      xhr.upload.onload = null;
      if (error) reject(error); else resolve(result!);
    };
    if (options.signal.aborted) { abort(); return; }
    xhr.open("POST", `/api/instances/${encodeURIComponent(instanceId)}/conversations/${encodeURIComponent(conversationId)}/files`);
    xhr.withCredentials = true;
    xhr.timeout = 10 * 60 * 1000;
    xhr.setRequestHeader("X-Upload-Id", options.uploadId);
    const token = getAuthToken();
    if (token && token !== "null" && token !== "undefined") xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = event => options.onProgress(event.lengthComputable && event.total > 0 ? Math.min(100, Math.round(event.loaded * 100 / event.total)) : null);
    xhr.upload.onload = () => options.onProgress(100);
    xhr.onload = () => {
      let data: any;
      try { data = JSON.parse(xhr.responseText); } catch { /* malformed response is retryable with the same upload id */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.success === true && Array.isArray(data.files) && data.files.length === 1 && isUploadedChatFile(data.files[0])) {
        finish(undefined, data.files[0]);
      } else {
        if (xhr.status === 401) window.dispatchEvent(new CustomEvent("api-unauthorized"));
        const error = humanizeChatError({ data, status: xhr.status }, "Upload failed");
        finish(Object.assign(new Error(error.message), { status: xhr.status, code: error.code }));
      }
    };
    xhr.onerror = () => finish(new Error("UPLOAD_NETWORK_ERROR"));
    xhr.ontimeout = () => finish(new Error("UPLOAD_TIMEOUT"));
    xhr.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"));
    options.signal.addEventListener("abort", abort, { once: true });
    const form = new FormData(); form.append("files", file);
    try { xhr.send(form); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

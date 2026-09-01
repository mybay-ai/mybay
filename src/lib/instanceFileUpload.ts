import { getAuthToken } from "./auth";

export function uploadInstanceFile(instanceId: string, directory: string, file: File, signal: AbortSignal, progress: (percent: number) => void): Promise<{ path: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const fail = (code: string) => reject(Object.assign(new Error(code), { code }));
    const abort = () => request.abort();
    request.open("POST", `/api/instances/${encodeURIComponent(instanceId)}/files/upload?path=${encodeURIComponent(directory)}&name=${encodeURIComponent(file.name)}`);
    request.withCredentials = true;
    request.timeout = 120000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    const token = getAuthToken();
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      let body: { code?: string; ok?: boolean; path?: string } = {};
      try { body = JSON.parse(request.responseText); } catch { /* A proxy may return HTML. */ }
      if (request.status === 201 && body.ok && typeof body.path === "string") resolve({ path: body.path });
      else fail(body.code || (request.status === 401 || request.status === 403 ? "UPLOAD_ACCESS_DENIED" : "UPLOAD_FAILED"));
    };
    request.onerror = () => fail("UPLOAD_NETWORK");
    request.ontimeout = () => fail("UPLOAD_NETWORK");
    request.onabort = () => fail("UPLOAD_ABORTED");
    request.onloadend = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { fail("UPLOAD_ABORTED"); return; }
    signal.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
}

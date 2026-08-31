import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadChatFile } from "./chatFileUpload";
vi.mock("./auth", () => ({ getAuthToken: () => "test-token" }));
class FakeXHR {
  static last: FakeXHR;
  upload: any = {};
  onload: any; onerror: any; onabort: any; ontimeout: any;
  status = 0; responseText = ""; withCredentials = false;
  headers: Record<string, string> = {};
  body: any;
  constructor() { FakeXHR.last = this; }
  open = vi.fn();
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body: any) { this.body = body; }
  abort = vi.fn(() => this.onabort?.());
}
beforeEach(() => { vi.stubGlobal("XMLHttpRequest", FakeXHR); vi.stubGlobal("window", { dispatchEvent: vi.fn() }); });
afterEach(() => vi.unstubAllGlobals());
const start = (controller = new AbortController()) => {
  const onProgress = vi.fn();
  const promise = uploadChatFile("instance", "conversation", new File(["hello"], "中文.txt"), { uploadId: "stable-id", signal: controller.signal, onProgress });
  return { promise, xhr: FakeXHR.last, controller, onProgress };
};
describe("attachment upload transport", () => {
  it("sends cookie/token auth and stable identity, reports progress but waits for commit", async () => {
    const f = start(); let resolved = false; void f.promise.then(() => { resolved = true; });
    expect(f.xhr.withCredentials).toBe(true);
    expect(f.xhr.headers).toMatchObject({ Authorization: "Bearer test-token", "X-Upload-Id": "stable-id" });
    expect(f.xhr.headers).not.toHaveProperty("Content-Type");
    expect(f.xhr.body.get('files').name).toBe("中文.txt");
    f.xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    f.xhr.upload.onload(); await Promise.resolve();
    expect(f.onProgress.mock.calls).toEqual([[50], [100]]); expect(resolved).toBe(false);
    f.xhr.status = 201; f.xhr.responseText = JSON.stringify({ success: true, files: [{ id: "saved", originalName: "中文.txt", mimeType: "text/plain", size: 5 }] }); f.xhr.onload();
    await expect(f.promise).resolves.toMatchObject({ id: "saved" });
    f.controller.abort(); expect(f.xhr.abort).not.toHaveBeenCalled();
  });
  it("aborts promptly and removes completion handlers", async () => {
    const f = start(); f.controller.abort();
    await expect(f.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(f.xhr.onload).toBeNull(); expect(f.xhr.upload.onprogress).toBeNull();
  });
  it.each(["onerror", "ontimeout"])("rejects uncertain %s without an automatic duplicate request", async event => {
    const f = start(); f.xhr[event](); await expect(f.promise).rejects.toBeInstanceOf(Error);
  });
  it("rejects malformed success and broadcasts expired authentication", async () => {
    const malformed = start(); malformed.xhr.status = 200; malformed.xhr.responseText = '{}'; malformed.xhr.onload();
    await expect(malformed.promise).rejects.toBeInstanceOf(Error);
    const expired = start(); expired.xhr.status = 401; expired.xhr.responseText = '{"error":"Unauthorized"}'; expired.xhr.onload();
    await expect(expired.promise).rejects.toMatchObject({ status: 401 }); expect(window.dispatchEvent).toHaveBeenCalledOnce();
  });
  it.each([
    { id: "saved" },
    { id: "saved", originalName: "x.txt", mimeType: null, size: 5 },
    { id: "saved", originalName: "x.txt", mimeType: "text/plain", size: -1 },
    { id: "", originalName: "x.txt", mimeType: "text/plain", size: 5 },
  ])("keeps malformed file metadata out of pending attachments", async file => {
    const f = start(); f.xhr.status = 201; f.xhr.responseText = JSON.stringify({ success: true, files: [file] }); f.xhr.onload();
    await expect(f.promise).rejects.toBeInstanceOf(Error);
  });
});

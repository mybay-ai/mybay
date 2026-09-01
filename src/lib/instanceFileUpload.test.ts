import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadInstanceFile } from "./instanceFileUpload";

vi.mock("./auth", () => ({ getAuthToken: () => null }));
class UploadRequest {
  static last: UploadRequest;
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  onloadend?: () => void;
  ontimeout?: () => void;
  status = 0;
  responseText = "";
  open = vi.fn();
  send = vi.fn();
  setRequestHeader = vi.fn();
  constructor() { UploadRequest.last = this; }
  abort() { this.onabort?.(); this.onloadend?.(); }
  finish(status: number, body: unknown) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); this.onloadend?.(); }
}
afterEach(() => vi.unstubAllGlobals());
describe("file center upload transport", () => {
  it("keeps 100% transfer pending until the server confirms storage", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const file = new File(["hello"], "中文.txt");
    const progress = vi.fn();
    let settled = false;
    const upload = uploadInstanceFile("A", "/outputs/中文目录", file, new AbortController().signal, progress).then(value => { settled = true; return value; });
    const request = UploadRequest.last;
    request.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 5 });
    await Promise.resolve();
    expect(settled).toBe(false); expect(progress).toHaveBeenCalledWith(100);
    expect(request.open).toHaveBeenCalledWith("POST", `/api/instances/A/files/upload?path=${encodeURIComponent("/outputs/中文目录")}&name=${encodeURIComponent("中文.txt")}`);
    expect(request.send).toHaveBeenCalledWith(file);
    request.finish(201, { ok: true, path: "/outputs/中文目录/中文.txt" });
    await expect(upload).resolves.toEqual({ path: "/outputs/中文目录/中文.txt" });
  });
  it("reports a same-name conflict rather than success", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const promise = uploadInstanceFile("A", "/uploads", new File([], "empty.txt"), new AbortController().signal, () => {});
    UploadRequest.last.finish(409, { code: "UPLOAD_EXISTS" });
    await expect(promise).rejects.toMatchObject({ code: "UPLOAD_EXISTS" });
  });
  it("aborts an in-flight transfer when the instance context is disposed", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const controller = new AbortController();
    const promise = uploadInstanceFile("A", "/uploads", new File([], "empty.txt"), controller.signal, () => {});
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "UPLOAD_ABORTED" });
  });
  it("preserves an unconfirmed result on network failure and rejects malformed success", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const first = uploadInstanceFile("A", "/uploads", new File([], "empty.txt"), new AbortController().signal, () => {});
    UploadRequest.last.onerror?.(); UploadRequest.last.onloadend?.();
    await expect(first).rejects.toMatchObject({ code: "UPLOAD_NETWORK" });
    const second = uploadInstanceFile("A", "/uploads", new File([], "empty.txt"), new AbortController().signal, () => {});
    UploadRequest.last.finish(201, { ok: false });
    await expect(second).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
  });
});

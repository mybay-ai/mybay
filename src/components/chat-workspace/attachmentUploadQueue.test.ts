import { describe, expect, it, vi } from "vitest";
import { createAttachmentUploadQueue, type AttachmentUploadItem } from "./attachmentUploadQueue";
import type { ChatUploadOptions, UploadedChatFile } from "../../lib/chatFileUpload";
const file = (name: string) => new File(["hello"], name, { type: "text/plain" });
const result = { id: "saved", originalName: "a.txt", mimeType: "text/plain", size: 5 };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  let items: AttachmentUploadItem[] = [];
  const requests: { file: File; options: ChatUploadOptions; resolve: (file: UploadedChatFile) => void; reject: (error: Error) => void }[] = [];
  const onUploaded = vi.fn();
  const queue = createAttachmentUploadQueue({ onChange: next => { items = next; }, onUploaded,
    upload: (file, options) => new Promise((resolve, reject) => {
      requests.push({ file, options, resolve, reject });
      options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }),
  });
  return { queue, requests, onUploaded, items: () => items };
}
describe("attachment upload queue", () => {
  it("uploads serially, keeps failures, and retries with the original identity", async () => {
    const f = fixture(); f.queue.add([file("a.txt"), file("b.txt")]);
    expect(f.requests).toHaveLength(1);
    const id = f.items()[0].id;
    f.requests[0].options.onProgress(100);
    expect(f.items()[0].status).toBe("confirming");
    f.requests[0].reject(new Error("connection lost")); await tick();
    expect(f.items()[0].status).toBe("failed"); expect(f.requests).toHaveLength(2);
    f.queue.retry(id); // queued behind b
    f.requests[1].resolve({ ...result, id: "second" }); await tick();
    expect(f.requests[2].options.uploadId).toBe(id);
    f.requests[2].resolve(result); await tick();
    expect(f.items()).toEqual([]); expect(f.onUploaded).toHaveBeenCalledTimes(2);
  });
  it("cancels active and queued files, and permits a safe manual retry", async () => {
    const f = fixture(); f.queue.add([file("a.txt"), file("b.txt")]);
    const [a, b] = f.items(); f.queue.cancel(b.id); f.queue.cancel(a.id); await tick();
    expect(f.requests[0].options.signal.aborted).toBe(true);
    expect(f.requests).toHaveLength(1); expect(f.items().map(i => i.status)).toEqual(["cancelled", "cancelled"]);
    f.queue.retry(a.id); expect(f.requests[1].options.uploadId).toBe(a.id);
    f.requests[1].resolve(result); await tick(); f.queue.dismiss(b.id);
    expect(f.items()).toEqual([]); expect(f.onUploaded).toHaveBeenCalledOnce();
  });
  it("drops late results after switching conversation or unmounting", async () => {
    const f = fixture(); f.queue.add([file("a.txt"), file("b.txt")]);
    f.queue.dispose(); f.requests[0].resolve(result); await tick();
    expect(f.onUploaded).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(1); expect(f.queue.size()).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { getInstancePreviewKind, loadInstancePreview, readBoundedPreview, TEXT_PREVIEW_LIMIT } from "./instanceFilePreview";
const file = (name: string) => ({ name, path: "/outputs/" + name, type: "file" as const, mime: null, size: 0, updatedAt: "" });
afterEach(() => vi.restoreAllMocks());

describe("instance preview boundaries", () => {
  it.each([["clip.webm", "video"], ["声音.wav", "audio"], ["book.docx", "office"], ["book.odt", "unsupported"], ["code.py", "text"], ["readme.md", "markdown"], ["page.html", "html"], ["paper.pdf", "pdf"]])("classifies %s using supported local capabilities", (name, kind) => {
    expect(getInstancePreviewKind(name)).toBe(kind);
  });
  it("rejects a stale oversized file from authoritative metadata before downloading", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ size: TEXT_PREVIEW_LIMIT + 1, mime: "text/plain" });
    const download = vi.spyOn(api, "getRaw");
    await expect(loadInstancePreview("A", file("large.txt"), new AbortController().signal)).rejects.toMatchObject({ code: "PREVIEW_TOO_LARGE" });
    expect(download).not.toHaveBeenCalled();
  });
  it("bounds a streamed response even without a Content-Length", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12)); }, cancel }));
    await expect(readBoundedPreview(response, 8, new AbortController().signal)).rejects.toMatchObject({ code: "PREVIEW_TOO_LARGE" });
    expect(cancel).toHaveBeenCalled();
  });
  it("cancels a body read when the selected instance or preview changes", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const controller = new AbortController();
    const read = readBoundedPreview(response, 8, controller.signal);
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalled();
  });
  it("loads JSON source bytes without interpreting them as a preview envelope", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ size: 18, mime: "application/json" });
    vi.spyOn(api, "getRaw").mockResolvedValue(new Response('{ "content": 25 }\n', { headers: { "content-type": "application/json" } }));
    const result = await loadInstancePreview("A", file("a.json"), new AbortController().signal);
    expect(result.text).toBe('{ "content": 25 }\n');
  });
  it("uses the media endpoint without buffering video/audio bytes", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ size: 1_000_000_000, mime: "audio/wav" });
    const download = vi.spyOn(api, "getRaw");
    const result = await loadInstancePreview("A", file("声音.wav"), new AbortController().signal);
    expect(result.url).toContain("/files/media-preview?path=");
    expect(download).not.toHaveBeenCalled();
  });
  it("retains HTML source when dependencies are missing without opening the page", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ size: 20, mime: "text/html", artifact: { previewStatus: "incomplete" } });
    const download = vi.spyOn(api, "getRaw").mockResolvedValue(new Response('<h1>source</h1>'));
    const result = await loadInstancePreview("A", file("index.html"), new AbortController().signal);
    expect(result).toMatchObject({ text: '<h1>source</h1>', pageError: "HTML_PREVIEW_DEPENDENCIES_MISSING" });
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("only returns a path-scoped HTML session URL", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ size: 20, mime: "text/html" });
    const page = new Response("<h1>safe</h1>");
    Object.defineProperty(page, "url", { value: "http://localhost:3000/api/instances/A/files/html-preview-session/public-id/index.html" });
    vi.spyOn(api, "getRaw").mockResolvedValueOnce(new Response('<h1>safe</h1>')).mockResolvedValueOnce(page);
    const result = await loadInstancePreview("A", file("index.html"), new AbortController().signal);
    expect(result.url).toBe("/api/instances/A/files/html-preview-session/public-id/index.html");
  });
  it("fails closed on a redirect outside the HTML preview endpoint", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ size: 20, mime: "text/html" });
    const page = new Response("unexpected");
    Object.defineProperty(page, "url", { value: "http://localhost:3000/app" });
    vi.spyOn(api, "getRaw").mockResolvedValueOnce(new Response('<h1>source</h1>')).mockResolvedValueOnce(page);
    expect(await loadInstancePreview("A", file("index.html"), new AbortController().signal)).toMatchObject({ pageError: "HTML_PREVIEW_FAILED", text: "<h1>source</h1>" });
  });
  it("never downloads a file if the export guard rejects metadata", async () => {
    vi.spyOn(api, "get").mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const download = vi.spyOn(api, "getRaw");
    await expect(loadInstancePreview("A", file("blocked.pdf"), new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    expect(download).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstanceFileRequestScope, downloadInstanceFile, prepareInstanceFileDownload, filterInstanceFiles, type InstanceFileItem } from "./instanceFiles";

afterEach(() => vi.unstubAllGlobals());

describe("instance file download transport", () => {
  it("hands off an encoded authenticated URL without buffering file bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ size: 100_000_000 }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await prepareInstanceFileDownload("A", "/outputs/中文 #1.pdf", new AbortController().signal);
    expect(result).toBe(`/api/instances/A/files/download?path=${encodeURIComponent("/outputs/中文 #1.pdf")}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/metadata?");
  });
  it("does not offer a URL after forbidden metadata or an aborted check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(prepareInstanceFileDownload("A", "/.env", new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { controller.abort(); return new Response("{}", { headers: { "Content-Type": "application/json" } }); }));
    await expect(prepareInstanceFileDownload("A", "/outputs/a.pdf", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([
    ["application/json", '{ "标题": "原始内容", "n": 1 }\n'],
    ["text/csv", "名称,数量\r\n测试,2\r\n"],
    ["text/plain", "hello\n"],
    ["application/pdf", "%PDF-1.7\n"],
    ["image/png", new Uint8Array([137, 80, 78, 71, 0, 255])],
  ])("preserves original %s bytes through the real API wrapper", async (mime, content) => {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const response = new Response(bytes, { headers: { "Content-Type": mime } });
    const json = vi.spyOn(response, "json");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const blob = await downloadInstanceFile("instance-A", "/outputs/中文 #1.json", signal);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(`/api/instances/instance-A/files/download?path=${encodeURIComponent("/outputs/中文 #1.json")}`, expect.objectContaining({ signal }));
  });

  it("does not turn an HTTP error into a downloaded file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(downloadInstanceFile("A", "/outputs/a.json")).rejects.toMatchObject({ status: 403 });
  });
});

describe("instance file request isolation", () => {
  it("ignores out-of-order responses even when the transport ignores abort", async () => {
    const scope = createInstanceFileRequestScope();
    let resolveOld!: (value: string) => void;
    const oldResponse = new Promise<string>(resolve => { resolveOld = resolve; });
    const oldRequest = scope.begin("list");
    let visible = "";
    const oldWork = oldResponse.then(value => { if (oldRequest.isCurrent()) visible = value; });
    const nextRequest = scope.begin("list");
    if (nextRequest.isCurrent()) visible = "new folder";
    resolveOld("old folder");
    await oldWork;
    expect(visible).toBe("new folder");
    expect(oldRequest.signal.aborted).toBe(true);
  });

  it("rejects stale delete confirmations after navigation or instance unmount", () => {
    const scope = createInstanceFileRequestScope();
    const firstConfirmation = scope.captureContext();
    scope.advanceContext();
    expect(firstConfirmation()).toBe(false);
    const secondConfirmation = scope.captureContext();
    const preview = scope.begin("preview");
    const usage = scope.begin("usage");
    scope.dispose();
    expect(secondConfirmation()).toBe(false);
    expect(preview.isCurrent()).toBe(false);
    expect(usage.signal.aborted).toBe(true);
    expect(scope.begin("download").isCurrent()).toBe(false);
  });

  it("closing preview rejects its pending result without cancelling directory loading", () => {
    const scope = createInstanceFileRequestScope();
    const preview = scope.begin("preview");
    const list = scope.begin("list");
    scope.cancel("preview");
    expect(preview.isCurrent()).toBe(false);
    expect(list.isCurrent()).toBe(true);
  });
});

describe("current-directory presentation", () => {
  const items: InstanceFileItem[] = [
    { name: "b.json", path: "/outputs/b.json", type: "file", mime: "application/json", size: 8, updatedAt: "2026-08-30" },
    { name: "报告10.pdf", path: "/outputs/报告10.pdf", type: "file", mime: "application/pdf", size: 50, updatedAt: "2026-08-29" },
    { name: "报告2.pdf", path: "/outputs/报告2.pdf", type: "file", mime: "application/pdf", size: 30, updatedAt: "2026-08-31" },
    { name: "z-folder", path: "/outputs/z-folder", type: "directory", mime: null, size: null, updatedAt: "" },
    { name: "PHOTO.PNG", path: "/outputs/PHOTO.PNG", type: "file", mime: null, size: 10, updatedAt: "invalid" },
  ];
  it("keeps folders first, uses numeric name ordering and never mutates the source", () => {
    const original = [...items];
    expect(filterInstanceFiles(items, "", "all", "size").map(item => item.name)).toEqual(["z-folder", "报告10.pdf", "报告2.pdf", "PHOTO.PNG", "b.json"]);
    expect(filterInstanceFiles(items, "报告", "document", "name").map(item => item.name)).toEqual(["报告2.pdf", "报告10.pdf"]);
    expect(items).toEqual(original);
  });
  it("matches filenames only, handles extension case, retains navigable folders", () => {
    expect(filterInstanceFiles(items, "outputs", "all", "name")).toEqual([]);
    expect(filterInstanceFiles(items, " photo ", "image", "name").map(item => item.name)).toEqual(["PHOTO.PNG"]);
    expect(filterInstanceFiles(items, "", "code", "name").map(item => item.name)).toEqual(["z-folder", "b.json"]);
    expect(filterInstanceFiles(items, "报告", "document", "updated")[0].name).toBe("报告2.pdf");
  });
});

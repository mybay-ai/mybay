import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createInstanceFileUploadRoutes } from "./fileUpload.routes";
import { INSTANCE_UPLOAD_MAX_BYTES } from "../../../shared/instanceFileUpload";

describe("instance file center upload HTTP boundary", () => {
  let root: string;
  let server: http.Server;
  let base: string;
  const quota = vi.fn();
  const validation = vi.fn();
  const normal = { storageUsedBytes: 0, storageLimitBytes: 100_000_000, storageStatus: "normal", storageExceeded: false, storageUsagePercent: 0 };
  beforeAll(async () => {
    const app = express();
    app.use(createInstanceFileUploadRoutes({
      authenticate: (req, res, next) => req.get("authorization") === "Bearer test" ? next() : void res.status(401).json({ code: "AUTH_REQUIRED" }),
      validateAccess: validation, checkQuota: quota, isSensitive: name => /secret|^\.env|^\.mybay-upload-/i.test(name),
    }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-upload-test-"));
    fs.mkdirSync(path.join(root, "outputs"));
    quota.mockReset().mockResolvedValue(normal);
    validation.mockReset().mockImplementation(async (_req, id) => id === "A" ? { rootDir: root, absolutePath: root, instance: {} } : { error: "Forbidden", status: 403 });
  });
  afterEach(() => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "mybay-upload-test-")) throw new Error("Unsafe test cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const url = (name: string, directory = "/outputs", id = "A") => `${base}/${id}/files/upload?path=${encodeURIComponent(directory)}&name=${encodeURIComponent(name)}`;
  const send = (name: string, body: string | Uint8Array = "hello", directory = "/outputs", id = "A", auth = true) => fetch(url(name, directory, id), { method: "POST", headers: { "content-type": "application/octet-stream", ...(auth ? { authorization: "Bearer test" } : {}) }, body });

  it("saves Chinese filenames and raw bytes, without leaving staging files", async () => {
    const response = await send("中文代码.py", 'print("本地上传")\n');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ path: "/outputs/中文代码.py", ok: true });
    expect(fs.readFileSync(path.join(root, "outputs/中文代码.py"), "utf8")).toBe('print("本地上传")\n');
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual(["中文代码.py"]);
  });
  it("supports an empty text file and creates only an allowed first-level folder", async () => {
    expect((await send("empty.txt", "", "/uploads")).status).toBe(201);
    expect(fs.statSync(path.join(root, "uploads/empty.txt")).size).toBe(0);
  });
  it("never overwrites an existing filename", async () => {
    fs.writeFileSync(path.join(root, "outputs/existing.txt"), "original");
    const response = await send("existing.txt", "replacement");
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("UPLOAD_EXISTS");
    expect(fs.readFileSync(path.join(root, "outputs/existing.txt"), "utf8")).toBe("original");
  });
  it.each(["../escape.txt", "a%2ftest.txt", "CON.txt", ".env", "secret.txt", "binary.exe"])("rejects unsafe or unsupported name %s", async name => {
    expect((await send(name)).status).toBe(400);
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual([]);
  });
  it.each(["/", "/workspace", "/outputs/../home", "/outputs/%2e%2e/home"])("rejects unsafe destination %s", async directory => {
    expect((await send("safe.txt", "test", directory)).status).toBe(403);
  });
  it("requires login and ownership before storing content", async () => {
    expect((await send("safe.txt", "x", "/outputs", "A", false)).status).toBe(401);
    expect((await send("safe.txt", "x", "/outputs", "B")).status).toBe(403);
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual([]);
  });
  it.each([["fake.pdf", "not a PDF"], ["broken.json", "{"], ["binary.py", new Uint8Array([0, 255])]])("validates content of %s", async (name, body) => {
    expect((await send(name as string, body)).status).toBe(400);
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual([]);
  });
  it("fails closed on unknown quota and projected quota overflow", async () => {
    quota.mockResolvedValue({ ...normal, storageUsedBytes: null, storageStatus: "unknown" });
    expect((await send("a.txt")).status).toBe(503);
    quota.mockResolvedValue({ ...normal, storageUsedBytes: 99, storageLimitBytes: 100 });
    expect((await send("a.txt", "five!")).status).toBe(413);
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual([]);
  });
  it("rejects symlink directories without writing to their targets", async () => {
    fs.mkdirSync(path.join(root, "private"));
    fs.symlinkSync(path.join(root, "private"), path.join(root, "outputs/link"), process.platform === "win32" ? "junction" : "dir");
    expect((await send("safe.txt", "test", "/outputs/link")).status).toBe(403);
    expect(fs.readdirSync(path.join(root, "private"))).toEqual([]);
  });
  it("rejects a directory replaced during quota validation", async () => {
    quota.mockImplementationOnce(async () => normal).mockImplementationOnce(async () => {
      fs.renameSync(path.join(root, "outputs"), path.join(root, "original-outputs"));
      fs.mkdirSync(path.join(root, "outputs"));
      return normal;
    });
    expect((await send("safe.txt")).status).toBe(409);
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual([]);
  });
  it("enforces the actual streamed size when Content-Length is absent", async () => {
    let chunks = 0;
    const body = new ReadableStream({ pull(controller) { if (chunks++ < 21) controller.enqueue(new Uint8Array(INSTANCE_UPLOAD_MAX_BYTES / 20)); else controller.close(); } });
    const response = await fetch(url("large.txt"), { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/octet-stream" }, body, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("UPLOAD_TOO_LARGE");
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual([]);
  });
  it("releases the upload slot after an interrupted request without saving partial bytes", async () => {
    const request = http.request(url("partial.txt"), { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/octet-stream", "content-length": 10000 } });
    request.on("error", () => {});
    request.write("partial");
    await vi.waitFor(() => expect(quota).toHaveBeenCalled());
    request.destroy();
    await vi.waitFor(async () => { const response = await send("after.txt"); expect(response.status).toBe(201); });
    expect(fs.existsSync(path.join(root, "outputs/partial.txt"))).toBe(false);
    expect(fs.readdirSync(path.join(root, "outputs"))).toEqual(["after.txt"]);
  });
});

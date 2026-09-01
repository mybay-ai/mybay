import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
// Keep this stream test independent of the running database and Docker service.
vi.mock("../services/instances/instanceFileSecurityService", () => ({ getMimeType: (name: string) => name.endsWith(".wav") ? "audio/wav" : "video/mp4" }));
import { isStreamableMediaFile, streamLocalMedia, streamLocalVideo } from "./mediaStream";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-p1-media-"));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

function response() {
  const chunks: Buffer[] = [];
  const headers: Record<string, unknown> = {};
  let status = 200;
  const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  const finished = new Promise<void>(resolve => stream.once("finish", resolve));
  const res = Object.assign(stream, {
    status(value: number) { status = value; return res; },
    setHeader(key: string, value: unknown) { headers[key] = value; return res; },
    json(value: unknown) { res.end(JSON.stringify(value)); return res; },
  });
  return { res, finished, result: () => ({ status, headers, bytes: Buffer.concat(chunks) }) };
}

describe("bounded local media streaming", () => {
  it("supports audio and WebM while preserving the video-only legacy API", async () => {
    expect(isStreamableMediaFile("voice.WAV")).toBe(true);
    expect(isStreamableMediaFile("clip.webm")).toBe(true);
    expect(isStreamableMediaFile("script.html")).toBe(false);
    const output = response();
    streamLocalVideo({ headers: {} }, output.res as any, "unused.wav", "unused.wav", directory);
    await output.finished;
    expect(output.result().status).toBe(415);
  });
  it("streams just the requested audio bytes with correct seek headers", async () => {
    const file = path.join(directory, "voice.wav");
    fs.writeFileSync(file, Buffer.from([1, 2, 3, 4, 5, 6]));
    const output = response();
    streamLocalMedia({ headers: { range: "bytes=2-4" } }, output.res as any, file, "voice.wav", directory);
    await output.finished;
    expect(output.result()).toMatchObject({ status: 206, headers: { "Content-Range": "bytes 2-4/6", "Content-Length": "3", "Content-Type": "audio/wav", "X-Content-Type-Options": "nosniff" }, bytes: Buffer.from([3, 4, 5]) });
  });
  it("rejects a byte range outside the file", async () => {
    const file = path.join(directory, "short.wav");
    fs.writeFileSync(file, Buffer.from([1, 2]));
    const output = response();
    streamLocalMedia({ headers: { range: "bytes=50-" } }, output.res as any, file, "short.wav", directory);
    await output.finished;
    expect(output.result()).toMatchObject({ status: 416, headers: { "Content-Range": "bytes */2" } });
  });
  it("retains canonical root isolation", async () => {
    const nested = path.join(directory, "allowed"); fs.mkdirSync(nested);
    const file = path.join(directory, "outside.wav"); fs.writeFileSync(file, Buffer.from([1]));
    const output = response();
    streamLocalMedia({ headers: {} }, output.res as any, file, "outside.wav", nested);
    await output.finished;
    expect(output.result().status).toBe(403);
  });
});

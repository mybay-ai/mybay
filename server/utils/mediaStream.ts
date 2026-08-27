import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { getMimeType } from "../services/instances/instanceFileSecurityService";
import { parseMediaByteRange } from "./mediaRange";

const STREAMABLE_VIDEO_EXTENSIONS = new Set([".mp4", ".mov"]);

export function isStreamableVideoFile(fileName: string): boolean {
  return STREAMABLE_VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function streamLocalVideo(req: { headers: { range?: string } }, res: Response, absolutePath: string, displayName: string) {
  if (!isStreamableVideoFile(displayName)) {
    return res.status(415).json({ success: false, error: "VIDEO_PREVIEW_TYPE_UNSUPPORTED", code: "VIDEO_PREVIEW_TYPE_UNSUPPORTED", message: "该文件不是支持的视频格式。" });
  }

  // Routes only call this helper with guardFileExport's canonical, non-symlink path.
  // lgtm[js/path-injection]
  const stats = fs.statSync(absolutePath);
  if (!stats.isFile() || stats.size <= 0) {
    return res.status(416).setHeader("Content-Range", `bytes */${Math.max(0, stats.size)}`).end();
  }
  const range = parseMediaByteRange(req.headers.range, stats.size);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Type", getMimeType(displayName));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`);

  if (range === "invalid") {
    res.status(416).setHeader("Content-Range", `bytes */${stats.size}`);
    return res.end();
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? stats.size - 1;
  const contentLength = end - start + 1;
  res.status(range ? 206 : 200);
  res.setHeader("Content-Length", String(contentLength));
  if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);

  // lgtm[js/path-injection]
  const stream = fs.createReadStream(absolutePath, { start, end });
  stream.on("error", (error) => {
    if (!res.headersSent) res.status(500).json({ success: false, error: "VIDEO_PREVIEW_TRANSFER_FAILED", code: "VIDEO_PREVIEW_TRANSFER_FAILED", message: "视频传输失败。" });
    else res.destroy(error);
  });
  stream.pipe(res);
  return res;
}

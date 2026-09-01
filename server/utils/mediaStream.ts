import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { getMimeType } from "../services/instances/instanceFileSecurityService";
import { parseMediaByteRange } from "./mediaRange";

const STREAMABLE_VIDEO_EXTENSIONS = new Set([".mp4", ".mov"]);
const STREAMABLE_MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mp3", ".wav", ".ogg"]);

export function isStreamableMediaFile(fileName: string): boolean {
  return STREAMABLE_MEDIA_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isStreamableVideoFile(fileName: string): boolean {
  return STREAMABLE_VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function streamLocalVideo(
  req: { headers: { range?: string } },
  res: Response,
  absolutePath: string,
  displayName: string,
  allowedRoot = path.dirname(absolutePath),
) {
  if (!isStreamableVideoFile(displayName)) {
    return res.status(415).json({ success: false, error: "VIDEO_PREVIEW_TYPE_UNSUPPORTED", code: "VIDEO_PREVIEW_TYPE_UNSUPPORTED", message: "该文件不是支持的视频格式。" });
  }
  return streamLocalMedia(req, res, absolutePath, displayName, allowedRoot);
}

export function streamLocalMedia(
  req: { headers: { range?: string } },
  res: Response,
  absolutePath: string,
  displayName: string,
  allowedRoot = path.dirname(absolutePath),
) {
  if (!isStreamableMediaFile(displayName)) {
    return res.status(415).json({ success: false, error: "MEDIA_PREVIEW_TYPE_UNSUPPORTED", code: "MEDIA_PREVIEW_TYPE_UNSUPPORTED", message: "该文件不是支持的音视频格式。" });
  }

  const canonicalRoot = fs.realpathSync(path.resolve(allowedRoot));
  const canonicalPath = fs.realpathSync(path.resolve(absolutePath));
  if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(canonicalRoot + path.sep)) {
    return res.status(403).json({ success: false, error: "VIDEO_PREVIEW_PATH_FORBIDDEN", code: "VIDEO_PREVIEW_PATH_FORBIDDEN", message: "视频文件超出实例数据目录。" });
  }
  const stats = fs.statSync(canonicalPath);
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

  const stream = fs.createReadStream(canonicalPath, { start, end });
  const disconnect = () => stream.destroy();
  res.once("close", disconnect);
  stream.once("close", () => res.off("close", disconnect));
  stream.on("error", (error) => {
    if (!res.headersSent) res.status(500).json({ success: false, error: "VIDEO_PREVIEW_TRANSFER_FAILED", code: "VIDEO_PREVIEW_TRANSFER_FAILED", message: "视频传输失败。" });
    else res.destroy(error);
  });
  stream.pipe(res);
  return res;
}

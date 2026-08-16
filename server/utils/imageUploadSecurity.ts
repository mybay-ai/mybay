export type SafeImageType = {
  extension: ".jpg" | ".png" | ".webp" | ".gif";
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

export function detectSafeImageType(buffer: Buffer): SafeImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mime: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mime: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: ".webp", mime: "image/webp" };
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") return { extension: ".gif", mime: "image/gif" };
  }
  return null;
}

export function isDeclaredImageTypeCompatible(declaredMime: string, detected: SafeImageType): boolean {
  return declaredMime.toLowerCase() === detected.mime;
}
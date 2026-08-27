/**
 * Browsers send multipart filenames as UTF-8 bytes, while Busboy/Multer may
 * expose those bytes as Latin-1 text. Repair that lossless mojibake without
 * altering already-correct Unicode or ordinary ASCII/Latin filenames.
 */
export function normalizeMultipartFilename(value: unknown): string {
  const filename = String(value || "");
  if (!filename || /[^\u0000-\u00ff]/.test(filename)) return filename;
  if (!/[\u0080-\u00ff]/.test(filename)) return filename;

  const bytes = Buffer.from(filename, "latin1");
  let decoded = "";
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return filename;
  }

  if (!decoded || decoded === filename || !/[^\u0000-\u00ff]/.test(decoded)) return filename;
  if (Buffer.from(decoded, "utf8").toString("latin1") !== filename) return filename;
  return decoded.normalize("NFC");
}

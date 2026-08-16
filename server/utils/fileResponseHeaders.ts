export type FileDisposition = "attachment" | "inline";

function asciiFileNameFallback(fileName: string): string {
  const normalized = String(fileName || "download")
    .replace(/[\r\n]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();

  return normalized || "download";
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function buildFileContentDisposition(
  fileName: string,
  disposition: FileDisposition = "attachment"
): string {
  const safeName = String(fileName || "download").replace(/[\r\n]/g, "");
  const fallback = asciiFileNameFallback(safeName);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987Value(safeName || "download")}`;
}

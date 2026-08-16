export const CONFIG_ARCHIVE_MAX_ENTRIES = 2000;
export const CONFIG_ARCHIVE_MAX_ENTRY_BYTES = 100 * 1024 * 1024;
export const CONFIG_ARCHIVE_MAX_TOTAL_BYTES = 600 * 1024 * 1024;
export const CONFIG_ARCHIVE_MAX_COMPRESSION_RATIO = 200;
export const CONFIG_ARCHIVE_RATIO_MIN_BYTES = 10 * 1024 * 1024;

export type ConfigArchiveEntry = {
  entryName: string;
  isDirectory?: boolean;
  header?: { size?: number; compressedSize?: number; externalFileAttr?: number };
};

export type ConfigArchiveValidation =
  | { ok: true; totalBytes: number }
  | { ok: false; code: string; error: string };

export function validateConfigArchiveEntries(entries: ConfigArchiveEntry[]): ConfigArchiveValidation {
  if (entries.length > CONFIG_ARCHIVE_MAX_ENTRIES) {
    return { ok: false, code: "ZIP_ENTRY_COUNT_LIMIT", error: `Archive contains more than ${CONFIG_ARCHIVE_MAX_ENTRIES} entries.` };
  }
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = String(entry.entryName || "").replace(/\\/g, "/");
    if (!name || name.includes("\0")) return { ok: false, code: "ZIP_INVALID_PATH", error: "Archive contains an invalid entry path." };
    if (name.startsWith("/") || /^[a-zA-Z]:\//.test(name)) return { ok: false, code: "ZIP_ABSOLUTE_PATH", error: "Archive contains an absolute entry path." };
    if (name.split("/").some((part) => part === "." || part === "..")) return { ok: false, code: "ZIP_PATH_TRAVERSAL", error: "Archive contains a path traversal entry." };
    const mode = Number(entry.header?.externalFileAttr || 0) >>> 16;
    if ((mode & 0xf000) === 0xa000) return { ok: false, code: "ZIP_SYMLINK", error: "Archive contains a symbolic link." };
    const size = Number(entry.header?.size || 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > CONFIG_ARCHIVE_MAX_ENTRY_BYTES) return { ok: false, code: "ZIP_ENTRY_SIZE_LIMIT", error: "Archive entry exceeds the 100MB safety limit." };
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > CONFIG_ARCHIVE_MAX_TOTAL_BYTES) return { ok: false, code: "ZIP_TOTAL_SIZE_LIMIT", error: "Archive expanded size exceeds the 600MB safety limit." };
    const compressedSize = Number(entry.header?.compressedSize || 0);
    if (size > CONFIG_ARCHIVE_RATIO_MIN_BYTES && compressedSize > 0 && size / compressedSize > CONFIG_ARCHIVE_MAX_COMPRESSION_RATIO) return { ok: false, code: "ZIP_COMPRESSION_RATIO", error: "Archive compression ratio exceeds the safety limit." };
  }
  return { ok: true, totalBytes };
}

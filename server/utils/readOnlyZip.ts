import { unzipSync, type UnzipFileInfo } from "fflate";

export const READ_ONLY_ZIP_DEFAULT_LIMITS = {
  maxEntries: 2_000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 600 * 1024 * 1024,
  maxCompressionRatio: 200,
  ratioMinBytes: 10 * 1024 * 1024,
} as const;

export type ReadOnlyZipEntry = {
  entryName: string;
  isDirectory: boolean;
  header: { size: number; compressedSize: number; externalFileAttr: 0 };
  getData(): Buffer;
};

type ZipLimits = {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
  ratioMinBytes: number;
};

export type ReadOnlyZipOptions = {
  include?: (entryName: string) => boolean;
  limits?: Partial<ZipLimits>;
};

function safeEntryName(value: string): string {
  if (!value || value.includes("\0") || value.includes("\\")) throw new Error("ZIP_INVALID_PATH");
  if (value.startsWith("/") || /^[a-zA-Z]:\//.test(value)) throw new Error("ZIP_ABSOLUTE_PATH");
  const segments = value.split("/");
  if (segments.some(segment => segment === "." || segment === "..")) throw new Error("ZIP_PATH_TRAVERSAL");
  return value;
}

/**
 * Reads selected ZIP members into memory without ever extracting them through a
 * library filesystem API. Limits are checked from the central directory before
 * fflate inflates each selected member. Unselected members still count toward
 * the archive limits and duplicate/path checks.
 */
export function readOnlyZip(
  source: Buffer | Uint8Array,
  options: ReadOnlyZipOptions = {},
): ReadOnlyZipEntry[] {
  const limits = { ...READ_ONLY_ZIP_DEFAULT_LIMITS, ...options.limits };
  const metadata: Array<{ name: string; directory: boolean; size: number; compressedSize: number; selected: boolean }> = [];
  const names = new Set<string>();
  let totalBytes = 0;

  const inflated = unzipSync(source, {
    filter(info: UnzipFileInfo) {
      const name = safeEntryName(info.name);
      const duplicateKey = name.toLowerCase();
      if (names.has(duplicateKey)) throw new Error(`ZIP_DUPLICATE_PATH: ${name}`);
      names.add(duplicateKey);
      if (names.size > limits.maxEntries) throw new Error("ZIP_ENTRY_COUNT_LIMIT");

      const size = Number(info.originalSize);
      const compressedSize = Number(info.size);
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxEntryBytes) throw new Error("ZIP_ENTRY_SIZE_LIMIT");
      if (!Number.isSafeInteger(compressedSize) || compressedSize < 0) throw new Error("ZIP_INVALID_COMPRESSED_SIZE");
      if (size > 0 && compressedSize === 0) throw new Error("ZIP_INVALID_COMPRESSED_SIZE");
      totalBytes += size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) throw new Error("ZIP_TOTAL_SIZE_LIMIT");
      if (size > limits.ratioMinBytes && compressedSize > 0 && size / compressedSize > limits.maxCompressionRatio) {
        throw new Error("ZIP_COMPRESSION_RATIO");
      }

      const directory = name.endsWith("/");
      const selected = !directory && (options.include?.(name) ?? true);
      metadata.push({ name, directory, size, compressedSize, selected });
      return selected;
    },
  });

  return metadata.map(({ name, directory, size, compressedSize, selected }) => ({
    entryName: name,
    isDirectory: directory,
    // fflate never materializes filesystem entries, so external attributes do
    // not influence restore behavior. Selected bytes are written as plain files
    // only after MyBay validates and confines the destination path.
    header: { size, compressedSize, externalFileAttr: 0 as const },
    getData() {
      if (directory) return Buffer.alloc(0);
      if (!selected || !inflated[name]) throw new Error(`ZIP_ENTRY_NOT_SELECTED: ${name}`);
      const data = inflated[name];
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    },
  }));
}

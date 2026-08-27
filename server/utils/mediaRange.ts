export type MediaByteRange = { start: number; end: number };

export function parseMediaByteRange(header: string | undefined, size: number): MediaByteRange | null | "invalid" {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return "invalid";
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return "invalid";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

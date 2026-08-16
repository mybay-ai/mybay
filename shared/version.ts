export interface ParsedHermesVersion {
  parts: number[];
  prerelease: string[];
}

export function parseHermesVersion(value: string): ParsedHermesVersion | null {
  const match = String(value || "").trim().match(/^v?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    parts: match[1].split(".").map((part) => Number.parseInt(part, 10)),
    prerelease: match[2] ? match[2].split(".") : [],
  };
}

export function compareHermesVersions(left: string, right: string): number {
  const a = parseHermesVersion(left);
  const b = parseHermesVersion(right);
  if (!a && !b) return String(left).localeCompare(String(right));
  if (!a) return -1;
  if (!b) return 1;
  for (let index = 0; index < 4; index += 1) {
    const difference = (a.parts[index] || 0) - (b.parts[index] || 0);
    if (difference) return difference;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = /^\d+$/.test(av) ? Number(av) : null;
    const bn = /^\d+$/.test(bv) ? Number(bv) : null;
    if (an !== null && bn !== null && an !== bn) return an - bn;
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    const difference = av.localeCompare(bv);
    if (difference) return difference;
  }
  return 0;
}

export function sortHermesVersionsDescending<T>(rows: T[], select: (row: T) => string): T[] {
  return [...rows].sort((a, b) => compareHermesVersions(select(b), select(a)));
}

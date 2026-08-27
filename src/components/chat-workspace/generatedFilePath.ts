const GENERATED_FILE_EXTENSIONS = "xlsx|xls|jpg|jpeg|png|webp|gif|pdf|doc|docx|csv|txt|md|markdown|html|htm|json|zip|ppt|pptx|css|js|ts|tsx|svg|mp4|mov";
const APPROVED_RELATIVE_ROOTS = [
  "outputs/",
  "output/",
  "results/",
  "artifacts/",
  "uploads/",
  "documents/",
  "reports/",
  "tmp/",
] as const;

export const GENERATED_FILE_PATH_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_./:\\\\-])(?:(?:\\/?opt\\/data\\/|\\.\\/|${APPROVED_RELATIVE_ROOTS.map(root => root.replace("/", "\\/")).join("|")})[^\\s<>\"']+?\\.(?:${GENERATED_FILE_EXTENSIONS}))(?![A-Za-z0-9])`,
  "giu"
);

function trimPathToken(rawPath: string): string {
  return String(rawPath || "")
    .trim()
    .replace(/^[`*_]+|[`*_]+$/g, "")
    .replace(/(?:[`*_]+|[.,;:!?，。；：！？]+)$/gu, "");
}

export function normalizeGeneratedInstanceFilePath(rawPath: string): string | null {
  const cleaned = trimPathToken(rawPath);
  if (!cleaned || /^[A-Za-z]:[\\/]/.test(cleaned) || /^\\\\/.test(cleaned)) return null;

  const normalized = cleaned.replace(/\\/g, "/");
  const isContainerPath = /^\/?opt\/data\//i.test(normalized);
  const isDotRelativePath = normalized.startsWith("./");
  const isApprovedRelativePath = APPROVED_RELATIVE_ROOTS.some(root => normalized.toLowerCase().startsWith(root));
  if (!isContainerPath && !isDotRelativePath && !isApprovedRelativePath) return null;

  const relativePath = normalized
    .replace(/^\/?opt\/data\//i, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length || segments.some(segment => segment === "." || segment === ".." || segment.includes(":"))) return null;
  return segments.join("/");
}

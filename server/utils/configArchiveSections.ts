const BASE_ARCHIVE_SECTIONS = ["manifest", "config", "business-config", "template-inputs"] as const;
const UPLOAD_ROOTS = new Set(["uploads", "input", "inputs", "documents", "files"]);
const OUTPUT_ROOTS = new Set(["outputs", "output", "results", "artifacts"]);

function archiveContentRoot(archivePath: string): string {
  const parts = String(archivePath).replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
  return parts[0] === "workspace" ? parts[1] || "" : parts[0] || "";
}

export function isConfigArchiveUploadPath(archivePath: string): boolean {
  return UPLOAD_ROOTS.has(archiveContentRoot(archivePath));
}

export function isConfigArchiveOutputPath(archivePath: string): boolean {
  return OUTPUT_ROOTS.has(archiveContentRoot(archivePath));
}

export function buildConfigArchiveSections(archivePaths: readonly string[]): string[] {
  const sections: string[] = [...BASE_ARCHIVE_SECTIONS];
  if (archivePaths.some(isConfigArchiveUploadPath)) sections.push("uploads");
  if (archivePaths.some(isConfigArchiveOutputPath)) sections.push("outputs");
  return sections;
}

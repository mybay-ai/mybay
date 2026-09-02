const BASE_ARCHIVE_SECTIONS = ["manifest", "config", "business-config", "template-inputs"] as const;
const UPLOAD_ROOTS = new Set(["uploads", "input", "inputs", "documents", "files"]);
const OUTPUT_ROOTS = new Set(["outputs", "output", "results", "artifacts"]);

export function buildConfigArchiveSections(archivePaths: readonly string[]): string[] {
  const roots = new Set(
    archivePaths.map((archivePath) => String(archivePath).replace(/\\/g, "/").split("/", 1)[0].toLowerCase()),
  );
  const sections: string[] = [...BASE_ARCHIVE_SECTIONS];
  if ([...UPLOAD_ROOTS].some((root) => roots.has(root))) sections.push("uploads");
  if ([...OUTPUT_ROOTS].some((root) => roots.has(root))) sections.push("outputs");
  return sections;
}

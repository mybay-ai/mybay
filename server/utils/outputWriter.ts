import fs from "fs";
import path from "path";

/**
 * Safely writes instance output generation results to standard output folder.
 * Enforces sandboxing to prevent directory traversal.
 * 
 * @param instanceId The unique ID of the instance
 * @param filename File name to write (e.g. xiaohongshu_topics_123_456.md)
 * @param content The text/markdown content to write
 * @returns The fully resolved absolute file path
 */
export function writeInstanceOutput(instanceId: string, filename: string, content: string, dataVolumePath?: string | null): string {
  if (!instanceId) {
    throw new Error("Instance ID is required for saving process outputs.");
  }

  // 1. Validate filename
  const cleanedFilename = path.basename(filename);
  if (cleanedFilename !== filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Illegal output filename syntax: directory traversal paths are prohibited.");
  }

  // 2. Resolve target directories
  const localDir = path.resolve(process.cwd(), "data", "instances", instanceId);
  const baseDir = dataVolumePath ? path.resolve(dataVolumePath) : localDir;
  const outputsDir = path.resolve(baseDir, "outputs");

  // Enforce path-sandbox check
  if (!outputsDir.startsWith(baseDir)) {
    throw new Error("Path security exception: Target directory resolves outside the instance container sandbox.");
  }

  // Ensure outputs folder exists
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
  }

  const filePath = path.join(outputsDir, filename);

  // Enforce precise target file path check
  if (!path.resolve(filePath).startsWith(outputsDir)) {
    throw new Error("Path security exception: Target file path is resolved outside the sandbox outputs folder.");
  }

  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

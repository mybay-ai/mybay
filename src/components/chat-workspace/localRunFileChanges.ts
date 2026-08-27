import type { GeneratedArtifact } from "./generatedArtifacts";
import type { RunExecutionState } from "./run/runTypes";

export type LocalRunFileChange = { path: string; kind: "added" | "modified" | "deleted" };

const PATH_KEYS = ["path", "filePath", "file_path", "relativePath", "relative_path", "targetPath", "target_path"];
const OPERATION_KEYS = ["operation", "action", "changeType", "change_type", "event"];

function readString(metadata: Record<string, unknown> | undefined, keys: string[]) {
  if (!metadata) return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function classifyOperation(value: string): LocalRunFileChange["kind"] | null {
  const normalized = value.toLowerCase();
  if (/delete|remove|unlink/.test(normalized)) return "deleted";
  if (/create|add|write_new/.test(normalized)) return "added";
  if (/write|edit|modify|update|patch|replace/.test(normalized)) return "modified";
  return null;
}

export function collectLocalRunFileChanges(execution: RunExecutionState | null | undefined, artifacts: GeneratedArtifact[]): LocalRunFileChange[] {
  const changes = new Map<string, LocalRunFileChange>();
  for (const artifact of artifacts) changes.set(artifact.path, { path: artifact.path, kind: "added" });
  for (const block of execution?.blocks || []) {
    if (block.type !== "tool") continue;
    const filePath = readString(block.metadata, PATH_KEYS).replace(/^\/opt\/data\//, "").replace(/\\/g, "/");
    const kind = classifyOperation(readString(block.metadata, OPERATION_KEYS) || block.tool || block.label || "");
    if (!filePath || !kind) continue;
    changes.set(filePath, { path: filePath, kind });
  }
  return Array.from(changes.values()).slice(0, 20);
}

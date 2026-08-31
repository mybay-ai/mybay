import { classifyLocalFileOperation, safeLocalEvidencePath, readLocalFileEvidence, mergeLocalFileChanges } from "../../../shared/localRunFileEvidence";
import { getGeneratedArtifactActionPath, type GeneratedArtifact } from "./generatedArtifacts";
import type { RunExecutionState } from "./run/runTypes";

export type LocalRunFileChange = { path: string; kind: "added" | "modified" | "deleted" | "referenced" | "unknown" };

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

export function collectLocalRunFileChanges(execution: RunExecutionState | null | undefined, artifacts: GeneratedArtifact[], context?: { runId?: string | null; evidence?: unknown }): LocalRunFileChange[] {
  const changes = new Map<string, LocalRunFileChange>();
  for (const artifact of artifacts) {
    if (getGeneratedArtifactActionPath(artifact)) changes.set(artifact.path, { path: artifact.path, kind: "referenced" });
  }
  for (const change of readLocalFileEvidence(context?.evidence, context?.runId)) changes.set(change.path, change);
  // An unrelated live run must never supply mutation evidence for this message.
  const scopeMatches = context ? Boolean(context.runId && context.runId === execution?.runId)
    : artifacts.length > 0 && artifacts.every(artifact => artifact.runId && artifact.runId === execution?.runId);
  if (!scopeMatches) return mergeLocalFileChanges([...changes.values()]);
  for (const block of execution?.blocks || []) {
    if (block.type !== "tool" || block.status !== "completed" || block.completionInferred || block.metadata?.file_evidence_confirmed === false) continue;
    const rawPath = readString(block.metadata, PATH_KEYS);
    const filePath = safeLocalEvidencePath(rawPath);
    const kind = classifyLocalFileOperation(readString(block.metadata, OPERATION_KEYS) || block.tool || "");
    if (!filePath || !kind) continue;
    if (kind === "referenced" && changes.has(filePath)) continue;
    if (kind === "unknown" && changes.get(filePath)?.kind === "added") continue;
    if (kind === "modified" && changes.get(filePath)?.kind === "added") continue;
    changes.set(filePath, { path: filePath, kind });
  }
  return mergeLocalFileChanges([...changes.values()]);
}

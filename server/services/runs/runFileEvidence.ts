import { classifyLocalFileOperation, safeLocalEvidencePath, type LocalFileChange } from "../../../shared/localRunFileEvidence";
import type { LocalRunFileDiffs } from "../../../shared/localRunFileDiff";

/** Never forwards commands, contents, tool results, or arbitrary display previews. */
export function safeFileOperationMetadata(step: any): Record<string, string> {
  const tool = String(step.name || step.tool_name || step.tool || "").toLowerCase();
  const operation = step.operation || step.action || step.metadata?.operation || tool;
  if (!classifyLocalFileOperation(operation)) return {};
  const sources = [step, step.metadata, step.input, step.args, step.arguments, step.params];
  let rawPath = sources.map(source => source?.file_path || source?.path || source?.filePath || source?.target_path).find(value => typeof value === "string");
  // Hermes write_file/patch previews are the path argument. read_file previews are
  // basename + line range in recent Hermes, so they cannot establish a workspace path.
  if (!rawPath && ["write_file", "patch"].includes(tool) && typeof step.preview === "string" && step.preview.startsWith("/opt/data/")) rawPath = step.preview;
  const path = safeLocalEvidencePath(rawPath);
  return path ? { file_path: path, operation } : {};
}

export function completedFileChange(step: { status: string; metadata: Record<string, unknown> }): LocalFileChange | null {
  if (step.status !== "completed") return null;
  const path = safeLocalEvidencePath(step.metadata.file_path);
  const kind = classifyLocalFileOperation(step.metadata.operation);
  return path && kind ? { path, kind } : null;
}

/** A bounded before/after snapshot is stronger evidence than an ambiguous Runtime tool label. */
export function confirmFileChangesWithSnapshots(
  changes: LocalFileChange[],
  diffs: LocalRunFileDiffs | undefined
): LocalFileChange[] {
  if (!diffs?.files.length) return changes;
  const snapshots = new Map(diffs.files.map(file => [file.path, file]));
  return changes.map(change => {
    const snapshot = snapshots.get(change.path);
    if (!snapshot) return change;
    if (snapshot.before === null && snapshot.after !== null) return { ...change, kind: "added" };
    if (snapshot.before !== null && snapshot.after === null) return { ...change, kind: "deleted" };
    if (snapshot.before !== null && snapshot.after !== null && snapshot.before !== snapshot.after) return { ...change, kind: "modified" };
    return change;
  });
}

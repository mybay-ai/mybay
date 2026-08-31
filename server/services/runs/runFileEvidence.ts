import { classifyLocalFileOperation, safeLocalEvidencePath, type LocalFileChange } from "../../../shared/localRunFileEvidence";

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

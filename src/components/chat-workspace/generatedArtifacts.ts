import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { GENERATED_FILE_PATH_PATTERN, normalizeGeneratedInstanceFilePath } from "./generatedFilePath";

export type GeneratedArtifactStatus = "generating" | "checking" | "ready" | "incomplete" | "missing" | "failed";
export type GeneratedArtifactPreviewStatus = "ready" | "incomplete";
export type ArtifactReference = { messageId: string; runId: string | null; requestId: string | null };

export type GeneratedArtifact = {
  path: string;
  name: string;
  messageId: string;
  runId: string | null;
  requestId: string | null;
  status: GeneratedArtifactStatus;
  /** Mentions identify references, never proof of file creation. */
  references?: ArtifactReference[];
  size?: number | null;
  mimeType?: string | null;
  updatedAt?: string | null;
  error?: string | null;
  previewStatus?: GeneratedArtifactPreviewStatus | null;
  previewError?: string | null;
  previewDependencies?: Array<{
    reference: string;
    requestPath: string;
    resolvedPath: string | null;
    status: "ready" | "remapped" | "missing" | "unsupported";
  }>;
};

export function isGeneratedArtifactPreviewable(artifact: Pick<GeneratedArtifact, "status">): boolean {
  return artifact.status === "ready" || artifact.status === "incomplete";
}

export function getGeneratedArtifactActionPath(artifact: Pick<GeneratedArtifact, "path">): string {
  // Artifact identity is workspace-relative; click handlers validate raw container paths.
  const containerPath = `/opt/data/${artifact.path}`;
  return normalizeGeneratedInstanceFilePath(containerPath) === artifact.path ? containerPath : "";
}

const MAX_GENERATED_ARTIFACTS_PER_CONVERSATION = 50;

function readMetadataString(message: ChatMessage, keys: string[]): string | null {
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getArtifactName(filePath: string) {
  return filePath.split("/").filter(Boolean).pop() || filePath;
}

export function extractGeneratedArtifacts(
  messages: ChatMessage[],
  activeRunId: string | null
): GeneratedArtifact[] {
  const artifacts = new Map<string, GeneratedArtifact>();

  for (const message of messages) {
    if (message.role !== "assistant" || !message.content) continue;
    const runId = readMetadataString(message, ["runId", "run_id"]);
    const requestId = message.request_id || readMetadataString(message, ["requestId", "request_id"]);
    const messageGenerating = message.status === "pending" || Boolean(activeRunId && runId === activeRunId);

    GENERATED_FILE_PATH_PATTERN.lastIndex = 0;
    for (const match of message.content.matchAll(GENERATED_FILE_PATH_PATTERN)) {
      const filePath = normalizeGeneratedInstanceFilePath(match[0]);
      if (!filePath) continue;
      if (!artifacts.has(filePath) && artifacts.size >= MAX_GENERATED_ARTIFACTS_PER_CONVERSATION) continue;
      const previous = artifacts.get(filePath);
      const references = previous?.references || [];
      if (!references.some(reference => reference.messageId === message.id)) {
        references.push({ messageId: message.id, runId, requestId });
      }
      artifacts.set(filePath, {
        path: filePath,
        name: getArtifactName(filePath),
        messageId: message.id,
        runId,
        requestId,
        status: messageGenerating ? "generating" : "checking",
        references,
      });
    }
  }

  return Array.from(artifacts.values());
}

export function mergeGeneratedArtifactVerification(
  artifact: GeneratedArtifact,
  verification?: Partial<GeneratedArtifact> | null
): GeneratedArtifact {
  if (!verification) return artifact;
  return {
    ...artifact,
    ...verification,
    path: artifact.path,
    name: artifact.name,
    messageId: artifact.messageId,
    runId: artifact.runId,
    requestId: artifact.requestId,
    references: artifact.references,
  };
}

import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { GENERATED_FILE_PATH_PATTERN, normalizeGeneratedInstanceFilePath } from "./generatedFilePath";

export type GeneratedArtifactStatus = "generating" | "checking" | "ready" | "incomplete" | "missing" | "failed";
export type GeneratedArtifactPreviewStatus = "ready" | "incomplete";

export type GeneratedArtifact = {
  path: string;
  name: string;
  messageId: string;
  runId: string | null;
  requestId: string | null;
  status: GeneratedArtifactStatus;
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
      artifacts.set(filePath, {
        path: filePath,
        name: getArtifactName(filePath),
        messageId: message.id,
        runId,
        requestId,
        status: messageGenerating ? "generating" : "checking",
      });
      if (artifacts.size >= MAX_GENERATED_ARTIFACTS_PER_CONVERSATION) break;
    }
    if (artifacts.size >= MAX_GENERATED_ARTIFACTS_PER_CONVERSATION) break;
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
  };
}

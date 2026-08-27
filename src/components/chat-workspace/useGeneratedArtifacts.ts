import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { api } from "../../lib/api";
import {
  extractGeneratedArtifacts,
  mergeGeneratedArtifactVerification,
  type GeneratedArtifact,
} from "./generatedArtifacts";
import { buildWorkspaceFileContextKey } from "./workspaceFileContext";

type ArtifactVerification = Partial<GeneratedArtifact> & { status: GeneratedArtifact["status"] };

type UseGeneratedArtifactsOptions = {
  selectedId: string;
  selectedConversationId: string | null;
  messages: ChatMessage[];
  activeRunId: string | null;
};

const VERIFY_RETRY_MS = 1200;
const MAX_VERIFY_ATTEMPTS = 4;
const READY_RECHECK_MS = 15_000;

export function useGeneratedArtifacts({
  selectedId,
  selectedConversationId,
  messages,
  activeRunId,
}: UseGeneratedArtifactsOptions) {
  const candidates = useMemo(
    () => extractGeneratedArtifacts(messages, activeRunId),
    [activeRunId, messages]
  );
  const [verificationByPath, setVerificationByPath] = useState<Record<string, ArtifactVerification>>({});
  const generationRef = useRef(0);
  const contextKey = buildWorkspaceFileContextKey(selectedId, selectedConversationId);

  const verifyArtifacts = useCallback(async (artifacts: GeneratedArtifact[], attempt = 0) => {
    const generation = generationRef.current;
    const capturedContextKey = buildWorkspaceFileContextKey(selectedId, selectedConversationId);
    if (!capturedContextKey || artifacts.length === 0) return;

    const results = await Promise.all(artifacts.map(async (artifact) => {
      try {
        const metadata = await api.get(`/api/instances/${encodeURIComponent(selectedId)}/files/metadata?path=${encodeURIComponent(artifact.path)}`);
        return [artifact.path, {
          status: metadata?.artifact?.status === "incomplete" ? "incomplete" as const : "ready" as const,
          size: typeof metadata?.size === "number" ? metadata.size : null,
          mimeType: typeof metadata?.mime === "string" ? metadata.mime : null,
          updatedAt: typeof metadata?.updatedAt === "string" ? metadata.updatedAt : null,
          error: null,
          previewStatus: metadata?.artifact?.previewStatus === "incomplete" ? "incomplete" as const : "ready" as const,
          previewError: typeof metadata?.artifact?.previewError === "string" ? metadata.artifact.previewError : null,
          previewDependencies: Array.isArray(metadata?.artifact?.previewDependencies) ? metadata.artifact.previewDependencies : [],
        }] as const;
      } catch (error: any) {
        const missing = error?.status === 404;
        const shouldRetry = (artifact.status === "generating" || artifact.status === "checking")
          && attempt < MAX_VERIFY_ATTEMPTS - 1;
        return [artifact.path, {
          status: shouldRetry ? artifact.status : (missing ? "missing" as const : "failed" as const),
          error: missing ? "FILE_NOT_FOUND" : (error?.code || error?.message || "FILE_CHECK_FAILED"),
        }] as const;
      }
    }));

    if (generationRef.current !== generation || buildWorkspaceFileContextKey(selectedId, selectedConversationId) !== capturedContextKey) return;
    setVerificationByPath(previous => ({ ...previous, ...Object.fromEntries(results) }));

    const retryArtifacts = artifacts.filter((artifact) => {
      const result = results.find(([filePath]) => filePath === artifact.path)?.[1];
      return result?.status === "generating";
    });
    if (retryArtifacts.length > 0 && attempt < MAX_VERIFY_ATTEMPTS - 1) {
      window.setTimeout(() => {
        if (generationRef.current === generation) void verifyArtifacts(retryArtifacts, attempt + 1);
      }, VERIFY_RETRY_MS);
    }
  }, [selectedConversationId, selectedId]);

  useEffect(() => {
    generationRef.current += 1;
    setVerificationByPath({});
    if (!contextKey || candidates.length === 0) return;
    void verifyArtifacts(candidates);
  }, [candidates, contextKey, verifyArtifacts]);

  useEffect(() => {
    if (!contextKey || candidates.length === 0) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void verifyArtifacts(candidates);
    }, READY_RECHECK_MS);
    const handleWindowFocus = () => { void verifyArtifacts(candidates); };
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [candidates, contextKey, verifyArtifacts]);

  const artifacts = useMemo(() => candidates.map((artifact) => (
    mergeGeneratedArtifactVerification(artifact, verificationByPath[artifact.path])
  )), [candidates, verificationByPath]);

  const refreshGeneratedArtifacts = useCallback(() => {
    generationRef.current += 1;
    setVerificationByPath({});
    if (contextKey && candidates.length > 0) void verifyArtifacts(candidates);
  }, [candidates, contextKey, verifyArtifacts]);

  return { generatedArtifacts: artifacts, refreshGeneratedArtifacts };
}

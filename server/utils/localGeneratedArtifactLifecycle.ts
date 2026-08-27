import type { HtmlArtifactPreviewInspection } from "./htmlArtifactPreview";

export const LOCAL_GENERATED_ARTIFACT_CONTRACT_VERSION = "local-artifact-v1";

export type LocalGeneratedArtifactSnapshot = {
  contractVersion: typeof LOCAL_GENERATED_ARTIFACT_CONTRACT_VERSION;
  status: "ready" | "incomplete";
  role: "final" | "intermediate";
  previewStatus: "ready" | "incomplete";
  previewDependencies: HtmlArtifactPreviewInspection["dependencies"];
  previewError: "HTML_PREVIEW_DEPENDENCIES_MISSING" | null;
  fingerprint: string;
  checkedAt: string;
};

export function createLocalGeneratedArtifactSnapshot(input: {
  requestedPath: string;
  size: number;
  modifiedAt: Date;
  htmlPreview?: HtmlArtifactPreviewInspection | null;
  now?: Date;
}): LocalGeneratedArtifactSnapshot {
  const normalizedPath = input.requestedPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const previewStatus = input.htmlPreview?.status || "ready";
  return {
    contractVersion: LOCAL_GENERATED_ARTIFACT_CONTRACT_VERSION,
    status: previewStatus === "incomplete" ? "incomplete" : "ready",
    role: normalizedPath.startsWith("outputs/") ? "final" : "intermediate",
    previewStatus,
    previewDependencies: input.htmlPreview?.dependencies || [],
    previewError: previewStatus === "incomplete" ? "HTML_PREVIEW_DEPENDENCIES_MISSING" : null,
    fingerprint: `${input.size}:${input.modifiedAt.getTime()}`,
    checkedAt: (input.now || new Date()).toISOString(),
  };
}

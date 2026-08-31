import { Download, ExternalLink, FileText, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getGeneratedArtifactActionPath, isGeneratedArtifactPreviewable, type GeneratedArtifact } from "./generatedArtifacts";

export function selectMessageGeneratedArtifacts(
  artifacts: GeneratedArtifact[],
  messageId: string,
  runId?: string | null
): GeneratedArtifact[] {
  return artifacts.flatMap(artifact => {
    const references = artifact.references || [artifact];
    const reference = references.find(item => item.messageId === messageId)
      || references.find(item => Boolean(runId && item.runId === runId));
    return reference ? [{ ...artifact, messageId: reference.messageId, runId: reference.runId, requestId: reference.requestId }] : [];
  });
}

export function ChatGeneratedArtifactCards({
  artifacts,
  onPreview,
  onDownload,
}: {
  artifacts: GeneratedArtifact[];
  onPreview?: (path: string) => void;
  onDownload?: (path: string) => void;
}) {
  const { t } = useTranslation("dashboard");
  if (artifacts.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-outline pt-3" data-chat-generated-artifacts="true">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">{t("chatWorkspace.messageGeneratedFiles")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {artifacts.map(artifact => {
          const previewable = isGeneratedArtifactPreviewable(artifact);
          const pending = artifact.status === "generating" || artifact.status === "checking";
          const Icon = pending ? LoaderCircle : previewable ? FileText : TriangleAlert;
          return (
            <div key={artifact.path} className="flex min-w-0 items-center gap-2 rounded-xl border border-outline bg-surface-muted/65 p-2.5">
              <Icon className={`h-4 w-4 shrink-0 ${pending ? "animate-spin text-amber-500" : previewable ? "text-emerald-500" : "text-rose-500"}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-content" title={artifact.path}>{artifact.name}</p>
                <p className="truncate text-[10px] text-content-muted">{t(`chatWorkspace.workspaceGeneratedArtifactStatus_${artifact.status}`)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {onPreview && <button type="button" disabled={!previewable} onClick={() => onPreview(getGeneratedArtifactActionPath(artifact))} className="rounded-md p-1.5 text-content-muted hover:bg-surface hover:text-indigo-600 disabled:opacity-30" title={t("chatWorkspace.workspacePreviewFile")}><ExternalLink className="h-3.5 w-3.5" /></button>}
                {onDownload && <button type="button" disabled={!previewable} onClick={() => onDownload(getGeneratedArtifactActionPath(artifact))} className="rounded-md p-1.5 text-content-muted hover:bg-surface hover:text-emerald-600 disabled:opacity-30" title={t("chatWorkspace.runResultSummaryDownloadFile")}><Download className="h-3.5 w-3.5" /></button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { buildFileDiffLines, type FileDiffResponse, type LocalFileDiff } from "../../../shared/localRunFileDiff";

export function FileDiffLines({ file }: { file: LocalFileDiff }) {
  const lines = useMemo(() => buildFileDiffLines(file.before, file.after), [file]);
  return <pre className="max-h-80 overflow-auto py-2 text-[11px] leading-5" tabIndex={0}>
    {lines.map((line, index) => <div key={index} className={line.kind === "added" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : line.kind === "removed" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "text-content-secondary"}>
      <span aria-hidden="true" className="inline-block w-10 select-none pr-2 text-right opacity-60">{line.before ?? ""}</span>
      <span aria-hidden="true" className="inline-block w-10 select-none pr-2 text-right opacity-60">{line.after ?? ""}</span>
      <span className="inline-block w-4">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>{line.text || " "}
    </div>)}
  </pre>;
}

function LoadedFileDiff({ instanceId, conversationId, runId, filePath }: { instanceId: string; conversationId: string; runId: string; filePath: string }) {
  const { t } = useTranslation("dashboard");
  const [result, setResult] = useState<FileDiffResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ path: filePath, conversationId });
    void api.get<FileDiffResponse>(`/api/instances/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(runId)}/file-diff?${query}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [instanceId, conversationId, runId, filePath]);
  if (failed) return <p role="alert" className="p-3 text-xs text-content-muted">{t("chatWorkspace.fileDiffError")}</p>;
  if (!result) return <p role="status" className="p-3 text-xs text-content-muted">{t("chatWorkspace.fileDiffLoading")}</p>;
  if (!result.available || result.file.path !== filePath) return <p className="p-3 text-xs text-content-muted">{t("chatWorkspace.fileDiffUnavailable")}</p>;
  const kind = result.file.before === null ? "added" : result.file.after === null ? "deleted" : result.file.before === result.file.after ? "unchanged" : "modified";
  return <div className="min-w-0 rounded-lg border border-outline bg-surface" aria-label={t("chatWorkspace.fileDiffTitle")}>
    <div className="space-y-1 border-b border-outline px-3 py-2 text-[11px] text-content-muted">
      <p className="font-semibold">{t(`chatWorkspace.fileDiff_${kind}`)}</p>
      <p>{t("chatWorkspace.fileDiffWindow", { before: new Date(result.capturedBefore).toLocaleString(), after: new Date(result.capturedAfter).toLocaleString() })}</p>
      <p>{t("chatWorkspace.fileDiffNotice")}</p>
    </div>
    <FileDiffLines file={result.file} />
  </div>;
}

export function ChatFileDiff(props: { instanceId: string; conversationId: string; runId: string; filePath: string }) {
  const { t } = useTranslation("dashboard");
  const [open, setOpen] = useState(false);
  const identity = `${props.instanceId}:${props.conversationId}:${props.runId}:${props.filePath}`;
  return <div className="min-w-0 px-2 pb-1">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="rounded px-2 py-1 text-[11px] text-indigo-600 hover:bg-surface dark:text-indigo-300">{t(open ? "chatWorkspace.fileDiffClose" : "chatWorkspace.fileDiffOpen")}</button>
    {open && <LoadedFileDiff key={identity} {...props} />}
  </div>;
}

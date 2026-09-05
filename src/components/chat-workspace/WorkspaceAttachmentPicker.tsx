import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileText, Folder, LoaderCircle, X } from "lucide-react";
import { api } from "../../lib/api";
import { readWorkspaceAttachments, workspaceAttachmentIssue, type WorkspaceAttachmentEntry } from "./workspaceAttachmentSource";

export function WorkspaceAttachmentPicker({ instanceId, instanceName, extensions, maxBytes, remaining, onAdd, onBusyChange, onClose }: {
  instanceId: string; instanceName?: string; extensions: string[] | null; maxBytes: number | null; remaining: number | null;
  onAdd: (files: File[]) => void; onBusyChange: (busy: boolean) => void; onClose: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const dialog = useRef<HTMLDialogElement>(null);
  const transfer = useRef<AbortController | null>(null);
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<WorkspaceAttachmentEntry[]>([]);
  const [selected, setSelected] = useState<WorkspaceAttachmentEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { transfer.current?.abort(); element?.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setEntries([]); setError(""); setQuery("");
    void api.get<{ items: WorkspaceAttachmentEntry[] }>(`/api/instances/${encodeURIComponent(instanceId)}/files?path=${encodeURIComponent(path)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { if (!Array.isArray(result?.items)) throw new Error("workspaceAttachReadFailed"); setEntries(result.items); } })
      .catch(err => { if (!controller.signal.aborted) setError(err?.message === "workspaceAttachReadFailed" ? t("chatWorkspace.workspaceAttachReadFailed") : err?.message || t("chatWorkspace.workspaceAttachReadFailed")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [instanceId, path, revision, t]);
  const close = () => { transfer.current?.abort(); dialog.current?.close(); onBusyChange(false); onClose(); };
  const add = async () => {
    if (busy || !selected.length) return;
    const controller = new AbortController();
    transfer.current = controller; setBusy(true); onBusyChange(true); setError("");
    try {
      const files = await readWorkspaceAttachments({ instanceId, entries: selected, extensions, maxBytes, remaining, signal: controller.signal,
        onProgress: (name, index) => setProgress(t("chatWorkspace.workspaceAttachProgress", { name, index, count: selected.length })) });
      if (controller.signal.aborted) return;
      onAdd(files); close();
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : "";
        setError(message.startsWith("workspaceAttach") ? t(`chatWorkspace.${message}`) : message || t("chatWorkspace.workspaceAttachReadFailed"));
      }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); onBusyChange(false); transfer.current = null; }
    }
  };
  return createPortal(<dialog ref={dialog} aria-label={t("chatWorkspace.workspaceAttachTitle")} onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === dialog.current) close(); }}
    className="m-auto w-[calc(100%_-_24px)] max-w-xl max-h-[min(85dvh,680px)] overflow-hidden rounded-2xl border border-outline bg-surface p-0 text-content shadow-xl backdrop:bg-slate-950/35">
    <div className="flex max-h-[min(85dvh,680px)] flex-col" onClick={event => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3 border-b border-outline p-4">
        <div className="min-w-0"><h2 className="text-sm font-semibold">{t("chatWorkspace.workspaceAttachTitle")}</h2><p className="mt-1 truncate text-xs text-content-muted">{instanceName}</p></div>
        <button type="button" onClick={close} aria-label={t("chatWorkspace.composerClose")} className="h-8 w-8 shrink-0 rounded-lg hover:bg-surface-muted"><X className="m-auto h-4 w-4" /></button>
      </div>
      <div className="space-y-2 border-b border-outline p-3">
        <div className="flex items-center gap-2"><button type="button" disabled={busy || path === "/"} onClick={() => setPath(path.replace(/\/?[^/]+\/?$/, "") || "/")} aria-label={t("chatWorkspace.workspaceAttachUp")} className="h-8 w-8 shrink-0 rounded-lg hover:bg-surface-muted disabled:opacity-40"><ArrowLeft className="m-auto h-4 w-4" /></button><p className="min-w-0 break-all text-xs" title={path}>{path}</p></div>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} aria-label={t("chatWorkspace.workspaceAttachSearch")} placeholder={t("chatWorkspace.workspaceAttachSearch")} className="w-full rounded-lg border border-outline bg-surface px-3 py-2 text-sm" />
      </div>
      <div className="min-h-24 flex-1 overflow-y-auto overscroll-contain p-2">
        {loading ? <p role="status" className="p-3 text-sm text-content-muted">{t("chatWorkspace.workspaceAttachLoading")}</p> : error && entries.length === 0 ? null : entries.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase())).length === 0 ? <p className="p-3 text-sm text-content-muted">{t("chatWorkspace.workspaceAttachEmptyFolder")}</p> : entries.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase())).map(entry => {
          const issue = workspaceAttachmentIssue(entry, extensions, maxBytes);
          const checked = selected.some(file => file.path === entry.path);
          const limitReached = remaining !== null && selected.length >= remaining;
          return entry.type === "directory" ? <button key={entry.path} type="button" disabled={busy || Boolean(issue)} onClick={() => setPath(entry.path)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:opacity-40"><Folder className="h-4 w-4 shrink-0" /><span className="break-all">{entry.name}</span></button>
            : <label key={entry.path} className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
              <input type="checkbox" checked={checked} disabled={busy || Boolean(issue) || (!checked && limitReached)} onChange={() => setSelected(previous => checked ? previous.filter(file => file.path !== entry.path) : [...previous, entry])} aria-label={entry.name} />
              <FileText className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 break-all">{entry.name}<span className="mt-0.5 block text-xs text-content-muted">{issue ? t(`chatWorkspace.${issue}`) : t("chatWorkspace.workspaceAttachBytes", { size: (entry.size || 0).toLocaleString() })}</span></span>
            </label>;
        })}
      </div>
      <div className="space-y-2 border-t border-outline p-3">
        {selected.length > 0 && <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto" aria-label={t("chatWorkspace.workspaceAttachSelected", { count: selected.length })}>
          {selected.map(file => <button key={file.path} type="button" disabled={busy} title={file.path} onClick={() => setSelected(previous => previous.filter(entry => entry.path !== file.path))} aria-label={t("chatWorkspace.workspaceAttachRemove", { name: file.name })} className="flex max-w-full items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-xs disabled:opacity-50"><span className="truncate">{file.name}</span><X className="h-3 w-3 shrink-0" /></button>)}
        </div>}
        {error && <div role="alert" className="text-sm text-red-600 dark:text-red-300">{error}<button type="button" disabled={busy} onClick={() => { setError(""); setRevision(value => value + 1); }} className="ml-2 underline">{t("chatWorkspace.workspaceAttachReload")}</button></div>}
        {busy && <p role="status" className="flex items-center gap-2 break-all text-xs"><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />{progress}</p>}
        <p className="text-xs text-content-muted">{t("chatWorkspace.workspaceAttachCopyHint")}</p>
        <div className="flex items-center justify-between gap-2"><span className="text-xs">{t("chatWorkspace.workspaceAttachSelected", { count: selected.length })}</span><button type="button" disabled={busy || !selected.length} onClick={() => void add()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">{t("chatWorkspace.workspaceAttachAdd")}</button></div>
      </div>
    </div>
  </dialog>, document.body);
}

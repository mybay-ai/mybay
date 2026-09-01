import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { INSTANCE_UPLOAD_EXTENSIONS, INSTANCE_UPLOAD_MAX_BYTES, INSTANCE_UPLOAD_MAX_FILES, isInstanceUploadDirectory, isInstanceUploadFilename } from "../../shared/instanceFileUpload";
import { uploadInstanceFile } from "../lib/instanceFileUpload";

type Entry = { id: string; file: File; directory: string; status: "queued" | "uploading" | "success" | "failed"; progress: number; code?: string };
const knownErrors = new Set(["UPLOAD_TOO_LARGE", "UPLOAD_NAME_INVALID", "UPLOAD_CONTENT_INVALID", "UPLOAD_DIRECTORY_INVALID", "UPLOAD_DIRECTORY_CHANGED", "UPLOAD_EXISTS", "UPLOAD_BUSY", "UPLOAD_QUOTA_UNKNOWN", "UPLOAD_QUOTA_EXCEEDED", "UPLOAD_ACCESS_DENIED", "UPLOAD_NETWORK", "UPLOAD_ABORTED"]);

export function InstanceFileUpload({ instanceId, directory, disabled, onUploaded, onOpenDirectory }: {
  instanceId: string; directory: string; disabled: boolean; onUploaded: (directory: string) => void; onOpenDirectory: (directory: string) => void;
}) {
  const { t } = useTranslation("dashboard");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const target = isInstanceUploadDirectory(directory) ? directory : "/uploads";
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const update = (id: string, change: Partial<Entry>) => { if (mounted.current) setEntries(previous => previous.map(entry => entry.id === id ? { ...entry, ...change } : entry)); };
  const add = (files: File[]) => {
    if (disabled || running.current) return;
    if (files.length + entries.length > INSTANCE_UPLOAD_MAX_FILES) { setNotice(t("files_upload_limit")); return; }
    setNotice("");
    setEntries(previous => [...previous, ...files.map(file => {
      const code = file.size > INSTANCE_UPLOAD_MAX_BYTES ? "UPLOAD_TOO_LARGE" : !isInstanceUploadFilename(file.name) ? "UPLOAD_NAME_INVALID" : undefined;
      return { id: crypto.randomUUID(), file, directory: target, status: code ? "failed" as const : "queued" as const, progress: 0, code };
    })]);
  };
  const run = async (pending: Entry[]) => {
    if (disabled || running.current || !pending.length) return;
    running.current = true; setBusy(true);
    const request = new AbortController(); controller.current = request;
    const changed = new Set<string>();
    try {
      for (const entry of pending) {
        if (request.signal.aborted || !mounted.current) break;
        if (entry.file.size > INSTANCE_UPLOAD_MAX_BYTES || !isInstanceUploadFilename(entry.file.name)) continue;
        update(entry.id, { status: "uploading", progress: 0, code: undefined });
        try {
          await uploadInstanceFile(instanceId, entry.directory, entry.file, request.signal, progress => update(entry.id, { progress }));
          update(entry.id, { status: "success", progress: 100 }); changed.add(entry.directory);
        } catch (error: any) { update(entry.id, { status: "failed", code: error.code || "UPLOAD_FAILED" }); }
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        // Use the latest callback so navigation during upload never jumps back.
        for (const uploadedDirectory of changed) onUploadedRef.current(uploadedDirectory);
      }
    }
  };
  const buttonClass = "min-h-11 rounded-lg border border-outline bg-surface px-3 text-xs text-content disabled:opacity-40";
  return <section aria-label={t("files_upload_title")} className="border-b border-outline p-3 sm:px-5 space-y-3">
    <div className={`rounded-xl border border-dashed p-3 ${dragging ? "border-indigo-500 bg-indigo-500/10" : "border-outline"}`}
      onDragOver={event => { event.preventDefault(); if (!disabled && !busy) setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { setNotice(t("files_upload_no_folder")); return; } add(Array.from(event.dataTransfer.files)); }}>
      <p className="text-sm font-medium text-content">{t("files_upload_title")}</p>
      <p className="mt-1 break-all text-xs text-content-secondary">{t("files_upload_target", { path: target })}</p>
      <p className="mt-1 text-xs text-content-muted">{t("files_upload_hint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input ref={input} type="file" multiple accept={INSTANCE_UPLOAD_EXTENSIONS.join(",")} className="hidden" aria-label={t("files_upload_choose")} onChange={event => { add(Array.from(event.target.files || [])); event.target.value = ""; }} />
        <button className={buttonClass} disabled={disabled || busy} onClick={() => input.current?.click()}><Upload className="mr-1 inline h-4 w-4" />{t("files_upload_choose")}</button>
        <button className={buttonClass} disabled={disabled || busy || !entries.some(entry => entry.status === "queued")} onClick={() => void run(entries.filter(entry => entry.status === "queued"))}>{t("files_upload_start")}</button>
        {busy ? <button className={buttonClass} onClick={() => controller.current?.abort()}>{t("files_upload_stop")}</button> : entries.length > 0 && <button className={buttonClass} onClick={() => setEntries([])}>{t("files_upload_clear")}</button>}
      </div>
    </div>
    {notice && <p role="alert" className="text-xs text-amber-600">{notice}</p>}
    {entries.length > 0 && <ul className="space-y-2" aria-live="polite">{entries.map(entry => <li key={entry.id} className="rounded-lg border border-outline p-2 text-xs">
      <p className="break-all text-content">{entry.file.name} → {entry.directory}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-content-secondary">
        <span>{t(`files_upload_status_${entry.status}`)}{entry.status === "uploading" && ` ${entry.progress}%`}</span>
        {entry.status === "success" && <button className={buttonClass} disabled={disabled || busy} onClick={() => onOpenDirectory(entry.directory)}>{t("files_upload_open_directory")}</button>}
        {entry.status === "uploading" && <progress aria-label={entry.file.name} max={100} value={entry.progress} className="max-w-full" />}
        {entry.status === "failed" && <><span className="break-words text-amber-600">{t(`files_upload_error_${knownErrors.has(entry.code || "") ? entry.code : "UPLOAD_FAILED"}`)}</span>
          {!['UPLOAD_TOO_LARGE', 'UPLOAD_NAME_INVALID'].includes(entry.code || '') && <button disabled={busy || disabled} className={buttonClass} onClick={() => void run([entry])}>{t("files_upload_retry")}</button>}</>}
      </div>
    </li>)}</ul>}
  </section>;
}

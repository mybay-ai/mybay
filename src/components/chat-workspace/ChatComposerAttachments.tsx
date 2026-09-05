import { useState } from "react";
import { FileText, ImageIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PendingAttachment } from "./ChatInputBar";

export const COLLAPSED_ATTACHMENT_COUNT = 3;
const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;

export function attachmentThumbnailUrl(file: PendingAttachment, instanceId?: string, conversationId?: string | null) {
  if (!instanceId || !conversationId || file.size <= 0 || file.size > THUMBNAIL_MAX_BYTES || !/^image\/(png|jpeg|webp|gif|avif|bmp)$/i.test(file.mimeType)) return null;
  // Same-origin cookie authentication and export guards are enforced by the
  // existing inline-download route, also used by the workspace preview.
  return `/api/instances/${encodeURIComponent(instanceId)}/conversations/${encodeURIComponent(conversationId)}/files/${encodeURIComponent(file.id)}/download?disposition=inline`;
}

export function formatComposerAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(3, Math.max(0, Math.floor(Math.log2(bytes || 1) / 10)));
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

function AttachmentCard({ file, instanceId, conversationId, onPreview, onRemove }: {
  file: PendingAttachment; instanceId?: string; conversationId?: string | null;
  onPreview?: (file: PendingAttachment) => void; onRemove?: (id: string) => void;
}) {
  const { t } = useTranslation("dashboard");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const thumbnail = attachmentThumbnailUrl(file, instanceId, conversationId);
  const isImage = file.mimeType.startsWith("image/");
  const extension = /\.([a-z0-9]{1,12})$/i.exec(file.originalName)?.[1].toUpperCase();
  return <div className="flex min-w-0 items-center gap-1 rounded-xl border border-outline bg-surface-muted p-1" data-composer-attachment={file.id}>
    <button type="button" onClick={() => onPreview?.(file)} disabled={!onPreview}
      aria-label={t("chatWorkspace.composerAttachmentPreview", { name: file.originalName })}
      title={file.originalName}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-surface focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-outline/60 bg-surface text-content-muted">
        {thumbnail && failedUrl !== thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(thumbnail)} className="h-full w-full object-cover" />
          : isImage ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-content">{file.originalName}</span>
        <span className="mt-0.5 block truncate text-[11px] text-content-muted">{extension || t(isImage ? "chatWorkspace.composerAttachmentImage" : "chatWorkspace.composerAttachmentFile")} · {formatComposerAttachmentSize(file.size)}</span>
        {thumbnail && failedUrl === thumbnail && <span className="block truncate text-[10px] text-content-muted">{t("chatWorkspace.composerThumbnailUnavailable")}</span>}
      </span>
    </button>
    {onRemove && <button type="button" onClick={() => onRemove(file.id)} aria-label={t("chatWorkspace.workspaceAttachRemove", { name: file.originalName })}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content-muted hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-red-950/30"><X className="h-3.5 w-3.5" /></button>}
  </div>;
}

export function ChatComposerAttachments({ files, instanceId, conversationId, onPreview, onRemove }: {
  files: PendingAttachment[]; instanceId?: string; conversationId?: string | null;
  onPreview?: (file: PendingAttachment) => void; onRemove?: (id: string) => void;
}) {
  const { t } = useTranslation("dashboard");
  const [expanded, setExpanded] = useState(false);
  if (!files.length) return null;
  const visible = expanded ? files : files.slice(0, COLLAPSED_ATTACHMENT_COUNT);
  return <section aria-label={t("chatWorkspace.composerAttachmentsReady", { count: files.length })} className="mx-auto mb-2 max-w-5xl">
    <div className="mb-1.5 flex items-center justify-between gap-2 px-1 text-xs text-content-muted">
      <span>{t("chatWorkspace.composerAttachmentsReady", { count: files.length })}</span>
      {files.length > COLLAPSED_ATTACHMENT_COUNT && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="shrink-0 rounded px-2 py-1 text-indigo-600 hover:bg-surface-muted dark:text-indigo-300">{t(expanded ? "chatWorkspace.composerAttachmentsCollapse" : "chatWorkspace.composerAttachmentsExpand", { count: files.length - COLLAPSED_ATTACHMENT_COUNT })}</button>}
    </div>
    <div className="grid max-h-48 grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-1.5 overflow-y-auto overscroll-contain">
      {visible.map(file => <AttachmentCard key={file.id} file={file} instanceId={instanceId} conversationId={conversationId} onPreview={onPreview} onRemove={onRemove} />)}
    </div>
  </section>;
}

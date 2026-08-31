import { useTranslation } from "react-i18next";
import type { AttachmentUploadItem } from "./attachmentUploadQueue";

export type AttachmentUploadsProps = {
  items: AttachmentUploadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
};

export function ChatAttachmentUploads({ items, onCancel, onRetry, onDismiss }: AttachmentUploadsProps) {
  const { t } = useTranslation("dashboard");
  if (!items.length) return null;
  return <section aria-label={t("chatWorkspace.uploadQueueLabel")} className="mx-auto mb-2 max-h-40 max-w-5xl space-y-2 overflow-auto rounded-lg border border-outline p-2 text-xs">
    {items.map(item => {
      const active = ["queued", "uploading", "confirming"].includes(item.status);
      return <div key={item.id} className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
          <span role="status">{t(`chatWorkspace.uploadStatus_${item.status}`, { percent: item.progress ?? 0 })}</span>
          {active ? <button type="button" className="shrink-0 rounded px-2 py-1 hover:bg-surface-muted" onClick={() => onCancel(item.id)}>{t("chatWorkspace.uploadCancel")}</button>
            : <><button type="button" className="shrink-0 rounded px-2 py-1 hover:bg-surface-muted" onClick={() => onRetry(item.id)}>{t("chatWorkspace.uploadRetry")}</button>
              <button type="button" className="shrink-0 rounded px-2 py-1 hover:bg-surface-muted" onClick={() => onDismiss(item.id)}>{t("chatWorkspace.uploadDismiss")}</button></>}
        </div>
        {active && <progress aria-label={item.name} max={100} value={item.progress ?? undefined} className="h-1 w-full accent-indigo-500" />}
        {!active && <p className="text-content-muted">{item.error && !/^(UPLOAD_|Upload failed)/.test(item.error) && item.status === "failed" ? item.error : t("chatWorkspace.uploadRetryHint")}</p>}
      </div>;
    })}
    <p className="text-content-muted">{t("chatWorkspace.uploadQueueHint")}</p>
  </section>;
}

import { CheckCircle2, FileText, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PendingAttachment } from "./ChatInputBar";

export type PresentedMessageAttachment = { file: PendingAttachment; available: boolean };

function formatAttachmentSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatMessageAttachments({
  attachments,
  onOpen,
}: {
  attachments: PresentedMessageAttachment[];
  onOpen?: (file: PendingAttachment) => void;
}) {
  const { t } = useTranslation("dashboard");
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 grid gap-1.5 border-t border-white/15 pt-2 sm:grid-cols-2" data-chat-message-attachments="true">
      {attachments.map(({ file, available }) => (
        <button
          key={file.id}
          type="button"
          disabled={!available || !onOpen}
          onClick={() => available && onOpen?.(file)}
          className="flex min-w-0 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-2.5 py-2 text-left text-white transition-colors enabled:hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          title={available ? t("chatWorkspace.openFile") : t("chatWorkspace.attachmentUnavailable")}
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold">{file.originalName}</span>
            <span className="block truncate text-[10px] text-white/65">{formatAttachmentSize(file.size)}{file.mimeType ? `${file.size ? " · " : ""}${file.mimeType}` : ""}</span>
          </span>
          {available ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
        </button>
      ))}
    </div>
  );
}

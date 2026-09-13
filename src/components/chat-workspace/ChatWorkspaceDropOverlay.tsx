import { UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";

type DropOverlayState = "not-ready" | "no-conversation" | "limit" | "uploading" | "ready";

interface ChatWorkspaceDropOverlayProps {
  isChatReady: boolean;
  hasActiveConversation: boolean;
  attachmentLimitReached: boolean;
  isUploading: boolean;
  remainingAttachmentSlots: number | null;
}

export function resolveChatWorkspaceDropState({
  isChatReady,
  hasActiveConversation,
  attachmentLimitReached,
  isUploading,
}: Omit<ChatWorkspaceDropOverlayProps, "remainingAttachmentSlots">): DropOverlayState {
  if (!isChatReady) return "not-ready";
  if (!hasActiveConversation) return "no-conversation";
  if (attachmentLimitReached) return "limit";
  if (isUploading) return "uploading";
  return "ready";
}

const copyKeys: Record<DropOverlayState, { titleKey: string; descriptionKey: string }> = {
  "not-ready": {
    titleKey: "dashboard:chatWorkspace.dropFilesNotReady",
    descriptionKey: "dashboard:chatWorkspace.dropFilesNotReadyDesc",
  },
  "no-conversation": {
    titleKey: "dashboard:chatWorkspace.dropFilesNoConversation",
    descriptionKey: "dashboard:chatWorkspace.dropFilesNoConversationDesc",
  },
  limit: {
    titleKey: "dashboard:chatWorkspace.attachmentLimitReached",
    descriptionKey: "dashboard:chatWorkspace.attachmentLimitReachedDesc",
  },
  uploading: {
    titleKey: "dashboard:chatWorkspace.attachmentUploading",
    descriptionKey: "dashboard:chatWorkspace.attachmentUploadingDesc",
  },
  ready: {
    titleKey: "dashboard:chatWorkspace.dropFilesTitle",
    descriptionKey: "dashboard:chatWorkspace.dropFilesDescription",
  },
};

export function ChatWorkspaceDropOverlay(props: ChatWorkspaceDropOverlayProps) {
  const { t } = useTranslation("dashboard");
  const state = resolveChatWorkspaceDropState(props);
  const copy = copyKeys[state];
  const description = state === "ready" && props.remainingAttachmentSlots === null
    ? t("dashboard:chatWorkspace.dropFilesDescriptionUnlimited")
    : t(copy.descriptionKey, { count: props.remainingAttachmentSlots });

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-indigo-500/10 dark:bg-indigo-500/20 backdrop-blur-xs p-4 sm:p-6 transition-all duration-200 pointer-events-none">
      <div className={`flex flex-col items-center justify-center p-6 sm:p-8 rounded-3xl border-2 border-dashed bg-white/95 dark:bg-slate-900/95 shadow-2xl space-y-3 text-center max-w-md mx-auto animate-fade-in ${
        state === "not-ready" || state === "no-conversation"
          ? "border-amber-500/70"
          : state === "limit"
            ? "border-rose-500/70"
            : "border-indigo-500/70"
      }`}>
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-xs">
          <UploadCloud className="w-6 h-6 animate-bounce" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-content">{t(copy.titleKey)}</h3>
          <p className="text-xs text-content-muted mt-1">{description}</p>
        </div>
      </div>
    </div>
  );
}

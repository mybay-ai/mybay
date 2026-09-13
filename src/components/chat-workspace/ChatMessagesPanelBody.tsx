import { AlertCircle, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentInstance } from "../../types";
import { ChatAgentAvatar } from "./ChatAgentAvatar";
import { ChatMessagesLoadingState, ChatNoInstancesEmptyState, ChatWelcomeEmptyState } from "./ChatEmptyStates";
import { ChatMessageList, type ChatMessageListProps } from "./ChatMessageList";

type ChatMessagesPanelBodyProps = {
  hasInstances: boolean;
  loadingInstances: boolean;
  loadingMessages: boolean;
  selectedInstance?: AgentInstance;
  onGoToInstanceManage: () => void;
  onUsePrompt: (prompt: string) => void;
  nextCursorSeq: number | null;
  loadingMoreMessages: boolean;
  onLoadMoreMessages: () => void;
  messageListProps: ChatMessageListProps;
  shouldShowLegacyLoading: boolean;
  activityLabel: string;
  error: string | null;
};

export function ChatMessagesPanelBody({
  hasInstances,
  loadingInstances,
  loadingMessages,
  selectedInstance,
  onGoToInstanceManage,
  onUsePrompt,
  nextCursorSeq,
  loadingMoreMessages,
  onLoadMoreMessages,
  messageListProps,
  shouldShowLegacyLoading,
  activityLabel,
  error
}: ChatMessagesPanelBodyProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const hasMessages = messageListProps.messages.length > 0;

  if (!hasInstances && !loadingInstances) {
    return <ChatNoInstancesEmptyState onGoToInstanceManage={onGoToInstanceManage} />;
  }
  if (loadingMessages && !hasMessages) {
    return <ChatMessagesLoadingState />;
  }
  if (!hasMessages && !messageListProps.run.detachedMessage) {
    return <ChatWelcomeEmptyState selectedInstance={selectedInstance} loadingInstances={loadingInstances} onUsePrompt={onUsePrompt} />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 2xl:max-w-6xl">
      {nextCursorSeq !== null && (
        <div className="flex justify-center my-4">
          <button
            type="button"
            onClick={onLoadMoreMessages}
            disabled={loadingMoreMessages}
            className="text-[13px] text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 font-medium disabled:opacity-50 cursor-pointer border border-indigo-150 shadow-xs dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15 dark:text-indigo-300 dark:hover:text-indigo-200 dark:border-indigo-400/20"
          >
            {loadingMoreMessages ? t("dashboard:chatWorkspace.loadingMore") : t("dashboard:chatWorkspace.loadEarlierMessages")}
          </button>
        </div>
      )}

      <ChatMessageList {...messageListProps} />

      {shouldShowLegacyLoading && (
        <div className="flex gap-3.5 justify-start animate-pulse">
          <div className="relative h-8 w-8 shrink-0">
            <ChatAgentAvatar instance={selectedInstance} />
            <LoaderCircle className="absolute -bottom-1 -right-1 h-3.5 w-3.5 animate-spin rounded-full bg-surface p-0.5 text-indigo-600" />
          </div>
          <div className="bg-surface/95 border border-outline/80 rounded-2xl rounded-tl-md px-4 py-3 text-[14px] leading-6 flex items-center gap-2 text-content-muted shadow-xs">
            <div className="flex space-x-1">
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce dark:bg-slate-500" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce dark:bg-slate-500" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce dark:bg-slate-500" style={{ animationDelay: "300ms" }} />
            </div>
            <span>{activityLabel}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex gap-3.5 justify-center max-w-lg mx-auto">
          <div className="bg-red-50 border border-red-200/60 text-red-700 rounded-xl p-3.5 text-[13px] flex items-start gap-2.5 shadow-sm dark:bg-rose-950/35 dark:border-rose-500/30 dark:text-rose-200">
            <AlertCircle className="w-4.5 h-4.5 text-red-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-red-800 dark:text-rose-100">{t("dashboard:chatWorkspace.errorTitle")}</p>
              <p className="text-red-600/95 leading-relaxed dark:text-rose-200/90">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

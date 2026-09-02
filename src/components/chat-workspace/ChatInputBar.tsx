import { useEffect, useState, useRef, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Brain, ChevronDown, CornerDownLeft, FileText, Gauge, HelpCircle, Image as ImageIcon, Layers, Paperclip, Send, Sparkles, Square, X, Zap } from "lucide-react";

import type { ChatRunMetrics, RunsCapabilityState } from "./useChatRuns";
import { DIRECT_CHAT_ATTACHMENT_EXTENSIONS, type ChatAttachmentConfig, isChatAttachmentLimitReached } from "../../../shared/chatAttachmentContract";
import { CHAT_WORKSPACE_TABLET_BREAKPOINT } from "./chatWorkspaceResponsiveLayout";
import { ChatLongTextCards, handleLongTextPaste, type LongTextComposerActions } from "./ChatLongTextCards";
import { LONG_TEXT_TYPED_SUGGESTION_THRESHOLD, serializeLongTextDraft, type PendingLongTextBlock } from "./composerLongText";
import { MAX_CHAT_USER_MESSAGE_CHARS, countChatMessageCharacters } from "../../../shared/chatMessageContract";
import { ChatAttachmentUploads, type AttachmentUploadsProps } from "./ChatAttachmentUploads";
import { handleClipboardAttachments } from "./clipboardAttachments";
export type PendingAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
};


export type ChatReasoningEffort = "fast" | "balanced" | "deep";

type ChatInputBarProps = {
  attachmentUploads?: AttachmentUploadsProps;
  longTextComposer?: LongTextComposerActions & { blocks: PendingLongTextBlock[] };
  pendingAttachments?: PendingAttachment[];
  onUpload?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  isUploading?: boolean;
  creatingConversation?: boolean;
  loadingConversations?: boolean;
  attachmentConfig: ChatAttachmentConfig;
  input: string;
  sending: boolean;
  activeRunId: string | null;
  stopPending?: boolean;
  isChatReady: boolean;
  selectedChannel: string;
  selectedInstanceName?: string;
  runMetrics?: ChatRunMetrics | null;
  hasActiveConversation?: boolean;
  chatMode: "quick" | "assist" | "agent";
  onChatModeChange: (mode: "quick" | "agent") => void;
  reasoningEffort: ChatReasoningEffort;
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void;
  agentAvailable: boolean;
  agentCapabilityState: RunsCapabilityState;
  onInputChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStopRun: () => void;
  onInputFocus?: () => void;
  mobileKeyboardOpen?: boolean;
};

export function shouldIgnoreComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export function ChatInputBar({
  attachmentUploads,
  input,
  longTextComposer,
  sending,
  activeRunId,
  stopPending = false,
  isChatReady,
  selectedChannel,
  selectedInstanceName,
  runMetrics = null,
  hasActiveConversation = true,
  chatMode,
  onChatModeChange,
  reasoningEffort,
  onReasoningEffortChange,
  agentAvailable,
  agentCapabilityState,
  onInputChange,
  onSubmit,
  onKeyDown,
  onStopRun,
  onInputFocus,
  mobileKeyboardOpen = false,
  pendingAttachments = [],
  onUpload,
  onRemoveAttachment,
  isUploading,
  creatingConversation = false,
  loadingConversations = false,
  attachmentConfig
}: ChatInputBarProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const [isCompactInput, setIsCompactInput] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerText = serializeLongTextDraft(longTextComposer?.blocks || [], input);
  const composerCharacters = countChatMessageCharacters(composerText.trim());
  const messageTooLong = composerCharacters > MAX_CHAT_USER_MESSAGE_CHARS;
  const conversationUnavailable = creatingConversation || loadingConversations;
  const conversationUnavailableMessage = t(loadingConversations
    ? "dashboard:chatWorkspace.loadingConversations"
    : "dashboard:chatWorkspace.creatingConversation");


  useEffect(() => {
    const updateCompactState = () => setIsCompactInput(window.innerWidth < CHAT_WORKSPACE_TABLET_BREAKPOINT);
    updateCompactState();
    window.addEventListener("resize", updateCompactState);
    return () => window.removeEventListener("resize", updateCompactState);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const mobile = window.innerWidth < CHAT_WORKSPACE_TABLET_BREAKPOINT;
    const minHeight = mobile ? 56 : 64;
    const maxHeight = mobile ? (mobileKeyboardOpen ? 120 : 200) : 220;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input, mobileKeyboardOpen]);
  const placeholder = !isChatReady
    ? (isCompactInput
      ? t("dashboard:chatWorkspace.notReadyPlaceholderMobile")
      : (selectedChannel === "web" || selectedChannel === "none"
        ? t("dashboard:chatWorkspace.webOnlyNotReadyTooltip")
        : t("dashboard:chatWorkspace.externalNotReadyTooltip")))
    : (sending
      ? t(isCompactInput ? "dashboard:chatWorkspace.sendWhileRunningPlaceholderMobile" : "dashboard:chatWorkspace.sendWhileRunningPlaceholder")
      : t(isCompactInput ? "dashboard:chatWorkspace.sendPlaceholderMobile" : "dashboard:chatWorkspace.sendPlaceholder"));

  const handleKeyDownInternal = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldIgnoreComposerKeyDown(e)) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && (!isChatReady || isUploading || conversationUnavailable || messageTooLong)) {
      e.preventDefault();
      return;
    }
    onKeyDown(e);
  };

  const modeOptions = [
    {
      id: "quick" as const,
      label: t("dashboard:chatWorkspace.modeQuick"),
      desc: t("dashboard:chatWorkspace.modeQuickTooltip"),
      icon: Zap
    },
    {
      id: "agent" as const,
      label: t("dashboard:chatWorkspace.modeAgent"),
      desc: t("dashboard:chatWorkspace.modeAgentTooltip"),
      icon: Sparkles
    }
  ];
  const agentModeBlocked = chatMode === "agent" && !agentAvailable;
  const agentUnavailableMessage = agentCapabilityState === "disabled"
    ? t("dashboard:chatWorkspace.asyncRunsDisabled")
    : agentCapabilityState === "explicitly_unsupported"
      ? t("dashboard:chatWorkspace.asyncRunsUnsupported")
      : agentCapabilityState === "unavailable"
        ? t("dashboard:chatWorkspace.asyncRunsUnavailable")
        : t("dashboard:chatWorkspace.asyncRunsChecking");

  const activeMode = chatMode === "assist"
    ? {
        id: "assist" as const,
        label: t("dashboard:chatWorkspace.modeAssist"),
        desc: t("dashboard:chatWorkspace.modeAssistTooltip"),
        icon: HelpCircle
      }
    : (modeOptions.find((mode) => mode.id === chatMode) || modeOptions[0]);
  const ActiveModeIcon = activeMode.icon;

  const reasoningOptions = [
    { id: "fast" as const, label: t("dashboard:chatWorkspace.reasoningEffortFast"), desc: t("dashboard:chatWorkspace.reasoningEffortFastDesc"), icon: Zap },
    { id: "balanced" as const, label: t("dashboard:chatWorkspace.reasoningEffortBalanced"), desc: t("dashboard:chatWorkspace.reasoningEffortBalancedDesc"), icon: Gauge },
    { id: "deep" as const, label: t("dashboard:chatWorkspace.reasoningEffortDeep"), desc: t("dashboard:chatWorkspace.reasoningEffortDeepDesc"), icon: Brain }
  ];
  const activeReasoning = reasoningOptions.find((option) => option.id === reasoningEffort) || reasoningOptions[1];
  const ActiveReasoningIcon = activeReasoning.icon;
  const configuredExtensions = attachmentConfig.allowedExtensions;
  const uploadExtensions = chatMode === "agent"
    ? configuredExtensions
    : DIRECT_CHAT_ATTACHMENT_EXTENSIONS.filter((extension) => configuredExtensions === null || configuredExtensions.includes(extension));
  const attachmentLimitReached = isChatAttachmentLimitReached(pendingAttachments.length, attachmentConfig.maxFiles);

  const formatDuration = (value?: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    if (value < 1000) return Math.round(value) + "ms";
    const seconds = value / 1000;
    if (seconds < 60) return seconds.toFixed(seconds >= 10 ? 0 : 1) + "s";
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return minutes + "m " + rest + "s";
  };

  const formatTokens = (value?: number | null) => (
    typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "-"
  );


  const runActivityLabel = runMetrics?.status === "status_unknown"
    ? t("dashboard:chatWorkspace.runStatusUnknown")
    : runMetrics?.transportState === "reconnecting"
      ? t("dashboard:chatWorkspace.inputStatusReconnecting")
      : runMetrics?.transportState === "polling"
        ? t("dashboard:chatWorkspace.inputStatusPollingRecovery")
        : runMetrics?.transportState === "connecting"
          ? t("dashboard:chatWorkspace.inputStatusConnecting")
          : t("dashboard:chatWorkspace.inputStatusRunning");

  return (
    <div className={"shrink-0 border-t border-outline/80 bg-surface/90 px-3 backdrop-blur sm:px-4 sm:pb-3 sm:pt-3 " + (mobileKeyboardOpen ? "pb-2 pt-1.5" : "pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5")}>

      {attachmentUploads && <ChatAttachmentUploads {...attachmentUploads} />}
      {(pendingAttachments.length > 0 || (isUploading && !attachmentUploads)) && (
        <div className="flex flex-wrap gap-2 mb-2 px-1 max-w-5xl mx-auto">
          {pendingAttachments.map((att) => (
            <div key={att.id} className="flex items-center gap-1.5 bg-surface-muted text-content-secondary px-2 py-1 rounded-lg text-[13px] border border-outline">
              {att.mimeType.startsWith('image/') ? <ImageIcon className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              <span className="truncate max-w-[120px]" title={att.originalName}>{att.originalName}</span>
              <button type="button" onClick={() => onRemoveAttachment?.(att.id)} className="text-slate-400 hover:text-red-500 transition-colors ml-1">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {isUploading && !attachmentUploads && (
            <div className="flex items-center gap-1.5 bg-surface-muted text-slate-500 px-2 py-1 rounded-md text-[13px] border border-outline animate-pulse">
              {t("dashboard:chatWorkspace.attachmentUploading")}
            </div>
          )}
        </div>
      )}
      <form onSubmit={onSubmit} onPasteCapture={event => { handleClipboardAttachments(event, onUpload); }} className="w-full max-w-5xl mx-auto">
        <div className="relative rounded-2xl border border-outline bg-surface shadow-sm shadow-slate-200/60 transition-all focus-within:border-indigo-500 focus-within:shadow-md focus-within:shadow-indigo-100/60 focus-within:ring-2 focus-within:ring-indigo-500/10 dark:shadow-slate-950/40 dark:focus-within:border-indigo-400 dark:focus-within:shadow-slate-950/60 dark:focus-within:ring-indigo-400/15">
          {longTextComposer && <ChatLongTextCards blocks={longTextComposer.blocks} actions={longTextComposer} disabled={!isChatReady} onKeyDown={handleKeyDownInternal} />}
          {longTextComposer && countChatMessageCharacters(input) >= LONG_TEXT_TYPED_SUGGESTION_THRESHOLD && (
            <button type="button" disabled={!isChatReady} className="mx-3 mt-2 rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              onClick={() => { longTextComposer.insert(input, 0, input.length); textareaRef.current?.focus(); }}>
              {t("dashboard:chatWorkspace.longTextCollapse")}
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onPaste={longTextComposer ? event => { handleLongTextPaste(event, longTextComposer.insert); } : undefined}
            onKeyDown={handleKeyDownInternal}
            onFocus={onInputFocus}
            placeholder={placeholder}
            disabled={!isChatReady}
            rows={1}
            className={"w-full resize-none border-0 bg-transparent px-4 pb-12 text-[16px] leading-6 text-content placeholder:text-content-muted focus:outline-none scrollbar-none disabled:cursor-not-allowed disabled:text-content-muted sm:min-h-16 sm:max-h-[220px] sm:pt-3 sm:text-[14px] " + (mobileKeyboardOpen ? "min-h-14 max-h-[120px] pt-2.5" : "min-h-14 max-h-[200px] pt-3")}
          />


          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            accept={uploadExtensions === null ? undefined : uploadExtensions.join(",")}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0 && onUpload) {
                onUpload(e.target.files);
                e.target.value = ''; // reset
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isChatReady || !hasActiveConversation || attachmentLimitReached || isUploading}
            className={`absolute left-3 bottom-2.5 h-8 ${pendingAttachments.length > 0 ? "min-w-8 px-2" : "w-8"} rounded-lg text-content-muted hover:text-indigo-600 hover:bg-indigo-50 inline-flex items-center justify-center gap-1 transition-all dark:hover:text-indigo-300 dark:hover:bg-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed`}
            title={!hasActiveConversation ? t("dashboard:chatWorkspace.dropFilesNoConversation") : t("dashboard:chatWorkspace.attachmentEntry")}
            aria-label={t("dashboard:chatWorkspace.attachmentEntry")}
          >
            <Paperclip className="w-4 h-4" />
            {pendingAttachments.length > 0 && (
              <span className="text-[10px] font-semibold tabular-nums">
                {pendingAttachments.length}/{attachmentConfig.maxFiles === null ? "∞" : attachmentConfig.maxFiles}
              </span>
            )}
          </button>

          <div className={`absolute bottom-2.5 flex items-center gap-1.5 select-none ${pendingAttachments.length > 0 ? "left-[5.5rem]" : "left-12"}`}>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModeMenuOpen((open) => !open);
                  setReasoningMenuOpen(false);
                }}
                className="h-8 rounded-lg border border-outline bg-surface-muted px-2.5 text-[12px] font-semibold text-content-secondary hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 inline-flex items-center gap-1.5 transition-all dark:hover:border-indigo-400/40 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-200"
                title={activeMode.desc}
                aria-haspopup="menu"
                aria-expanded={modeMenuOpen}
              >
                <ActiveModeIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="max-md:max-w-[72px] truncate">{activeMode.label}</span>
                <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
              </button>
              {modeMenuOpen && (
                <div className="absolute bottom-10 left-0 z-30 w-64 rounded-xl border border-outline bg-surface p-1.5 shadow-xl shadow-slate-200/70 dark:shadow-slate-950/60">
                  {modeOptions.map((mode) => {
                    const Icon = mode.icon;
                    const active = chatMode === mode.id;
                    const disabled = mode.id === "agent" && !agentAvailable;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          onChatModeChange(mode.id);
                          setModeMenuOpen(false);
                        }}
                        className={[
                          "w-full rounded-lg px-2.5 py-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45",
                          active
                            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                            : "text-content-secondary hover:bg-surface-muted hover:text-content"
                        ].join(" ")}
                        title={disabled ? agentUnavailableMessage : mode.desc}
                      >
                        <span className="flex items-center gap-2 text-[13px] font-semibold">
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          {mode.label}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-4 opacity-75">{mode.desc}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setReasoningMenuOpen((open) => !open);
                  setModeMenuOpen(false);
                }}
                className="h-8 rounded-lg border border-outline bg-surface-muted px-2.5 text-[12px] font-semibold text-content-secondary hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 inline-flex items-center gap-1.5 transition-all dark:hover:border-indigo-400/40 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-200"
                title={activeReasoning.desc}
                aria-haspopup="menu"
                aria-expanded={reasoningMenuOpen}
              >
                <ActiveReasoningIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="max-md:max-w-[56px] truncate">{activeReasoning.label}</span>
                <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
              </button>
              {reasoningMenuOpen && (
                <div className="absolute bottom-10 left-0 z-30 w-64 rounded-xl border border-outline bg-surface p-1.5 shadow-xl shadow-slate-200/70 dark:shadow-slate-950/60">
                  {reasoningOptions.map((option) => {
                    const Icon = option.icon;
                    const active = reasoningEffort === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          onReasoningEffortChange(option.id);
                          setReasoningMenuOpen(false);
                        }}
                        className={[
                          "w-full rounded-lg px-2.5 py-2 text-left transition-all",
                          active
                            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                            : "text-content-secondary hover:bg-surface-muted hover:text-content"
                        ].join(" ")}
                        title={option.desc}
                      >
                        <span className="flex items-center gap-2 text-[13px] font-semibold">
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-4 opacity-75">{option.desc}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5 select-none">
            {sending && (
              <span
                className="inline-flex h-8 items-center gap-1.5 px-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300"
                aria-label={runActivityLabel}
                title={runActivityLabel}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 motion-safe:animate-pulse" />
                <span className="hidden md:inline">{runActivityLabel}</span>
              </span>
            )}
            {sending && (
              <button
                type="button"
                onClick={onStopRun}
                disabled={stopPending}
                className="h-8 w-8 bg-transparent hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 text-rose-600 rounded-lg transition-all inline-flex items-center justify-center border border-rose-200 cursor-pointer dark:hover:bg-rose-950/40 dark:text-rose-300 dark:border-rose-500/40"
                title={t("dashboard:chatWorkspace.stopTaskTitle")}
                aria-label={t("dashboard:chatWorkspace.stopTaskTitle")}
              >
                {stopPending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Square className="w-3.5 h-3.5 shrink-0 fill-current" />}
              </button>
            )}
            <span className="hidden lg:inline-flex items-center gap-0.5 px-0.5 text-[11px] text-content-muted font-medium">
              <CornerDownLeft className="w-2.5 h-2.5" />
              Enter
            </span>
            <button
              type="submit"
              disabled={!composerText.trim() || messageTooLong || !isChatReady || isUploading || conversationUnavailable || agentModeBlocked}
              className="h-8 w-8 bg-indigo-600 hover:bg-indigo-700 disabled:bg-outline disabled:text-content-muted text-white rounded-lg transition-all inline-flex items-center justify-center shadow-sm shadow-indigo-200/70 dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:shadow-none"
              title={conversationUnavailable ? conversationUnavailableMessage : agentModeBlocked ? agentUnavailableMessage : sending ? t("dashboard:chatWorkspace.interruptAndSendTitle") : t("dashboard:chatWorkspace.sendBtnTitle")}
              aria-label={conversationUnavailable ? conversationUnavailableMessage : agentModeBlocked ? agentUnavailableMessage : sending ? t("dashboard:chatWorkspace.interruptAndSendTitle") : t("dashboard:chatWorkspace.sendBtnTitle")}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
        {conversationUnavailable && <p role="status" className="mt-2 px-2 text-xs text-content-muted">{conversationUnavailableMessage}</p>}
        {messageTooLong && <p role="alert" className="mt-2 px-2 text-xs text-red-600 dark:text-red-400">{t("dashboard:chatWorkspace.messageTooLong", { max: MAX_CHAT_USER_MESSAGE_CHARS.toLocaleString() })}</p>}
        {agentModeBlocked && <p role="status" className="mt-2 px-2 text-xs text-amber-700 dark:text-amber-300">{agentUnavailableMessage}</p>}
        <div className={`mt-1.5 items-center gap-3 px-2 text-[11px] text-content-muted ${mobileKeyboardOpen ? "hidden" : "hidden md:flex"}`}>
          <div
            className="inline-flex min-w-0 items-center gap-1.5"
            title={`${t("dashboard:chatWorkspace.inputStatusInstance")}: ${selectedInstanceName?.trim() || t("dashboard:chatWorkspace.inputStatusNoInstance")}`}
          >
            <Layers className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="shrink-0">{t("dashboard:chatWorkspace.inputStatusInstance")}</span>
            <span className="max-w-40 truncate font-medium text-content-secondary">
              {selectedInstanceName?.trim() || t("dashboard:chatWorkspace.inputStatusNoInstance")}
            </span>
          </div>
          {(typeof runMetrics?.durationMs === "number" || typeof runMetrics?.usageTotalTokens === "number") && (
            <div className="inline-flex min-w-0 items-center gap-1.5" title={t("dashboard:chatWorkspace.inputStatusLastRun")}>
              <Activity className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="shrink-0">{t("dashboard:chatWorkspace.inputStatusLastRun")}</span>
              <span className="min-w-0 truncate font-medium text-content-secondary">
                {formatDuration(runMetrics?.durationMs)} · {formatTokens(runMetrics?.usageTotalTokens)} tokens
              </span>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

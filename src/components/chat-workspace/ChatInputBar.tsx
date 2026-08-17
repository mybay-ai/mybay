import { useEffect, useState, useRef, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Brain, ChevronDown, Clock3, CornerDownLeft, FileText, Gauge, HelpCircle, Image as ImageIcon, Layers, Paperclip, Send, Sparkles, X, Zap } from "lucide-react";

import type { ChatRunMetrics, RunsCapabilityState } from "./useChatRuns";
import { DIRECT_CHAT_ATTACHMENT_EXTENSIONS, type ChatAttachmentConfig, isChatAttachmentLimitReached } from "../../../shared/chatAttachmentContract";
export type PendingAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
};


export type ChatReasoningEffort = "fast" | "balanced" | "deep";

type ChatInputBarProps = {
  pendingAttachments?: PendingAttachment[];
  onUpload?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  isUploading?: boolean;
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
};

export function shouldIgnoreComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export function ChatInputBar({
  input,
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
  pendingAttachments = [],
  onUpload,
  onRemoveAttachment,
  isUploading,
  attachmentConfig
}: ChatInputBarProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const [isCompactInput, setIsCompactInput] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);


  useEffect(() => {
    const updateCompactState = () => setIsCompactInput(window.innerWidth < 640);
    updateCompactState();
    window.addEventListener("resize", updateCompactState);
    return () => window.removeEventListener("resize", updateCompactState);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = window.innerWidth < 640 ? 200 : 240;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 88), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);
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
    if (e.key === "Enter" && !e.shiftKey && isUploading) {
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


  const inputStatusItems = [
    {
      id: "instance",
      icon: Layers,
      label: t("dashboard:chatWorkspace.inputStatusInstance"),
      value: selectedInstanceName?.trim() || t("dashboard:chatWorkspace.inputStatusNoInstance")
    },
    {
      id: "mode",
      icon: ActiveModeIcon,
      label: t("dashboard:chatWorkspace.inputStatusMode"),
      value: activeMode.label
    },
    {
      id: "reasoning",
      icon: ActiveReasoningIcon,
      label: t("dashboard:chatWorkspace.inputStatusReasoning"),
      value: activeReasoning.label
    },
    {
      id: "attachments",
      icon: Paperclip,
      label: t("dashboard:chatWorkspace.inputStatusAttachments"),
      value: String(pendingAttachments.length) + "/" + (attachmentConfig.maxFiles === null ? "∞" : String(attachmentConfig.maxFiles))
    },
    {
      id: "usage",
      icon: Activity,
      label: t("dashboard:chatWorkspace.inputStatusLastRun"),
      value: formatDuration(runMetrics?.durationMs) + " · " + formatTokens(runMetrics?.usageTotalTokens) + " tokens"
    }
  ];

  return (
    <div className="border-t border-outline/80 px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4 bg-surface/90 backdrop-blur shrink-0">

      {(pendingAttachments.length > 0 || isUploading) && (
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
          {isUploading && (
            <div className="flex items-center gap-1.5 bg-surface-muted text-slate-500 px-2 py-1 rounded-md text-[13px] border border-outline animate-pulse">
              {t("dashboard:chatWorkspace.attachmentUploading")}
            </div>
          )}
        </div>
      )}
      <form onSubmit={onSubmit} className="w-full max-w-5xl mx-auto">
        <div className="relative rounded-2xl border border-outline bg-surface shadow-lg shadow-slate-200/60 transition-all focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/15 dark:shadow-slate-950/40 dark:focus-within:border-indigo-400 dark:focus-within:ring-indigo-400/20">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDownInternal}
            onFocus={onInputFocus}
            placeholder={placeholder}
            disabled={!isChatReady}
            rows={1}
            className="w-full min-h-[88px] sm:min-h-[92px] max-h-[200px] sm:max-h-[240px] resize-none border-0 bg-transparent px-4 pb-12 pt-4 text-[16px] sm:text-[14px] leading-6 text-content placeholder:text-content-muted focus:outline-none scrollbar-none disabled:cursor-not-allowed disabled:text-content-muted"
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
            className="absolute left-3 bottom-2.5 h-8 w-8 rounded-lg text-content-muted hover:text-indigo-600 hover:bg-indigo-50 inline-flex items-center justify-center transition-all dark:hover:text-indigo-300 dark:hover:bg-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!hasActiveConversation ? t("dashboard:chatWorkspace.dropFilesNoConversation") : t("dashboard:chatWorkspace.attachmentEntry")}
            aria-label={t("dashboard:chatWorkspace.attachmentEntry")}
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <div className="absolute left-12 bottom-2.5 flex items-center gap-1.5 select-none">
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
                <span className="max-sm:max-w-[72px] truncate">{activeMode.label}</span>
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
                <span className="max-sm:max-w-[56px] truncate">{activeReasoning.label}</span>
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
              <button
                type="button"
                onClick={onStopRun}
                disabled={stopPending}
                className="h-8 w-8 bg-rose-50 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60 text-rose-600 rounded-lg transition-all inline-flex items-center justify-center border border-rose-200 shadow-xs cursor-pointer dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 dark:border-rose-500/40"
                title={t("dashboard:chatWorkspace.stopTaskTitle")}
              >
                <X className="w-4 h-4 shrink-0" />
              </button>
            )}
            <span className="hidden md:inline-flex items-center gap-0.5 text-[11px] text-content-muted font-medium bg-surface-muted px-1.5 py-0.5 rounded border border-outline/60">
              <CornerDownLeft className="w-2.5 h-2.5" />
              Enter
            </span>
            <button
              type="submit"
              disabled={!input.trim() || !isChatReady || isUploading || agentModeBlocked}
              className="h-8 w-8 bg-slate-950 hover:bg-slate-800 disabled:bg-outline disabled:text-content-muted text-white rounded-lg transition-all inline-flex items-center justify-center shadow-xs dark:bg-indigo-600 dark:hover:bg-indigo-500"
              title={agentModeBlocked ? agentUnavailableMessage : sending ? t("dashboard:chatWorkspace.interruptAndSendTitle") : t("dashboard:chatWorkspace.sendBtnTitle")}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-content-muted">
          {inputStatusItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-outline/70 bg-surface/75 px-2 py-1 shadow-xs">
                <Icon className="h-3 w-3 shrink-0 text-slate-400" />
                <span className="shrink-0 text-slate-400">{item.label}</span>
                <span className="min-w-0 truncate font-medium text-content-secondary">{item.value}</span>
              </div>
            );
          })}
          {sending && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-600 dark:border-indigo-400/25 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Clock3 className="h-3 w-3 motion-safe:animate-pulse" />
              {t("dashboard:chatWorkspace.inputStatusRunning")}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

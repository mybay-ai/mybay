import { ChatComposerAttachments } from "./ChatComposerAttachments";
import "./ChatComposerControls.css";
import { WorkspaceAttachmentPicker } from "./WorkspaceAttachmentPicker";
import { ChatComposerControls } from "./ChatComposerControls";
import { useEffect, useState, useRef, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Activity, CornerDownLeft, Layers, Send, Square } from "lucide-react";

import type { ChatRunMetrics, RunsCapabilityState } from "./useChatRuns";
import { DIRECT_CHAT_ATTACHMENT_EXTENSIONS, type ChatAttachmentConfig, isChatAttachmentLimitReached } from "../../../shared/chatAttachmentContract";
import { CHAT_WORKSPACE_TABLET_BREAKPOINT } from "./chatWorkspaceResponsiveLayout";
import { ChatLongTextCards, handleLongTextPaste, type LongTextComposerActions } from "./ChatLongTextCards";
import { LONG_TEXT_TYPED_SUGGESTION_THRESHOLD, serializeLongTextDraft, type PendingLongTextBlock } from "./composerLongText";
import { MAX_CHAT_USER_MESSAGE_CHARS, countChatMessageCharacters } from "../../../shared/chatMessageContract";
import { ChatAttachmentUploads, type AttachmentUploadsProps } from "./ChatAttachmentUploads";
import { handleClipboardAttachments } from "./clipboardAttachments";
import { formatLocalizedDuration } from "./localizedDuration";
import { ChatComposerSuggestionMenu } from "./ChatComposerSuggestionMenu";
import { filterComposerSuggestions, findComposerTrigger, replaceComposerTrigger, type ComposerCommandId, type ComposerCommandSuggestion, type ComposerSuggestion } from "./chatComposerSuggestions";
import { useChatComposerPeers } from "./useChatComposerPeers";
import { ChatGroupRoomControl } from "./ChatGroupRoomControl";
import type { ChatGroupConfig } from "../../../shared/chatCollaboration";
export type PendingAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
};


export type ChatReasoningEffort = "fast" | "balanced" | "deep";

type ChatInputBarProps = {
  workspaceContext?: { instanceId: string; conversationId: string | null };
  onAddWorkspaceFiles?: (instanceId: string, conversationId: string, files: File[]) => void;
  attachmentUploads?: AttachmentUploadsProps;
  longTextComposer?: LongTextComposerActions & { blocks: PendingLongTextBlock[] };
  pendingAttachments?: PendingAttachment[];
  onUpload?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onPreviewAttachment?: (file: PendingAttachment) => void;
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
  onComposerCommand?: (command: ComposerCommandId) => void;
  collaboration?: ChatGroupConfig | null;
  onCollaborationChange?: (collaboration: ChatGroupConfig | null) => Promise<void> | void;
  onInputFocus?: () => void;
  mobileKeyboardOpen?: boolean;
};

export function shouldIgnoreComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export function ChatInputBar({
  workspaceContext, onAddWorkspaceFiles,
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
  onComposerCommand,
  collaboration,
  onCollaborationChange,
  onInputFocus,
  mobileKeyboardOpen = false,
  pendingAttachments = [],
  onUpload,
  onRemoveAttachment,
  onPreviewAttachment,
  isUploading: uploadBusy,
  creatingConversation = false,
  loadingConversations = false,
  attachmentConfig
}: ChatInputBarProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const [isCompactInput, setIsCompactInput] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspaceCopying, setWorkspaceCopying] = useState(false);
  const [composerCursor, setComposerCursor] = useState(input.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const isUploading = uploadBusy || workspaceCopying;
  useEffect(() => { setWorkspacePickerOpen(false); setWorkspaceCopying(false); }, [workspaceContext?.instanceId, workspaceContext?.conversationId]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const a2aPeers = useChatComposerPeers(workspaceContext?.instanceId);
  const composerTrigger = findComposerTrigger(input, composerCursor);
  const commandSuggestions: ComposerCommandSuggestion[] = [
    { kind: "command", id: "new", label: t("dashboard:chatWorkspace.composerCommandNew"), description: t("dashboard:chatWorkspace.composerCommandNewDesc") },
    { kind: "command", id: "stop", label: t("dashboard:chatWorkspace.composerCommandStop"), description: t("dashboard:chatWorkspace.composerCommandStopDesc"), disabled: !sending },
    { kind: "command", id: "model", label: t("dashboard:chatWorkspace.composerCommandModel"), description: t("dashboard:chatWorkspace.composerCommandModelDesc") },
    { kind: "command", id: "agents", label: t("dashboard:chatWorkspace.composerCommandAgents"), description: t("dashboard:chatWorkspace.composerCommandAgentsDesc") },
    { kind: "command", id: "call", label: t("dashboard:chatWorkspace.composerCommandCall"), description: t("dashboard:chatWorkspace.composerCommandCallDesc") },
    { kind: "command", id: "all", label: t("dashboard:chatWorkspace.composerCommandAll"), description: t("dashboard:chatWorkspace.composerCommandAllDesc") },
    { kind: "command", id: "help", label: t("dashboard:chatWorkspace.composerCommandHelp"), description: t("dashboard:chatWorkspace.composerCommandHelpDesc") },
  ];
  const composerSuggestions: ComposerSuggestion[] = composerTrigger?.kind === "command"
    ? filterComposerSuggestions(commandSuggestions, composerTrigger.query)
    : composerTrigger?.kind === "mention"
      ? filterComposerSuggestions(a2aPeers.map(peer => ({ ...peer, kind: "mention" as const })), composerTrigger.query)
      : [];
  const suggestionMenuOpen = Boolean(composerTrigger) && (composerTrigger?.kind === "mention" || composerSuggestions.length > 0);
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

  useEffect(() => {
    setSuggestionIndex(0);
  }, [composerTrigger?.kind, composerTrigger?.query]);

  const focusComposerAt = (cursor: number) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
      setComposerCursor(cursor);
    });
  };

  const replaceActiveTrigger = (replacement: string) => {
    if (!composerTrigger) return;
    const next = replaceComposerTrigger(input, composerTrigger, replacement);
    onInputChange(next.value);
    focusComposerAt(next.cursor);
  };

  const handleSuggestionSelect = (suggestion: ComposerSuggestion) => {
    if (suggestion.kind === "mention") {
      replaceActiveTrigger(`@${suggestion.name} `);
      if (chatMode !== "agent" && agentAvailable) onChatModeChange("agent");
      return;
    }

    if (suggestion.disabled) return;
    if (["new", "stop", "model", "help"].includes(suggestion.id)) {
      onInputChange("");
      setComposerCursor(0);
      onComposerCommand?.(suggestion.id);
      return;
    }
    if (suggestion.id === "call") {
      replaceActiveTrigger("@");
      return;
    }
    const prompt = suggestion.id === "agents"
      ? t("dashboard:chatWorkspace.composerCommandAgentsPrompt")
      : t("dashboard:chatWorkspace.composerCommandAllPrompt");
    replaceActiveTrigger(prompt);
    if (chatMode !== "agent" && agentAvailable) onChatModeChange("agent");
  };
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
    if (suggestionMenuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (composerSuggestions.length > 0) {
          const direction = e.key === "ArrowDown" ? 1 : -1;
          setSuggestionIndex(current => (current + direction + composerSuggestions.length) % composerSuggestions.length);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setComposerCursor(-1);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && composerSuggestions.length > 0) {
        e.preventDefault();
        handleSuggestionSelect(composerSuggestions[Math.min(suggestionIndex, composerSuggestions.length - 1)]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && (!isChatReady || isUploading || conversationUnavailable || messageTooLong)) {
      e.preventDefault();
      return;
    }
    onKeyDown(e);
  };

  const agentModeBlocked = chatMode === "agent" && !agentAvailable;
  const agentUnavailableMessage = agentCapabilityState === "disabled"
    ? t("dashboard:chatWorkspace.asyncRunsDisabled")
    : agentCapabilityState === "explicitly_unsupported"
      ? t("dashboard:chatWorkspace.asyncRunsUnsupported")
      : agentCapabilityState === "unavailable"
        ? t("dashboard:chatWorkspace.asyncRunsUnavailable")
        : t("dashboard:chatWorkspace.asyncRunsChecking");

  const configuredExtensions = attachmentConfig.allowedExtensions;
  const uploadExtensions = chatMode === "agent"
    ? configuredExtensions
    : DIRECT_CHAT_ATTACHMENT_EXTENSIONS.filter((extension) => configuredExtensions === null || configuredExtensions.includes(extension));
  const attachmentLimitReached = isChatAttachmentLimitReached(pendingAttachments.length, attachmentConfig.maxFiles);
  const attachmentDisabledReason = !isChatReady ? t('dashboard:chatWorkspace.dropFilesNotReadyDesc')
    : conversationUnavailable ? conversationUnavailableMessage
    : !hasActiveConversation ? t('dashboard:chatWorkspace.dropFilesNoConversation')
    : isUploading ? t('dashboard:chatWorkspace.attachmentUploading')
    : attachmentLimitReached ? t('dashboard:chatWorkspace.attachmentLimitReachedDesc')
    : uploadExtensions?.length === 0 ? t('dashboard:chatWorkspace.composerNoTypes')
    : !onUpload ? t('dashboard:chatWorkspace.composerUploadUnavailable') : undefined;


  const formatDuration = (value?: number | null) => formatLocalizedDuration(value, unit => t(`dashboard:chatWorkspace.timelineDurationUnits.${unit}`), { fractionalSeconds: true }) || "-";

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
      <ChatComposerAttachments key={`${workspaceContext?.instanceId}:${workspaceContext?.conversationId}`}
        files={pendingAttachments} instanceId={workspaceContext?.instanceId} conversationId={workspaceContext?.conversationId}
        onPreview={onPreviewAttachment} onRemove={onRemoveAttachment} />
      {isUploading && !attachmentUploads && <p role="status" className="mx-auto mb-2 max-w-5xl text-xs text-content-muted">{t("dashboard:chatWorkspace.attachmentUploading")}</p>}
      {workspacePickerOpen && workspaceContext?.conversationId && <WorkspaceAttachmentPicker
        key={`${workspaceContext.instanceId}:${workspaceContext.conversationId}`}
        instanceId={workspaceContext.instanceId} instanceName={selectedInstanceName}
        extensions={uploadExtensions} maxBytes={attachmentConfig.maxFileSizeBytes}
        remaining={attachmentConfig.maxFiles === null ? null : Math.max(0, attachmentConfig.maxFiles - pendingAttachments.length - (attachmentUploads?.items.length || 0))}
        onAdd={files => onAddWorkspaceFiles?.(workspaceContext.instanceId, workspaceContext.conversationId!, files)}
        onBusyChange={setWorkspaceCopying} onClose={() => setWorkspacePickerOpen(false)} />}
      <form onSubmit={onSubmit} onPasteCapture={event => { handleClipboardAttachments(event, onUpload); }} className="w-full max-w-5xl mx-auto">
        <div className="chat-composer-shell relative min-w-0 rounded-2xl border border-outline bg-surface shadow-sm shadow-slate-200/60 transition-all focus-within:border-indigo-500 focus-within:shadow-md focus-within:shadow-indigo-100/60 focus-within:ring-2 focus-within:ring-indigo-500/10 dark:shadow-slate-950/40 dark:focus-within:border-indigo-400 dark:focus-within:shadow-slate-950/60 dark:focus-within:ring-indigo-400/15">
          {longTextComposer && <ChatLongTextCards blocks={longTextComposer.blocks} actions={longTextComposer} disabled={!isChatReady} onKeyDown={handleKeyDownInternal} />}
          {longTextComposer && countChatMessageCharacters(input) >= LONG_TEXT_TYPED_SUGGESTION_THRESHOLD && (
            <button type="button" disabled={!isChatReady} className="mx-3 mt-2 rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              onClick={() => { longTextComposer.insert(input, 0, input.length); textareaRef.current?.focus(); }}>
              {t("dashboard:chatWorkspace.longTextCollapse")}
            </button>
          )}
          {suggestionMenuOpen && (
            <ChatComposerSuggestionMenu
              items={composerSuggestions}
              selectedIndex={suggestionIndex}
              commandTitle={t("dashboard:chatWorkspace.composerCommandMenuTitle")}
              mentionTitle={t("dashboard:chatWorkspace.composerMentionMenuTitle")}
              noPeersText={t("dashboard:chatWorkspace.composerMentionEmpty")}
              mentionMode={composerTrigger?.kind === "mention"}
              onSelect={handleSuggestionSelect}
              onHighlight={setSuggestionIndex}
            />
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              onInputChange(event.target.value);
              setComposerCursor(event.target.selectionStart ?? event.target.value.length);
            }}
            onClick={event => setComposerCursor(event.currentTarget.selectionStart ?? input.length)}
            onKeyUp={event => {
              if (event.key !== "Escape") setComposerCursor(event.currentTarget.selectionStart ?? input.length);
            }}
            onPaste={longTextComposer ? event => { handleLongTextPaste(event, longTextComposer.insert); } : undefined}
            onKeyDown={handleKeyDownInternal}
            onFocus={onInputFocus}
            placeholder={placeholder}
            disabled={!isChatReady}
            rows={1}
            className={"w-full resize-none border-0 bg-transparent px-4 pb-2 text-[16px] leading-6 text-content placeholder:text-content-muted focus:outline-none scrollbar-none disabled:cursor-not-allowed disabled:text-content-muted sm:min-h-16 sm:max-h-[220px] sm:pt-3 sm:text-[14px] " + (mobileKeyboardOpen ? "min-h-14 max-h-[120px] pt-2.5" : "min-h-14 max-h-[200px] pt-3")}
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
          <div className="chat-composer-toolbar flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ChatComposerControls
            chatMode={chatMode} onChatModeChange={onChatModeChange}
            reasoningEffort={reasoningEffort} onReasoningEffortChange={onReasoningEffortChange}
            agentAvailable={agentAvailable} agentUnavailableMessage={agentUnavailableMessage}
            attachmentCount={pendingAttachments.length} attachmentConfig={attachmentConfig} uploadExtensions={uploadExtensions}
            isUploading={Boolean(isUploading)} attachmentDisabledReason={attachmentDisabledReason}
            canUpload={!attachmentDisabledReason} onUpload={() => fileInputRef.current?.click()}
            onChooseWorkspaceFiles={onAddWorkspaceFiles ? () => setWorkspacePickerOpen(true) : undefined}
          />
          <ChatGroupRoomControl
            peers={a2aPeers}
            collaboration={collaboration}
            disabled={!workspaceContext?.conversationId || !isChatReady || conversationUnavailable}
            onChange={onCollaborationChange}
          />
          </div>
          <div className="flex shrink-0 items-center gap-1.5 select-none">
            {sending && (
              <span
                className="chat-composer-run-indicator inline-flex h-8 items-center gap-1.5 px-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300"
                aria-label={runActivityLabel}
                title={runActivityLabel}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 motion-safe:animate-pulse" />
                <span className="chat-composer-status-label max-w-32 truncate">{runActivityLabel}</span>
              </span>
            )}
            {sending && (
              <button
                type="button"
                onClick={onStopRun}
                disabled={stopPending}
                className="h-10 w-10 md:h-8 md:w-8 bg-transparent hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 text-rose-600 rounded-lg transition-all inline-flex items-center justify-center border border-rose-200 cursor-pointer dark:hover:bg-rose-950/40 dark:text-rose-300 dark:border-rose-500/40"
                title={t("dashboard:chatWorkspace.stopTaskTitle")}
                aria-label={t("dashboard:chatWorkspace.stopTaskTitle")}
              >
                {stopPending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Square className="w-3.5 h-3.5 shrink-0 fill-current" />}
              </button>
            )}
            <span className="chat-composer-shortcut items-center gap-0.5 px-0.5 text-[11px] text-content-muted font-medium">
              <CornerDownLeft className="w-2.5 h-2.5" />
              Enter
            </span>
            <button
              type="submit"
              disabled={!composerText.trim() || messageTooLong || !isChatReady || isUploading || conversationUnavailable || agentModeBlocked}
              className="h-10 w-10 md:h-8 md:w-8 bg-indigo-600 hover:bg-indigo-700 disabled:bg-outline disabled:text-content-muted text-white rounded-lg transition-all inline-flex items-center justify-center shadow-sm shadow-indigo-200/70 dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:shadow-none"
              title={conversationUnavailable ? conversationUnavailableMessage : agentModeBlocked ? agentUnavailableMessage : sending ? t("dashboard:chatWorkspace.interruptAndSendTitle") : t("dashboard:chatWorkspace.sendBtnTitle")}
              aria-label={conversationUnavailable ? conversationUnavailableMessage : agentModeBlocked ? agentUnavailableMessage : sending ? t("dashboard:chatWorkspace.interruptAndSendTitle") : t("dashboard:chatWorkspace.sendBtnTitle")}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
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

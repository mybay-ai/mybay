import { ChatUsageDetails } from "./ChatUsageDetails";
import { A2ARecoveryNotice } from "./A2ARecoveryNotice";
import { readLocalRunUsage, usageNumber } from "../../../shared/localRunUsage";
import { readLocalModelEvidence } from "../../../shared/localModelEvidence";
import { memo, useEffect, useMemo, useState } from "react";
import { useChatCallback } from './useChatCallback';
import { Brain, Check, Clock3, Copy, Gauge, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentInstance, User as UserType } from "../../types";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { ChatUserAvatar } from "./ChatUserAvatar";
import { sanitizeChatDisplayContent } from "../../lib/chatProtocolSanitizer";
import { humanizeChatError } from "../../lib/chatRuntimeErrors";
import type { PendingAttachment } from "./ChatInputBar";
import { api } from "../../lib/api";
import type { ChatApprovalChoice, ChatApprovalRequest, ChatRunMetrics } from "./useChatRuns";
import type { RunExecutionState } from "./run/runTypes";
import { InlineRunTimeline } from "./run/InlineRunTimeline";
import { projectRunTimeline, selectMessageTimeline } from "./run/runTimelinePresentation";
import { InlineApprovalCard } from "./run/InlineApprovalCard";
import { ChatRunQuestions } from "./ChatRunQuestions";
import type { GeneratedArtifact } from "./generatedArtifacts";
import { ChatGeneratedArtifactCards, selectMessageGeneratedArtifacts } from "./ChatGeneratedArtifactCards";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import { ChatMessageStatusNotices } from "./ChatMessageStatusNotices";
import { ChatRunFileChanges } from "./ChatRunFileChanges";
import { LinkedChatContent, MarkdownChatContent } from "./ChatMessageContent";
import { copyTextToClipboard } from "./chatClipboard";
import { ChatAgentAvatar } from "./ChatAgentAvatar";
import { formatLocalizedDuration } from "./localizedDuration";
import { ChatGroupRunSummary } from "./ChatGroupRunSummary";

const EMPTY_CONVERSATION_FILES: PendingAttachment[] = [];
const EMPTY_ARTIFACTS: GeneratedArtifact[] = [];

interface ChatMessageBubbleProps {
  message: ChatMessage;
  retrySourceMessage?: ChatMessage;
  currentUser?: UserType | null;
  selectedConversationId: string | null;
  sending: boolean;
  onRetry: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onSwitchToAssistAndDiagnose?: () => void;
  conversationFiles?: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
  onDownloadInstanceFilePath?: (filePath: string) => void;
  generatedArtifacts?: GeneratedArtifact[];
  fallbackModelLabel?: string;
  agentInstance?: AgentInstance;
  instanceId?: string;
  onMessageFeedbackChange?: (messageId: string, feedback: "like" | "dislike" | null) => void;
  runExecutionState?: RunExecutionState | null;
  runMetrics?: ChatRunMetrics | null;
  approvalRequest?: ChatApprovalRequest | null;
  canRespondToApproval?: boolean;
  onRespondToApproval?: (choice: ChatApprovalChoice, approvalId?: string, resolveAll?: boolean) => void | Promise<void>;
}


export function getMessageAttachments(message: ChatMessage, conversationFiles: PendingAttachment[]) {
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const snapshots = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const ids = Array.isArray(metadata.attachmentIds) ? metadata.attachmentIds.filter((id): id is string => typeof id === "string") : [];
  const snapshotById = new Map(snapshots.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => [String(item.id || ""), item]));
  return Array.from(new Set([...ids, ...snapshotById.keys()].filter(Boolean))).map((id) => {
    const activeFile = conversationFiles.find((file) => file.id === id);
    const snapshot = snapshotById.get(id);
    return {
      file: activeFile || {
        id,
        originalName: typeof snapshot?.originalName === "string" ? snapshot.originalName : id,
        mimeType: typeof snapshot?.mimeType === "string" ? snapshot.mimeType : "application/octet-stream",
        size: typeof snapshot?.size === "number" ? snapshot.size : 0,
      },
      available: Boolean(activeFile),
    };
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readNumberField(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    const numberValue = typeof value === "number" ? value : (typeof value === "string" && value.trim() ? Number(value) : NaN);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function readStringField(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return "";
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}


function getAssistantTokenUsage(message: ChatMessage) {
  const evidence = readLocalRunUsage(message.metadata?.usage_evidence);
  return evidence ? evidence.totalTokens : usageNumber(message.usage_total_tokens);
}

function formatTokenUsage(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function getAssistantModelPresentation(message: ChatMessage, liveConfiguredModel: string, t: (key: string) => string) {
  const reportedModel = readLocalRunUsage(message.metadata?.usage_evidence)?.model;
  if (reportedModel) return { label: reportedModel, title: t("chatWorkspace.usage.modelReportedTitle") };
  const configuredSnapshot = readLocalModelEvidence(message.metadata?.model_evidence)?.model;
  if (configuredSnapshot) return { label: configuredSnapshot, title: t("chatWorkspace.usage.modelConfiguredTitle") };
  if (["pending", "streaming"].includes(message.status) && liveConfiguredModel) {
    return { label: liveConfiguredModel, title: t("chatWorkspace.usage.modelLiveConfiguredTitle") };
  }
  return { label: t("chatWorkspace.usage.unknownModel"), title: t("chatWorkspace.usage.modelUnknownTitle") };
}

function ChatMessageBubbleBody({
  message,
  retrySourceMessage,
  currentUser,
  selectedConversationId,
  sending,
  onRetry,
  onEdit,
  onSwitchToAssistAndDiagnose,
  conversationFiles = EMPTY_CONVERSATION_FILES,
  onOpenConversationFile,
  onOpenInstanceFilePath,
  onDownloadInstanceFilePath,
  generatedArtifacts = EMPTY_ARTIFACTS,
  fallbackModelLabel = "",
  agentInstance,
  instanceId,
  onMessageFeedbackChange,
  runExecutionState: liveRunExecutionState,
  runMetrics,
  approvalRequest,
  canRespondToApproval = false,
  onRespondToApproval
}: ChatMessageBubbleProps) {
  const { t } = useTranslation("dashboard");
  const [copied, setCopied] = useState(false);
  const initialFeedback = message.user_feedback === "like" ? "up" : message.user_feedback === "dislike" ? "down" : null;
  const [feedback, setFeedback] = useState<"up" | "down" | null>(initialFeedback);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const isUser = message.role === "user";
  const runExecutionState = useMemo(() => selectMessageTimeline(message, selectedConversationId, liveRunExecutionState),
    [message, selectedConversationId, liveRunExecutionState]);
  const retryTarget = isUser ? message : retrySourceMessage;
  const canSaveFeedback = !isUser && !!instanceId && !!selectedConversationId && UUID_PATTERN.test(message.id || "");
  const displayContent = sanitizeChatDisplayContent(
    message.content,
    t("chatWorkspace.toolCallProtocolHidden")
  );
  const messageAttachments = useMemo(() => getMessageAttachments(message, conversationFiles), [message, conversationFiles]);
  const presentation = useMemo(() => runExecutionState ? projectRunTimeline(runExecutionState, displayContent) : null,
    [runExecutionState, displayContent]);
  const messageRunId = readStringField(message.metadata, ["runId", "run_id"]) || runExecutionState?.runId;
  const messageGeneratedArtifacts = useMemo(
    () => selectMessageGeneratedArtifacts(generatedArtifacts, message.id, messageRunId),
    [generatedArtifacts, message.id, messageRunId]
  );

  useEffect(() => {
    setFeedback(message.user_feedback === "like" ? "up" : message.user_feedback === "dislike" ? "down" : null);
  }, [message.id, message.user_feedback]);

  const assistantModel = useMemo(() => getAssistantModelPresentation(message, fallbackModelLabel, t), [message, fallbackModelLabel, t]);
  const assistantModelLabel = assistantModel.label;
  const failureInfo = useMemo(() => humanizeChatError(
    { code: message.error_code, message: message.error_message },
    t("chatWorkspace.messageFailed")
  ), [message.error_code, message.error_message, t]);
  const failureMessage = failureInfo.message;
  const assistantTokenUsage = useMemo(() => getAssistantTokenUsage(message), [message]);
  const assistantTokenUsageLabel = useMemo(() => formatTokenUsage(assistantTokenUsage), [assistantTokenUsage]);
  const assistantDurationLabel = formatLocalizedDuration(message.duration_ms ?? runMetrics?.durationMs, unit => t(`chatWorkspace.timelineDurationUnits.${unit}`));

  const handleCopyAssistantMessage = async () => {
    if (!displayContent) return;
    await copyTextToClipboard(displayContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const handleAssistantFeedback = async (next: "up" | "down") => {
    if (!canSaveFeedback || feedbackSaving || !instanceId || !selectedConversationId || !message.id) return;
    const previousFeedback = feedback;
    const nextFeedback = previousFeedback === next ? null : next;
    const storedFeedback = nextFeedback === "up" ? "like" : nextFeedback === "down" ? "dislike" : null;
    setFeedback(nextFeedback);
    onMessageFeedbackChange?.(message.id, storedFeedback);
    setFeedbackSaving(true);
    try {
      const path = `/api/instances/${encodeURIComponent(instanceId)}/conversations/${encodeURIComponent(selectedConversationId)}/messages/${encodeURIComponent(message.id)}/feedback`;
      if (storedFeedback) {
        await api.post(path, { rating: storedFeedback });
      } else {
        await api.delete(path);
      }
    } catch (err) {
      console.error("Chat message feedback save failed:", err);
      const revertedFeedback = previousFeedback === "up" ? "like" : previousFeedback === "down" ? "dislike" : null;
      setFeedback(previousFeedback);
      onMessageFeedbackChange?.(message.id, revertedFeedback);
    } finally {
      setFeedbackSaving(false);
    }
  };

  return (
    <div
      key={message.id || `${selectedConversationId}-${message.sequence_no}`}
      className={`flex gap-2 sm:gap-3.5 ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
    >
      {!isUser && (
        <ChatAgentAvatar instance={agentInstance} />
      )}

      <div className={`min-w-0 rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-[14px] leading-5 shadow-sm relative break-words ${
        isUser
          ? "max-w-[calc(100%_-_2.5rem)] sm:max-w-[min(86%,calc(100%_-_2.875rem))] bg-slate-950 text-white rounded-tr-md font-normal dark:bg-indigo-600"
          : "max-w-[calc(100%_-_2.5rem)] sm:max-w-[calc(100%_-_2.875rem)] bg-surface/95 border border-outline/80 text-content rounded-tl-md"
      } ${message.status === "failed" ? "border-red-350 bg-red-50/20" : ""} ${message.status === "stopped" ? "border-amber-300 bg-amber-50/20" : ""} ${message.status === "queued" ? "border-amber-200 bg-amber-50/20" : ""} ${message.status === "superseded" ? "opacity-65" : ""}`}>
        {!isUser && <A2ARecoveryNotice instanceId={instanceId} source={message.metadata?.a2a_recovery_source || retrySourceMessage?.metadata?.a2a_recovery_source} status={runExecutionState?.status || message.status} />}
        {!isUser && <ChatGroupRunSummary instanceId={instanceId} value={message.metadata?.group_collaboration} />}
        {!isUser && runExecutionState && (
          <InlineRunTimeline execution={{ ...runExecutionState, blocks: presentation?.blocks || runExecutionState.blocks }}
            metrics={runMetrics || { durationMs: message.duration_ms }} hideApprovalBlocks={Boolean(approvalRequest)} textUnaligned={presentation?.textUnaligned}
            renderText={(content) => <MarkdownChatContent content={sanitizeChatDisplayContent(content, t("chatWorkspace.toolCallProtocolHidden"))}
              conversationFiles={conversationFiles} onOpenConversationFile={onOpenConversationFile} onOpenInstanceFilePath={onOpenInstanceFilePath} />} />
        )}
        {!isUser && approvalRequest && (
          <InlineApprovalCard approval={approvalRequest} canRespond={canRespondToApproval} onRespond={onRespondToApproval} />
        )}
        {!isUser && instanceId && selectedConversationId && messageRunId && (
          <ChatRunQuestions key={`${instanceId}:${selectedConversationId}:${messageRunId}`} instanceId={instanceId} conversationId={selectedConversationId} runId={messageRunId}
            knownClosed={message.status === "stopped" || ["stopping", "cancelled", "completed", "failed", "expired"].includes(runExecutionState?.status || "")} />
        )}
        {isUser ? (
          <LinkedChatContent
            content={displayContent}
            isUser={isUser}
            conversationFiles={conversationFiles}
            onOpenConversationFile={onOpenConversationFile}
            onOpenInstanceFilePath={onOpenInstanceFilePath}
          />
        ) : (
          <MarkdownChatContent
            content={presentation?.finalContent ?? displayContent}
            conversationFiles={conversationFiles}
            onOpenConversationFile={onOpenConversationFile}
            onOpenInstanceFilePath={onOpenInstanceFilePath}
          />
        )}
        {isUser && <ChatMessageAttachments attachments={messageAttachments} onOpen={onOpenConversationFile} />}
        {!isUser && <ChatGeneratedArtifactCards artifacts={messageGeneratedArtifacts} onPreview={onOpenInstanceFilePath} onDownload={onDownloadInstanceFilePath} />}
        {!isUser && <ChatRunFileChanges instanceId={instanceId} conversationId={selectedConversationId} runId={messageRunId} evidence={message.metadata?.file_evidence} execution={runExecutionState} artifacts={messageGeneratedArtifacts} onOpen={onOpenInstanceFilePath} />}
        {!isUser && displayContent.trim() && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-outline pt-2 text-content-muted">
            <button
              type="button"
              onClick={handleCopyAssistantMessage}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-muted hover:text-content-secondary"
              title={copied ? t("chatWorkspace.messageCopied") : t("chatWorkspace.copyMessage")}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => handleAssistantFeedback("up")}
              disabled={feedbackSaving || !canSaveFeedback}
              className={"inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-muted" + (feedback === "up" ? "text-emerald-600 dark:text-emerald-300" : "hover:text-content-secondary")}
              title={t("chatWorkspace.likeMessage")}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleAssistantFeedback("down")}
              disabled={feedbackSaving || !canSaveFeedback}
              className={"inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-muted" + (feedback === "down" ? "text-rose-600 dark:text-rose-300" : "hover:text-content-secondary")}
              title={t("chatWorkspace.dislikeMessage")}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
            {assistantDurationLabel && (
              <span className="ml-1 inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-content-muted" title={t("chatWorkspace.messageProcessedDuration", { duration: assistantDurationLabel })}>
                <Clock3 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t("chatWorkspace.messageProcessedDuration", { duration: assistantDurationLabel })}</span>
              </span>
            )}
            <span className={`inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-content-muted${assistantDurationLabel ? "" : " ml-1"}`} title={`${assistantModelLabel} · ${assistantModel.title}`}>
              <Brain className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{assistantModelLabel}</span>
            </span>
            {!["pending", "streaming"].includes(message.status) && <ChatUsageDetails message={message} />}
            {assistantTokenUsageLabel && (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-content-muted" title={t("chatWorkspace.messageTokensUsed")}>
                <Gauge className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{assistantTokenUsageLabel} tokens</span>
              </span>
            )}
          </div>
        )}
        <ChatMessageStatusNotices message={message} isUser={isUser} sending={sending} failureMessage={failureMessage} retryTarget={retryTarget} onRetry={onRetry} onEdit={onEdit} onSwitchToAssistAndDiagnose={onSwitchToAssistAndDiagnose} t={t} />
      </div>

      {isUser && <ChatUserAvatar currentUser={currentUser} />}
    </div>
  );
}

const MemoizedMessageBubble = memo(ChatMessageBubbleBody);

export function ChatMessageBubble(props: ChatMessageBubbleProps) {
  const onRetry = useChatCallback(props.onRetry);
  const onEdit = useChatCallback(props.onEdit);
  const onSwitchToAssistAndDiagnose = useChatCallback(props.onSwitchToAssistAndDiagnose);
  const onOpenConversationFile = useChatCallback(props.onOpenConversationFile);
  const onOpenInstanceFilePath = useChatCallback(props.onOpenInstanceFilePath);
  const onDownloadInstanceFilePath = useChatCallback(props.onDownloadInstanceFilePath);
  const onMessageFeedbackChange = useChatCallback(props.onMessageFeedbackChange);
  const onRespondToApproval = useChatCallback(props.onRespondToApproval);
  return <MemoizedMessageBubble {...props} onRetry={onRetry} onEdit={onEdit} onSwitchToAssistAndDiagnose={onSwitchToAssistAndDiagnose}
    onOpenConversationFile={onOpenConversationFile} onOpenInstanceFilePath={onOpenInstanceFilePath} onDownloadInstanceFilePath={onDownloadInstanceFilePath}
    onMessageFeedbackChange={onMessageFeedbackChange} onRespondToApproval={onRespondToApproval} />;
}

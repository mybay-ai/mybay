import { ChatUsageDetails } from "./ChatUsageDetails";
import { readLocalRunUsage, usageNumber } from "../../../shared/localRunUsage";
import { Children, isValidElement, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Brain, Check, Clock3, Copy, ExternalLink, FileText, Gauge, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { User as UserType } from "../../types";
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
import { GENERATED_FILE_PATH_PATTERN } from "./generatedFilePath";
import type { GeneratedArtifact } from "./generatedArtifacts";
import { ChatGeneratedArtifactCards, selectMessageGeneratedArtifacts } from "./ChatGeneratedArtifactCards";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import { ChatMessageStatusNotices } from "./ChatMessageStatusNotices";
import { ChatRunFileChanges } from "./ChatRunFileChanges";
import { ChatMarkdownRenderer } from "./ChatMessageContent";

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

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

const MARKDOWN_URL_WRAPPERS = ["**", "__", "`", "*", "_"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUrlHref(rawValue: string) {
  const trimmed = rawValue.replace(/[\]\)}>),.;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F]+$/u, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return "https://" + trimmed;
  return "http://" + trimmed;
}

function splitUrlToken(value: string) {
  let core = value;
  let trailing = "";
  const trailingMatch = core.match(/([\]\)}>),.;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F]+)$/u);
  if (trailingMatch?.[1]) {
    trailing = trailingMatch[1];
    core = core.slice(0, -trailing.length);
  }

  for (const wrapper of MARKDOWN_URL_WRAPPERS) {
    while (core.endsWith(wrapper)) {
      core = core.slice(0, -wrapper.length);
    }
  }

  return { core, trailing };
}

function trimOpeningMarkdownWrapper(beforeText: string, tokenRaw: string) {
  for (const wrapper of MARKDOWN_URL_WRAPPERS) {
    if (beforeText.endsWith(wrapper) && tokenRaw.endsWith(wrapper)) {
      return beforeText.slice(0, -wrapper.length);
    }
  }
  return beforeText;
}

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

function formatMessageDuration(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function getAssistantModelLabel(message: ChatMessage, unknown: string) {
  return readLocalRunUsage(message.metadata?.usage_evidence)?.model ?? unknown;
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function findNextToken(text: string, files: PendingAttachment[]) {
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s<>"']*)?/giu;
  let best: { index: number; raw: string; type: "url" | "file" | "path"; file?: PendingAttachment } | null = null;
  const urlMatch = urlRegex.exec(text);
  if (urlMatch) best = { index: urlMatch.index, raw: urlMatch[0], type: "url" };

  GENERATED_FILE_PATH_PATTERN.lastIndex = 0;
  const pathMatch = GENERATED_FILE_PATH_PATTERN.exec(text);
  if (pathMatch && (!best || pathMatch.index < best.index)) {
    best = { index: pathMatch.index, raw: pathMatch[0], type: "path" };
  }

  for (const file of files) {
    const name = file.originalName?.trim();
    if (!name) continue;
    const fileMatch = new RegExp(escapeRegExp(name), "iu").exec(text);
    if (fileMatch && (!best || fileMatch.index < best.index)) {
      best = { index: fileMatch.index, raw: fileMatch[0], type: "file", file };
    }
  }
  return best;
}

function LinkedChatContent({
  content,
  isUser,
  conversationFiles,
  onOpenConversationFile,
  onOpenInstanceFilePath
}: {
  content: string;
  isUser: boolean;
  conversationFiles: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
}) {
  const { t } = useTranslation("dashboard");
  if (!content) return null;
  const nodes: React.ReactNode[] = [];
  let remaining = content;
  let key = 0;

  while (remaining.length > 0) {
    const token = findNextToken(remaining, conversationFiles);
    if (!token) {
      nodes.push(remaining);
      break;
    }
    const beforeToken = remaining.slice(0, token.index);

    if (token.type === "file" && token.file && onOpenConversationFile) {
      if (beforeToken) nodes.push(beforeToken);
      nodes.push(
        <button
          key={"file-" + key++}
          type="button"
          onClick={() => onOpenConversationFile(token.file!)}
          className={
            "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-[13px] font-semibold underline-offset-2 hover:underline " +
            (isUser
              ? "border-white/25 bg-white/10 text-white hover:bg-white/20"
              : "border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20")
          }
          title={t("chatWorkspace.openFile")}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{token.raw}</span>
        </button>
      );
      remaining = remaining.slice(token.index + token.raw.length);
      continue;
    }

    if (token.type === "path" && onOpenInstanceFilePath) {
      const beforePath = trimOpeningMarkdownWrapper(beforeToken, token.raw);
      if (beforePath) nodes.push(beforePath);
      const { core, trailing } = splitUrlToken(token.raw);
      nodes.push(
        <button
          key={"path-" + key++}
          type="button"
          onClick={() => onOpenInstanceFilePath(core)}
          className={
            "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-[13px] font-semibold underline-offset-2 hover:underline " +
            (isUser
              ? "border-white/25 bg-white/10 text-white hover:bg-white/20"
              : "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20")
          }
          title={core}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{core}</span>
        </button>
      );
      if (trailing) nodes.push(trailing);
      remaining = remaining.slice(token.index + token.raw.length);
      continue;
    }

    if (token.type === "url") {
      const beforeUrl = trimOpeningMarkdownWrapper(beforeToken, token.raw);
      if (beforeUrl) nodes.push(beforeUrl);
      const { core, trailing } = splitUrlToken(token.raw);
      const href = normalizeUrlHref(core);
      nodes.push(
        <a
          key={"url-" + key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            "inline-flex max-w-full items-center gap-1 break-all font-semibold underline underline-offset-2 " +
            (isUser
              ? "text-white decoration-white/55 hover:decoration-white"
              : "text-indigo-700 decoration-indigo-300 hover:text-indigo-800 hover:decoration-indigo-600 dark:text-indigo-300 dark:decoration-indigo-500/60 dark:hover:text-indigo-200")
          }
          title={href}
        >
          <span>{core}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      );
      if (trailing) nodes.push(trailing);
      remaining = remaining.slice(token.index + token.raw.length);
      continue;
    }

    if (beforeToken) nodes.push(beforeToken);
    nodes.push(token.raw);
    remaining = remaining.slice(token.index + token.raw.length);
  }

  return <>{nodes}</>;
}


type LinkedContentContext = {
  isUser: boolean;
  conversationFiles: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
};

function linkifyMarkdownChildren(children: ReactNode, context: LinkedContentContext): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return (
        <LinkedChatContent
          content={child}
          isUser={context.isUser}
          conversationFiles={context.conversationFiles}
          onOpenConversationFile={context.onOpenConversationFile}
          onOpenInstanceFilePath={context.onOpenInstanceFilePath}
        />
      );
    }

    if (Array.isArray(child)) return linkifyMarkdownChildren(child, context);
    return child;
  });
}

function getPlainNodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(getPlainNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return getPlainNodeText(children.props.children);
  return "";
}

function hasLinkableInlineToken(value: string, context: LinkedContentContext) {
  const token = findNextToken(value, context.conversationFiles);
  if (!token) return false;
  if (token.type === "url") return true;
  if (token.type === "file") return Boolean(token.file && context.onOpenConversationFile);
  if (token.type === "path") return Boolean(context.onOpenInstanceFilePath);
  return false;
}

function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const { t } = useTranslation("dashboard");
  const [copied, setCopied] = useState(false);
  const codeText = getPlainNodeText(children).replace(/\n$/, "");

  const handleCopy = async () => {
    if (!codeText) return;
    await copyTextToClipboard(codeText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="my-2 max-w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <span>Code</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          title={t("chatWorkspace.copyCode")}
        >
          <Copy className="h-3 w-3" />
          {copied ? t("chatWorkspace.codeCopied") : t("chatWorkspace.copyCode")}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto p-3 text-[12px] leading-5 text-slate-100">
        {children}
      </pre>
    </div>
  );
}
function MarkdownChatContent({
  content,
  conversationFiles,
  onOpenConversationFile,
  onOpenInstanceFilePath
}: {
  content: string;
  conversationFiles: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
}) {
  const linkContext: LinkedContentContext = {
    isUser: false,
    conversationFiles,
    onOpenConversationFile,
    onOpenInstanceFilePath
  };

  return (
      <ChatMarkdownRenderer
        content={content}
        components={{
          p: ({ children }) => <p className="m-0 whitespace-pre-wrap leading-6">{linkifyMarkdownChildren(children, linkContext)}</p>,
          strong: ({ children }) => <strong className="font-semibold text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</strong>,
          em: ({ children }) => <em className="italic">{linkifyMarkdownChildren(children, linkContext)}</em>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5 leading-6">{linkifyMarkdownChildren(children, linkContext)}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-indigo-200 pl-3 text-content-secondary dark:border-indigo-400/40">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            const value = getPlainNodeText(children);
            const isBlock = Boolean(className) || value.includes("\n");
            if (isBlock) return <code className={className}>{children}</code>;
            if (hasLinkableInlineToken(value, linkContext)) {
              return (
                <LinkedChatContent
                  content={value}
                  isUser={false}
                  conversationFiles={conversationFiles}
                  onOpenConversationFile={onOpenConversationFile}
                  onOpenInstanceFilePath={onOpenInstanceFilePath}
                />
              );
            }
            return (
              <code className="rounded-md border border-outline bg-surface-muted px-1.5 py-0.5 text-[12px] font-semibold text-content-secondary">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
          a: ({ href, children }) => {
            const safeHref = href || "";
            const isHttpLink = /^https?:\/\//i.test(safeHref);
            if (!isHttpLink) return <span>{linkifyMarkdownChildren(children, linkContext)}</span>;
            return (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 break-all font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800 hover:decoration-indigo-600 dark:text-indigo-300 dark:decoration-indigo-500/60 dark:hover:text-indigo-200"
                title={safeHref}
              >
                <span>{children}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            );
          },
          h1: ({ children }) => <h1 className="mt-4 text-xl font-bold leading-tight text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</h1>,
          h2: ({ children }) => <h2 className="mt-4 text-lg font-bold leading-tight text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</h2>,
          h3: ({ children }) => <h3 className="mt-3 text-base font-bold leading-tight text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</h3>,
          hr: () => <hr className="my-4 border-0 border-t border-outline" />,
          del: ({ children }) => <del className="text-content-muted">{linkifyMarkdownChildren(children, linkContext)}</del>,
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-outline">
              <table className="min-w-[520px] border-collapse text-left text-[12px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-surface-muted">{children}</thead>,
          th: ({ children }) => <th className="whitespace-nowrap border-b border-outline px-2.5 py-2 font-semibold">{linkifyMarkdownChildren(children, linkContext)}</th>,
          td: ({ children }) => <td className="border-b border-outline px-2.5 py-2 align-top break-words">{linkifyMarkdownChildren(children, linkContext)}</td>
        }}
      />
  );
}
export function ChatMessageBubble({
  message,
  retrySourceMessage,
  currentUser,
  selectedConversationId,
  sending,
  onRetry,
  onEdit,
  onSwitchToAssistAndDiagnose,
  conversationFiles = [],
  onOpenConversationFile,
  onOpenInstanceFilePath,
  onDownloadInstanceFilePath,
  generatedArtifacts = [],
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

  const assistantModelLabel = useMemo(() => getAssistantModelLabel(message, t("chatWorkspace.usage.unknownModel")), [message, t]);
  const failureInfo = useMemo(() => humanizeChatError(
    { code: message.error_code, message: message.error_message },
    t("chatWorkspace.messageFailed")
  ), [message.error_code, message.error_message, t]);
  const failureMessage = failureInfo.message;
  const assistantTokenUsage = useMemo(() => getAssistantTokenUsage(message), [message]);
  const assistantTokenUsageLabel = useMemo(() => formatTokenUsage(assistantTokenUsage), [assistantTokenUsage]);
  const assistantDurationLabel = formatMessageDuration(message.duration_ms ?? runMetrics?.durationMs);

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
        <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/30">
          <Sparkles className="w-4 h-4" />
        </div>
      )}

      <div className={`max-w-[90%] sm:max-w-[86%] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-[14px] leading-6 shadow-sm relative break-words ${
        isUser
          ? "bg-slate-950 text-white rounded-tr-md font-normal dark:bg-indigo-600"
          : "bg-surface/95 border border-outline/80 text-content rounded-tl-md whitespace-pre-wrap leading-relaxed"
      } ${message.status === "failed" ? "border-red-350 bg-red-50/20" : ""} ${message.status === "stopped" ? "border-amber-300 bg-amber-50/20" : ""} ${message.status === "queued" ? "border-amber-200 bg-amber-50/20" : ""} ${message.status === "superseded" ? "opacity-65" : ""}`}>
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
        {!isUser && !["pending", "streaming"].includes(message.status) && <ChatUsageDetails message={message} />}
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
            <span className="ml-1 inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-content-muted" title={assistantModelLabel}>
              <Brain className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{assistantModelLabel}</span>
            </span>
            {assistantDurationLabel && (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-content-muted" title={t("chatWorkspace.messageProcessedDuration", { duration: assistantDurationLabel })}>
                <Clock3 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{assistantDurationLabel}</span>
              </span>
            )}
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



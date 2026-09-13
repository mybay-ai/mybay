import type { AgentInstance, User as UserType } from "../../types";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import type { PendingAttachment } from "./ChatInputBar";
import type { GeneratedArtifact } from "./generatedArtifacts";
import type { ChatApprovalChoice, ChatApprovalRequest, ChatRunMetrics } from "./useChatRuns";
import type { RunExecutionState } from "./run/runTypes";
import type { GroupRunActivity, GroupRunMissingMember } from "./ChatGroupRunSummary";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { findRetrySourceMessage } from "./run/retrySelectors";

type ChatMessageListContext = {
  selectedConversationId: string | null;
  currentUser?: UserType | null;
  selectedInstance?: AgentInstance;
  instanceId: string;
  sending: boolean;
  activeRunId: string | null;
  fallbackModelLabel: string;
};

type ChatMessageListRun = {
  assistantIndex: number;
  detachedMessage: ChatMessage | null;
  executionState: RunExecutionState | null;
  metrics?: ChatRunMetrics | null;
  approval: ChatApprovalRequest | null;
  canRespondToApproval: boolean;
  onRespondToApproval?: (choice: ChatApprovalChoice, approvalId?: string, resolveAll?: boolean) => void | Promise<void>;
};

type ChatMessageListResources = {
  conversationFiles: PendingAttachment[];
  generatedArtifacts: GeneratedArtifact[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
  onDownloadInstanceFilePath?: (filePath: string) => void;
  onRefreshGeneratedArtifacts?: () => void;
};

type ChatMessageListActions = {
  onRetry: (message: ChatMessage) => void;
  onEditMessage?: (message: ChatMessage) => void;
  onSwitchToAssistAndDiagnose?: () => void;
  onReconnectCodexOAuth?: () => void;
  reconnectingCodexOAuth?: boolean;
  onMessageFeedbackChange?: (messageId: string, feedback: "like" | "dislike" | null) => void;
  onPrepareGroupRecovery?: (activity: GroupRunActivity) => void;
  onPrepareMissingGroupMember?: (member: GroupRunMissingMember) => void;
};

export type ChatMessageListProps = {
  messages: ChatMessage[];
  highlightedMessageId?: string | null;
  context: ChatMessageListContext;
  run: ChatMessageListRun;
  resources: ChatMessageListResources;
  actions: ChatMessageListActions;
};

export function ChatMessageList({ messages, highlightedMessageId, context, run, resources, actions }: ChatMessageListProps) {
  const sharedBubbleProps = {
    currentUser: context.currentUser,
    selectedConversationId: context.selectedConversationId,
    sending: context.sending,
    onRetry: actions.onRetry,
    conversationFiles: resources.conversationFiles,
    onOpenConversationFile: resources.onOpenConversationFile,
    onOpenInstanceFilePath: resources.onOpenInstanceFilePath,
    onDownloadInstanceFilePath: resources.onDownloadInstanceFilePath,
    generatedArtifacts: resources.generatedArtifacts,
    fallbackModelLabel: context.fallbackModelLabel,
    agentInstance: context.selectedInstance,
    instanceId: context.instanceId,
    canRespondToApproval: run.canRespondToApproval,
    onRespondToApproval: run.onRespondToApproval,
    onPrepareGroupRecovery: actions.onPrepareGroupRecovery,
    onPrepareMissingGroupMember: actions.onPrepareMissingGroupMember,
    onRefreshGeneratedArtifacts: resources.onRefreshGeneratedArtifacts
  };

  return (
    <>
      {messages.map((message, messageIndex) => {
        const ownsRunPresentation = message.role === "assistant" && messageIndex === run.assistantIndex;
        return (
          <div
            key={message.id || `${context.selectedConversationId}-${message.sequence_no}`}
            data-chat-message-id={message.id}
            className={highlightedMessageId === message.id ? "rounded-2xl ring-2 ring-indigo-400 ring-offset-4 ring-offset-white transition dark:ring-indigo-400 dark:ring-offset-slate-950" : undefined}
          >
            <ChatMessageBubble
              {...sharedBubbleProps}
              message={message}
              retrySourceMessage={message.role === "assistant" ? findRetrySourceMessage(messages, messageIndex) : undefined}
              canRegenerate={messageIndex === messages.length - 1 && message.role === "assistant" && !context.activeRunId}
              onEdit={actions.onEditMessage}
              onSwitchToAssistAndDiagnose={actions.onSwitchToAssistAndDiagnose}
              onReconnectCodexOAuth={actions.onReconnectCodexOAuth}
              reconnectingCodexOAuth={actions.reconnectingCodexOAuth}
              onMessageFeedbackChange={actions.onMessageFeedbackChange}
              runExecutionState={ownsRunPresentation ? run.executionState : null}
              runMetrics={ownsRunPresentation ? run.metrics : null}
              approvalRequest={ownsRunPresentation ? run.approval : null}
            />
          </div>
        );
      })}

      {run.detachedMessage && (
        <ChatMessageBubble
          {...sharedBubbleProps}
          message={run.detachedMessage}
          runExecutionState={run.executionState}
          runMetrics={run.metrics}
          approvalRequest={run.approval}
        />
      )}
    </>
  );
}

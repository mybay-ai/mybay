import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { ChatMessage, OptimisticChatContext } from "../../lib/chatWorkspaceState";
import { isTerminalStopStatus, type RunReleaseResult } from "./run/runStopLifecycle";
import { markRunMessagesStopped } from "./run/runTerminalMessages";

type ActiveSyncChatRequest = {
  controller: AbortController;
  requestId: string;
  instanceId: string;
  conversationId: string | null;
};

export function createChatCancellationController(options: {
  activeRunId: string | null;
  runExecutionState: any;
  activeSyncChatRequestRef: MutableRefObject<ActiveSyncChatRequest | null>;
  activeChatGenerationRef: MutableRefObject<number>;
  activeChatRequestIdRef: MutableRefObject<string | null>;
  optimisticChatContextRef: MutableRefObject<OptimisticChatContext | null>;
  syncCancelReconciliationTimersRef: MutableRefObject<number[]>;
  selectedIdRef: MutableRefObject<string>;
  selectedConversationIdRef: MutableRefObject<string | null>;
  refreshAuthoritativeHistoryRef: MutableRefObject<(instanceId: string, conversationId: string) => Promise<void>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setActiveRunConversationId: Dispatch<SetStateAction<string | null>>;
  handleStopRun: (runId: string, instanceId: string) => Promise<any>;
  waitForRunRelease: (instanceId: string, runId: string) => Promise<RunReleaseResult>;
  isCurrentRunContext: (runId: string, conversationId: string) => boolean;
  stopActiveRunStreams: () => void;
  finalizeActiveRunUi: (runId: string, status: any) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const {
    activeRunId,
    runExecutionState,
    activeSyncChatRequestRef,
    activeChatGenerationRef,
    activeChatRequestIdRef,
    optimisticChatContextRef,
    syncCancelReconciliationTimersRef,
    selectedIdRef,
    selectedConversationIdRef,
    refreshAuthoritativeHistoryRef,
    setMessages,
    setSending,
    setActiveRunConversationId,
    handleStopRun,
    waitForRunRelease,
    isCurrentRunContext,
    stopActiveRunStreams,
    finalizeActiveRunUi,
    t,
  } = options;

  const scheduleSyncCancellationReconciliation = (instanceId: string, conversationId: string) => {
    syncCancelReconciliationTimersRef.current.splice(0).forEach(timerId => window.clearTimeout(timerId));
    syncCancelReconciliationTimersRef.current = [500, 1500, 3000].map(delayMs => window.setTimeout(() => {
      if (selectedIdRef.current === instanceId && selectedConversationIdRef.current === conversationId) {
        void refreshAuthoritativeHistoryRef.current(instanceId, conversationId);
      }
    }, delayMs));
  };

  const markStoppedRunMessages = (runId: string, conversationId: string) => {
    const execution = runExecutionState?.runId === runId ? runExecutionState : {
      runId,
      conversationId,
      status: "running" as const,
      blocks: [],
      lastProcessedSeq: 0,
    };
    setMessages(previous => markRunMessagesStopped(
      previous,
      execution,
      t("dashboard:chatWorkspace.messageStopped", { defaultValue: "已停止，可编辑后重新发送" }),
    ));
  };

  const handleStopActiveRun = async () => {
    const targetRunId = activeRunId;
    const targetInstanceId = selectedIdRef.current;
    const targetConversationId = selectedConversationIdRef.current;
    if (!targetInstanceId || !targetConversationId || !targetRunId) return;

    const stopResult = await handleStopRun(targetRunId, targetInstanceId);
    if (!stopResult?.ok) return;
    if (selectedIdRef.current !== targetInstanceId
      || selectedConversationIdRef.current !== targetConversationId
      || !isCurrentRunContext(targetRunId, targetConversationId)) return;

    // A locally accepted stop must feel immediate. The authoritative upstream
    // cancellation can finish later, so release the composer and close streams
    // now, then reconcile the persisted result in the background.
    const terminalStatus = isTerminalStopStatus(stopResult.status) ? stopResult.status : "stopped";
    stopActiveRunStreams();
    finalizeActiveRunUi(targetRunId, terminalStatus);
    setActiveRunConversationId(null);
    activeChatGenerationRef.current += 1;
    activeChatRequestIdRef.current = null;
    setSending(false);

    if (terminalStatus === "stopped" || terminalStatus === "cancelled") {
      markStoppedRunMessages(targetRunId, targetConversationId);
      scheduleSyncCancellationReconciliation(targetInstanceId, targetConversationId);
    } else {
      void refreshAuthoritativeHistoryRef.current(targetInstanceId, targetConversationId);
      return;
    }

    void waitForRunRelease(targetInstanceId, targetRunId).then(() => {
      if (selectedIdRef.current === targetInstanceId
        && selectedConversationIdRef.current === targetConversationId) {
        void refreshAuthoritativeHistoryRef.current(targetInstanceId, targetConversationId);
      }
    }).catch(() => {
      // Timed reconciliation above remains the fallback when status polling is unavailable.
    });
  };

  const handleCancelOrStop = async () => {
    const syncRequest = activeSyncChatRequestRef.current;
    if (!syncRequest) {
      await handleStopActiveRun();
      return;
    }

    activeSyncChatRequestRef.current = null;
    syncRequest.controller.abort();
    activeChatGenerationRef.current += 1;
    activeChatRequestIdRef.current = null;
    setSending(false);
    setMessages(previous => previous.map(message => message.role === "user" && message.request_id === syncRequest.requestId
      ? {
          ...message,
          status: "stopped",
          error_code: "CANCELLED_BY_USER",
          error_message: t("dashboard:chatWorkspace.messageStopped"),
        }
      : message));
    if (optimisticChatContextRef.current?.requestId === syncRequest.requestId) {
      optimisticChatContextRef.current = { ...optimisticChatContextRef.current, phase: "settled" };
    }
    if (syncRequest.conversationId) {
      scheduleSyncCancellationReconciliation(syncRequest.instanceId, syncRequest.conversationId);
    }
  };

  return { handleCancelOrStop };
}

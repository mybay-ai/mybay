import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { getChatErrorMessage } from "../../lib/chatRuntimeErrors";
import { getAuthToken } from "../../lib/auth";
import { markChatRunCompleted } from "../../lib/chatWorkspaceNotifications";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import type { ChatToolStep } from "./ChatToolProgress";
import { canExecutePollingCallback, finalizeRunMetrics, finalizeRunSteps, isTerminalRunStatus, normalizeRunDurationMs, shouldApplyRunUpdate, type TerminalRunStatus } from "./runUiLifecycle";
import { normalizeRunSseResumeCursor, observeRunSseEventId } from "./runSseCursor";
import { createRunExecutionState, deriveAssistantText, deriveToolSteps } from "./run/runReducer";
import { consumeRunSseFrame } from "./run/runStreamCoordinator";
import { mergeRecoveredStreamingContent } from "./run/runTextReconciliation";
import type { RunExecutionState, RunExecutionStatus, ToolEventPayload } from "./run/runTypes";
import { finalizeRunExecution } from "./run/runFinalizer";
import { applyRunExecutionToMessages, applyRunTextSnapshot } from "./run/runExecutionSync";
import { mergeApprovalEvent, settleApprovalRequests } from "./run/approvalSelectors";
import { reconcileRunMetricStatus } from "./run/runStatusSemantics";

export type RunsCapabilityState = "checking" | "supported" | "explicitly_unsupported" | "unavailable" | "disabled";

type RunsCapabilityDetails = {
  features: Record<string, boolean>;
  toolProgressEvents: boolean;
  runEventsSse: boolean;
  runStop: boolean;
  approvalEvents: boolean;
  runApprovalResponse: boolean;
};

export type ChatApprovalChoice = "once" | "session" | "always" | "deny";

export interface ChatRunMetrics {
  runId?: string | null;
  status?: string | null;
  errorCode?: string | null;
  durationMs?: number | null;
  usagePromptTokens?: number | null;
  usageCompletionTokens?: number | null;
  usageTotalTokens?: number | null;
  creditsCharged?: number | null;
  creditBalanceAfter?: number | null;
  startedAt?: string | number | null;
  completedAt?: string | number | null;
}

export interface ChatApprovalRequest {
  id: string;
  status: "pending" | "resolved" | "expired";
  title?: string;
  description?: string;
  command?: string;
  choices: ChatApprovalChoice[];
  choice?: string;
  smartDenied?: boolean;
  allowPermanent?: boolean;
  timestamp?: number;
}

const defaultRunCapabilities: RunsCapabilityDetails = {
  features: {},
  toolProgressEvents: false,
  runEventsSse: false,
  runStop: false,
  approvalEvents: false,
  runApprovalResponse: false
};
type UseChatRunsParams = {
  selectedId: string;
  selectedIdRef: React.MutableRefObject<string>;
  selectedConversationIdRef: React.MutableRefObject<string | null>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setSending: React.Dispatch<React.SetStateAction<boolean>>;
  refreshAuthoritativeHistory: (instanceId: string, conversationId: string | null) => Promise<void>;
  showToast: (message: string, type?: any) => void;
  t: (key: string, options?: any) => string;
  notificationUserId?: string;
};

export function useChatRuns({
  selectedId,
  selectedIdRef,
  selectedConversationIdRef,
  setMessages,
  setSending,
  refreshAuthoritativeHistory,
  showToast,
  t,
  notificationUserId = ""
}: UseChatRunsParams) {
  const [runsCapabilityState, setRunsCapabilityState] = useState<RunsCapabilityState>("checking");
  const runsSupported = runsCapabilityState === "supported";
  const [activeRunId, setActiveRunIdState] = useState<string | null>(null);
  const [toolStepsState, setToolStepsState] = useState<ChatToolStep[]>([]);
  const [runCapabilities, setRunCapabilities] = useState<RunsCapabilityDetails>(defaultRunCapabilities);
  const [approvalRequests, setApprovalRequests] = useState<ChatApprovalRequest[]>([]);
  const [runMetricsState, setRunMetricsState] = useState<ChatRunMetrics | null>(null);
  const [runExecutionState, setRunExecutionState] = useState<RunExecutionState | null>(null);
  const [stopPending, setStopPendingState] = useState(false);
  const stopPendingRef = useRef(false);
  const approvalResponsePendingRef = useRef(new Set<string>());
  const activeSSEControllerRef = useRef<AbortController | null>(null);
  const activePollingIntervalRef = useRef<any>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const pollingGenerationRef = useRef(0);
  const toolStepsRef = useRef<ChatToolStep[]>([]);
  const lastEventIdRef = useRef<number>(0);
  const runExecutionRef = useRef<RunExecutionState | null>(null);
  const pendingTextRef = useRef("");
  const recoveryTextBaselineRef = useRef("");
  const pendingTextConversationIdRef = useRef<string | null>(null);
  const textFlushTimerRef = useRef<any>(null);
  const setStopPending = useCallback((pending: boolean) => {
    stopPendingRef.current = pending;
    setStopPendingState(pending);
  }, []);
  const setActiveRunId = useCallback((runId: string | null) => {
    currentRunIdRef.current = runId;
    setActiveRunIdState(runId);
  }, []);

  const setRunMetrics = useCallback<React.Dispatch<React.SetStateAction<ChatRunMetrics | null>>>((value) => {
    setRunMetricsState(previous => {
      const incoming = typeof value === "function" ? value(previous) : value;
      if (!incoming) return null;
      if (!previous || (incoming.runId && previous.runId && incoming.runId !== previous.runId)) return incoming;
      return { ...incoming, status: reconcileRunMetricStatus(previous.status, incoming.status) };
    });
  }, []);

  const setToolSteps = useCallback<React.Dispatch<React.SetStateAction<ChatToolStep[]>>>((value) => {
    setToolStepsState((previous) => {
      const next = typeof value === "function" ? value(previous) : value;
      toolStepsRef.current = next;
      return next;
    });
  }, []);

  const toolSteps = toolStepsState;
  const runMetrics = runMetricsState;

  const finalizeActiveRunUi = useCallback((targetRunId: string, status: TerminalRunStatus) => {
    const currentExecution = runExecutionRef.current;
    if (currentExecution?.runId === targetRunId) {
      const finalizedExecution = finalizeRunExecution(currentExecution, status);
      runExecutionRef.current = finalizedExecution;
      setRunExecutionState(finalizedExecution);
      setToolSteps(finalizeRunSteps(deriveToolSteps(finalizedExecution.blocks), status));
    } else {
      setToolSteps(previous => finalizeRunSteps(previous, status));
    }
    setRunMetrics(previous => finalizeRunMetrics(targetRunId, previous, status));
    setApprovalRequests(previous => settleApprovalRequests(previous, undefined, "expired"));
    setStopPending(false);
    if (currentRunIdRef.current === targetRunId) setActiveRunId(null);
  }, [setActiveRunId, setStopPending, setToolSteps]);

  const initializeRunExecution = useCallback((params: {
    runId: string;
    conversationId?: string;
    requestId?: string;
    assistantMessageId?: string;
    status?: RunExecutionStatus;
    initialText?: string;
    initialStep?: ToolEventPayload;
    recoveryTextBaseline?: string;
    resumeAfterEventId?: number;
  }) => {
    if (textFlushTimerRef.current) {
      clearTimeout(textFlushTimerRef.current);
      textFlushTimerRef.current = null;
    }
    pendingTextRef.current = "";
    pendingTextConversationIdRef.current = null;
    recoveryTextBaselineRef.current = params.recoveryTextBaseline || "";
    lastEventIdRef.current = normalizeRunSseResumeCursor(params.resumeAfterEventId);
    setApprovalRequests([]);
    const state = createRunExecutionState(params);
    runExecutionRef.current = state;
    setRunExecutionState(state);
    setToolSteps(deriveToolSteps(state.blocks));
    return state;
  }, [setToolSteps]);

  const flushPendingText = useCallback(() => {
    if (textFlushTimerRef.current) {
      clearTimeout(textFlushTimerRef.current);
      textFlushTimerRef.current = null;
    }

    const pendingText = pendingTextRef.current;
    const pendingTextConversationId = pendingTextConversationIdRef.current;
    if (!pendingText) return;
    pendingTextRef.current = "";
    pendingTextConversationIdRef.current = null;
    const currentExecution = runExecutionRef.current;
    const execution = currentExecution ? applyRunTextSnapshot(currentExecution, pendingText) : null;
    if (execution && pendingTextConversationId && execution.conversationId !== pendingTextConversationId) return;
    if (execution) runExecutionRef.current = execution;
    setRunExecutionState(execution);
    if (execution) setMessages(prev => applyRunExecutionToMessages(prev, execution));
  }, [setMessages]);

  const scheduleTextFlush = useCallback(() => {
    if (textFlushTimerRef.current) return;
    textFlushTimerRef.current = setTimeout(() => {
      flushPendingText();
    }, 120);
  }, [flushPendingText]);

  const stopActiveRunStreams = useCallback(() => {
    pollingGenerationRef.current += 1;
    flushPendingText();

    if (activeSSEControllerRef.current) {
      activeSSEControllerRef.current.abort();
      activeSSEControllerRef.current = null;
    }

    if (activePollingIntervalRef.current) {
      clearTimeout(activePollingIntervalRef.current);
      activePollingIntervalRef.current = null;
    }
    currentRunIdRef.current = null;
  }, [flushPendingText]);

  const resetRunState = useCallback(() => {
    pollingGenerationRef.current += 1;
    setActiveRunId(null);
    setToolSteps([]);
    toolStepsRef.current = [];
    setApprovalRequests([]);
    setRunMetrics(null);
    setStopPending(false);
    lastEventIdRef.current = 0;
    pendingTextRef.current = "";
    pendingTextConversationIdRef.current = null;
    recoveryTextBaselineRef.current = "";
    if (textFlushTimerRef.current) {
      clearTimeout(textFlushTimerRef.current);
      textFlushTimerRef.current = null;
    }
    runExecutionRef.current = null;
    setRunExecutionState(null);
  }, [setActiveRunId, setStopPending, setToolSteps]);

  useEffect(() => {
    return () => {
      stopActiveRunStreams();
    };
  }, [stopActiveRunStreams]);

  useEffect(() => {
    if (!selectedId) {
      setRunsCapabilityState("checking");
      setRunCapabilities(defaultRunCapabilities);
      return;
    }

    let cancelled = false;
    setRunsCapabilityState("checking");
    setRunCapabilities(defaultRunCapabilities);

    async function checkRunsCapability() {
      try {
        const res = await api.get(`/api/instances/${selectedId}/runs-capabilities`);
        if (cancelled) return;
        if (!res?.success) {
          setRunsCapabilityState("unavailable");
          setRunCapabilities(defaultRunCapabilities);
          return;
        }

        setRunCapabilities({
          features: res.features && typeof res.features === "object" ? res.features : {},
          toolProgressEvents: res.toolProgressEvents === true,
          runEventsSse: res.runEventsSse === true || res.features?.run_events_sse === true,
          runStop: res.runStop === true || res.features?.run_stop === true,
          approvalEvents: res.approvalEvents === true || res.features?.approval_events === true,
          runApprovalResponse: res.runApprovalResponse === true || res.features?.run_approval_response === true
        });

        if (res.reason === "INTERACTIVE_RUNS_DISABLED" || res.creationEnabled === false) {
          setRunsCapabilityState("disabled");
          return;
        }

        if (res.reason === "UPSTREAM_RUNS_UNSUPPORTED") {
          setRunsCapabilityState("explicitly_unsupported");
          return;
        }

        if (res.reason === "CAPABILITY_PROBE_FAILED") {
          setRunsCapabilityState("unavailable");
          return;
        }

        if (res.state === "supported") {
          setRunsCapabilityState("supported");
        } else if (res.state === "explicitly_unsupported") {
          setRunsCapabilityState("explicitly_unsupported");
        } else {
          setRunsCapabilityState("unavailable");
        }
      } catch {
        if (!cancelled) {
          setRunsCapabilityState("unavailable");
          setRunCapabilities(defaultRunCapabilities);
        }
      }
    }

    checkRunsCapability();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);


  const normalizeRunMetrics = useCallback((runId: string | null, source: any): ChatRunMetrics => ({
    runId,
    status: source?.status || null,
    errorCode: source?.errorCode || source?.error_code || null,
    durationMs: normalizeRunDurationMs(source),
    usagePromptTokens: typeof source?.usagePromptTokens === "number" ? source.usagePromptTokens : (typeof source?.usage_prompt_tokens === "number" ? source.usage_prompt_tokens : null),
    usageCompletionTokens: typeof source?.usageCompletionTokens === "number" ? source.usageCompletionTokens : (typeof source?.usage_completion_tokens === "number" ? source.usage_completion_tokens : null),
    usageTotalTokens: typeof source?.usageTotalTokens === "number" ? source.usageTotalTokens : (typeof source?.usage_total_tokens === "number" ? source.usage_total_tokens : null),
    creditsCharged: typeof source?.creditsCharged === "number" ? source.creditsCharged : (typeof source?.credits_charged === "number" ? source.credits_charged : null),
    creditBalanceAfter: typeof source?.creditBalanceAfter === "number" ? source.creditBalanceAfter : (typeof source?.credit_balance_after === "number" ? source.credit_balance_after : null),
    startedAt: source?.startedAt || source?.started_at || null,
    completedAt: source?.completedAt || source?.completed_at || null
  }), []);

  const refreshRunMetrics = useCallback(async (instanceId: string, runId: string, fallback?: any) => {
    if (!instanceId || !runId) return;
    if (!shouldApplyRunUpdate(runId, currentRunIdRef.current)) return;
    if (fallback) {
      setRunMetrics(prev => prev?.runId && prev.runId !== runId ? prev : ({ ...prev, ...normalizeRunMetrics(runId, fallback) }));
    }
    try {
      const res = await api.get("/api/instances/" + instanceId + "/runs/" + runId);
      if (res?.success && res.run && shouldApplyRunUpdate(runId, currentRunIdRef.current)) {
        setRunMetrics(normalizeRunMetrics(runId, res.run));
      }
    } catch (err) {
      console.warn("[ChatWorkspace] Failed to load run metrics:", err);
    }
  }, [normalizeRunMetrics]);

  const handleParsedSSEEvent = useCallback((eventId: number, event: string, data: string, boundInstanceId: string | null, boundConversationId: string | null, boundRunId?: string | null): boolean => {
    if (!boundInstanceId || !boundConversationId) return false;
    if (boundRunId && currentRunIdRef.current !== boundRunId) return false;

    if (selectedIdRef.current !== boundInstanceId || selectedConversationIdRef.current !== boundConversationId) return false;

    const runId = boundRunId || currentRunIdRef.current;
    if (!runId) return false;
    let currentExecution = runExecutionRef.current;
    if (!currentExecution || currentExecution.runId !== runId) {
      currentExecution = createRunExecutionState({ runId, conversationId: boundConversationId, status: "running" });
      runExecutionRef.current = currentExecution;
      setRunExecutionState(currentExecution);
    }
    const frameResult = consumeRunSseFrame(currentExecution, {
      currentEventId: 0,
      lastCommittedEventId: lastEventIdRef.current
    }, {
      eventId,
      event,
      data,
      runId,
      conversationId: boundConversationId,
      requestId: currentExecution.requestId
    });
    lastEventIdRef.current = frameResult.cursor.lastCommittedEventId;
    if (!frameResult.consumed) return false;
    const nextExecution = frameResult.state;
    runExecutionRef.current = nextExecution;
    if (event !== "text") setRunExecutionState(nextExecution);

    try {
      if (event === "text") {
        pendingTextConversationIdRef.current = boundConversationId;
        pendingTextRef.current = mergeRecoveredStreamingContent(recoveryTextBaselineRef.current, deriveAssistantText(nextExecution.blocks));
        scheduleTextFlush();
        return true;
      } else if (event === "step") {
        setToolSteps(deriveToolSteps(nextExecution.blocks));
        return true;
      } else if (event === "approval") {
        const approval = JSON.parse(data) as ChatApprovalRequest;
        if (!approval?.id) return false;
        setApprovalRequests(previous => mergeApprovalEvent(previous, approval));
        return true;
      } else if (event === "status") {
        const parsed = JSON.parse(data);
        if (isTerminalRunStatus(parsed.status)) {
          flushPendingText();
          pollingGenerationRef.current += 1;
          if (boundRunId) finalizeActiveRunUi(boundRunId, parsed.status);
          if (parsed.status === "completed" && notificationUserId && boundRunId) markChatRunCompleted(notificationUserId, boundRunId);
          setSending(false);
          if (activeSSEControllerRef.current) {
            activeSSEControllerRef.current.abort();
            activeSSEControllerRef.current = null;
          }
          if (boundRunId) {
            void refreshRunMetrics(boundInstanceId, boundRunId, parsed);
          }
          refreshAuthoritativeHistory(boundInstanceId, boundConversationId);
        }
        return true;
      }
    } catch (e) {
      console.error("[SSE Event processing error]", e);
      return false;
    }
    return false;
  }, [finalizeActiveRunUi, flushPendingText, refreshAuthoritativeHistory, refreshRunMetrics, scheduleTextFlush, selectedConversationIdRef, selectedIdRef, setSending, notificationUserId]);

  const startFallbackPolling = useCallback((runId: string, boundInstanceId = selectedIdRef.current, boundConversationId = selectedConversationIdRef.current) => {
    const runGeneration = pollingGenerationRef.current;
    if (activePollingIntervalRef.current) {
      clearTimeout(activePollingIntervalRef.current);
      activePollingIntervalRef.current = null;
    }

    let pollAttempts = 0;
    const maxPollAttempts = 40;
    let pollDelayMs = 2000; // Smart exponential backoff starting at 2s
    let statusUnknownPublished = false;
    const publishStatusUnknown = () => {
      if (statusUnknownPublished) return;
      statusUnknownPublished = true;
      setRunMetrics(prev => prev?.runId === runId ? { ...prev, status: "status_unknown" } : prev);
      setStopPending(false);
    };

    const scheduleNextPoll = () => {
      const currentSelectedId = boundInstanceId;
      const currentConvId = boundConversationId;

      if (!currentSelectedId || !currentConvId || selectedIdRef.current !== currentSelectedId || selectedConversationIdRef.current !== currentConvId || !canExecutePollingCallback({ boundRunId: runId, currentRunId: currentRunIdRef.current, boundGeneration: runGeneration, currentGeneration: pollingGenerationRef.current })) {
        pendingTextRef.current = "";
        pendingTextConversationIdRef.current = null;
        if (activePollingIntervalRef.current) {
          clearTimeout(activePollingIntervalRef.current);
          activePollingIntervalRef.current = null;
        }
        return;
      }

      activePollingIntervalRef.current = setTimeout(async () => {
        if (!selectedIdRef.current || selectedIdRef.current !== currentSelectedId || selectedConversationIdRef.current !== currentConvId || !canExecutePollingCallback({ boundRunId: runId, currentRunId: currentRunIdRef.current, boundGeneration: runGeneration, currentGeneration: pollingGenerationRef.current })) {
          return;
        }

        pollAttempts++;
        if (pollAttempts > maxPollAttempts) {
          pollDelayMs = 30_000;
        }

        try {
          const res = await api.get(`/api/instances/${currentSelectedId}/runs/${runId}`);
          if (selectedIdRef.current !== currentSelectedId || selectedConversationIdRef.current !== currentConvId || !canExecutePollingCallback({ boundRunId: runId, currentRunId: currentRunIdRef.current, boundGeneration: runGeneration, currentGeneration: pollingGenerationRef.current })) {
            return;
          }

          if (res && res.success && res.run) {
            const run = res.run;
            if (run.status && !isTerminalRunStatus(run.status)) {
              statusUnknownPublished = false;
              setRunMetrics(prev => prev?.runId === runId ? { ...prev, status: run.status } : prev);
            }
            if (run.partialOutput) {
              const execution = runExecutionRef.current;
              if (execution?.runId === runId && execution.conversationId === currentConvId) {
                const reconciled = applyRunTextSnapshot(execution, run.partialOutput);
                runExecutionRef.current = reconciled;
                setRunExecutionState(reconciled);
                setMessages(prev => applyRunExecutionToMessages(prev, reconciled));
              }
            }

            if (isTerminalRunStatus(run.status)) {
              if (activePollingIntervalRef.current) {
              pollingGenerationRef.current += 1;
              finalizeActiveRunUi(runId, run.status);
              if (run.status === "completed" && notificationUserId) markChatRunCompleted(notificationUserId, runId);
                clearTimeout(activePollingIntervalRef.current);
                activePollingIntervalRef.current = null;
              }
              setSending(false);
              void refreshRunMetrics(currentSelectedId, runId, run);
              refreshAuthoritativeHistory(currentSelectedId, currentConvId);
              return;
            }
          }
          if (pollAttempts > maxPollAttempts && !(res?.success && typeof res?.run?.status === "string" && res.run.status)) {
            publishStatusUnknown();
          }
        } catch (e) {
          console.error("[Polling Fallback Error]", e);
          if (pollAttempts > maxPollAttempts) publishStatusUnknown();
        }

        // Exponential backoff up to 10s max
        pollDelayMs = pollAttempts > maxPollAttempts ? 30_000 : Math.min(10000, Math.round(pollDelayMs * 1.5));
        scheduleNextPoll();
      }, pollDelayMs);
    };

    scheduleNextPoll();

    activeSSEControllerRef.current?.signal.addEventListener("abort", () => {
      if (activePollingIntervalRef.current) {
        clearTimeout(activePollingIntervalRef.current);
        activePollingIntervalRef.current = null;
      }
    });
  }, [finalizeActiveRunUi, refreshAuthoritativeHistory, refreshRunMetrics, selectedConversationIdRef, selectedIdRef, setMessages, setSending, setStopPending, notificationUserId]);

  const streamActiveRun = useCallback(async (runId: string, boundInstanceId = selectedIdRef.current, boundConversationId = selectedConversationIdRef.current) => {
    const streamGeneration = pollingGenerationRef.current;
    if (!boundInstanceId || !boundConversationId || currentRunIdRef.current !== runId) return;

    if (activeSSEControllerRef.current) {
      activeSSEControllerRef.current.abort();
    }

    const controller = new AbortController();
    activeSSEControllerRef.current = controller;

    let attempt = 0;
    const maxAttempts = 5;
    let isTerminal = false;

    let fallbackStarted = false;
    const triggerFallback = () => {
      if (!fallbackStarted && currentRunIdRef.current === runId && pollingGenerationRef.current === streamGeneration) {
        fallbackStarted = true;
        startFallbackPolling(runId, boundInstanceId, boundConversationId);
      }
    };

    while (attempt < maxAttempts) {
      if (controller.signal.aborted || isTerminal || currentRunIdRef.current !== runId || pollingGenerationRef.current !== streamGeneration) break;

      const token = getAuthToken();
      const headers: Record<string, string> = {
        "Accept": "text/event-stream"
      };
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const currentSeq = lastEventIdRef.current;
      if (currentSeq > 0) {
        headers["Last-Event-ID"] = String(currentSeq);
      }

      let resetAttemptTimeoutId: any = null;

      try {
        const urlSuffix = currentSeq > 0 ? `?last_event_id=${currentSeq}` : "";
        if (!boundInstanceId || !boundConversationId || selectedIdRef.current !== boundInstanceId || selectedConversationIdRef.current !== boundConversationId || currentRunIdRef.current !== runId || pollingGenerationRef.current !== streamGeneration) {
          break;
        }

        const response = await fetch(`/api/instances/${boundInstanceId}/runs/${runId}/events${urlSuffix}`, {
          headers,
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Failed to connect to SSE events");
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body reader unavailable");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        let currentData = "";
        let currentEventId = 0;

        resetAttemptTimeoutId = setTimeout(() => {
          attempt = 0;
        }, 5000);

        const parseLineAndProcess = (rawLine: string): boolean | undefined => {
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          if (line.startsWith(":")) {
            return;
          }
          if (line === "") {
            if (currentEvent || currentData) {
              const dispEvent = currentEvent || "message";
              if (dispEvent === "error") {
                try {
                  const parsed = JSON.parse(currentData);
                  if (parsed.errorCode === "RECOVERY_OUT_OF_BOUNDS") {
                    console.warn("RECOVERY_OUT_OF_BOUNDS received. Fallback to status polling.");
                    triggerFallback();
                    return true;
                  }
                } catch {}
              } else if (dispEvent === "status") {
                try {
                  const parsed = JSON.parse(currentData);
                  if (["completed", "failed", "cancelled", "stopped", "expired"].includes(parsed.status)) {
                    isTerminal = true;
                  }
                } catch {}
              }
              handleParsedSSEEvent(currentEventId, dispEvent, currentData, boundInstanceId, boundConversationId, runId);
              currentEventId = 0;
            }
            currentEvent = "";
            currentData = "";
            return;
          }

          if (line.startsWith("id:")) {
            const idVal = parseInt(line.slice(3).trim(), 10);
            if (!isNaN(idVal)) {
              currentEventId = observeRunSseEventId({ currentEventId, lastCommittedEventId: lastEventIdRef.current }, idVal).currentEventId;
            }
          } else if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            let val = line.slice(5);
            if (val.startsWith(" ")) {
              val = val.slice(1);
            }
            currentData = currentData ? currentData + "\n" + val : val;
          }
        };

        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            if (buffer) {
              const tailLines = buffer.split("\n");
              for (const tl of tailLines) {
                if (parseLineAndProcess(tl)) {
                  clearTimeout(resetAttemptTimeoutId);
                  return;
                }
              }
              buffer = "";
            }
            if (currentEvent || currentData) {
              parseLineAndProcess("");
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const rawLine of lines) {
            if (parseLineAndProcess(rawLine)) {
              clearTimeout(resetAttemptTimeoutId);
              return;
            }
            if (isTerminal) {
              break;
            }
          }

          if (isTerminal) {
            break;
          }
        }

        clearTimeout(resetAttemptTimeoutId);

        if (!isTerminal) {
          throw new Error("Stream closed before terminal status");
        }
        break;
      } catch (err: any) {
        if (resetAttemptTimeoutId) {
          clearTimeout(resetAttemptTimeoutId);
        }

        if (err.name === "AbortError" || controller.signal.aborted || isTerminal) {
          break;
        }
        attempt++;
        if (attempt >= maxAttempts) {
          console.error("[SSE Stream Connection Error] Max attempts reached, fallback to status polling.");
          triggerFallback();
          break;
        }
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(`[SSE Stream] Disconnected. Reconnecting in ${delay}ms... (Attempt ${attempt}/${maxAttempts})`);

        await new Promise<void>((resolve) => {
          const timerId = setTimeout(() => {
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          }, delay);

          const onAbort = () => {
            clearTimeout(timerId);
            resolve();
          };

          controller.signal.addEventListener("abort", onAbort);
        });
      }
    }

    if (!isTerminal) {
      triggerFallback();
    }
  }, [handleParsedSSEEvent, selectedConversationIdRef, selectedIdRef, startFallbackPolling]);

  const handleStopRun = useCallback(async (targetRunId = activeRunId, targetInstanceId = selectedId) => {
    if (!targetRunId || !targetInstanceId || !runCapabilities.runStop) return { ok: false as const, error: "RUN_STOP_UNAVAILABLE" };
    if (stopPendingRef.current) return { ok: false as const, error: "RUN_STOP_ALREADY_PENDING" };
    setStopPending(true);
    try {
      const res = await api.post(`/api/instances/${targetInstanceId}/runs/${targetRunId}/stop`);
      if (res && res.success) {
        showToast(t("dashboard:chatWorkspace.stopRequestSent"), "success");
        const status = String(res.status || res.runStatus || res.run_status || "stopping").toLowerCase();
        if (currentRunIdRef.current === targetRunId) {
          setRunMetrics(prev => prev?.runId === targetRunId ? { ...prev, status } : prev);
          const currentExecution = runExecutionRef.current;
          if (currentExecution?.runId === targetRunId && status === "stopping") {
            const stoppingExecution = { ...currentExecution, status: "stopping" as const };
            runExecutionRef.current = stoppingExecution;
            setRunExecutionState(stoppingExecution);
          }
        }
        return { ok: true as const, status };
      }
      return { ok: false as const, error: String(res?.error || "RUN_STOP_FAILED") };
    } catch (e: any) {
      showToast(getChatErrorMessage(e, t("dashboard:chatWorkspace.stopRequestFailed")), "error");
      return { ok: false as const, error: String(e?.message || "RUN_STOP_FAILED") };
    } finally {
      setStopPending(false);
    }
  }, [activeRunId, runCapabilities.runStop, selectedId, setStopPending, showToast, t]);


  const respondToApproval = useCallback(async (choice: ChatApprovalChoice, approvalId?: string, resolveAll = false) => {
    if (!activeRunId || !runCapabilities.runApprovalResponse) return;
    const submissionKey = activeRunId + ":" + (approvalId || (resolveAll ? "all" : "current"));
    if (approvalResponsePendingRef.current.has(submissionKey)) return;
    approvalResponsePendingRef.current.add(submissionKey);
    try {
      const res = await api.post(`/api/instances/${selectedId}/runs/${activeRunId}/approval`, {
        choice,
        approvalId,
        resolveAll
      });
      if (res && res.success) {
        setApprovalRequests(previous => settleApprovalRequests(previous, approvalId, "resolved", choice));
        const currentExecution = runExecutionRef.current;
        if (currentExecution?.runId === activeRunId) {
          const blocks = currentExecution.blocks.map(block => block.type === "approval" && (!approvalId || block.approvalId === approvalId) && block.status === "pending"
            ? { ...block, status: "resolved" as const, metadata: { ...(block.metadata || {}), choice } }
            : block);
          const execution = {
            ...currentExecution,
            status: currentExecution.status === "waiting_for_approval" ? "running" as const : currentExecution.status,
            blocks
          };
          runExecutionRef.current = execution;
          setRunExecutionState(execution);
        }
        showToast(t("dashboard:chatWorkspace.approvalSubmitted"), "success");
      }
    } catch (e: any) {
      showToast(getChatErrorMessage(e, t("dashboard:chatWorkspace.approvalSubmitFailed")), "error");
    } finally {
      approvalResponsePendingRef.current.delete(submissionKey);
    }
  }, [activeRunId, runCapabilities.runApprovalResponse, selectedId, showToast, t]);
  return {
    runsCapabilityState,
    runsSupported,
    activeRunId,
    stopPending,
    runCapabilities,
    approvalRequests,
    runMetrics,
    toolSteps,
    runExecutionState,
    setRunMetrics,
    setActiveRunId,
    setToolSteps,
    initializeRunExecution,
    finalizeActiveRunUi,
    streamActiveRun,
    handleStopRun,
    respondToApproval,
    stopActiveRunStreams,
    resetRunState
  };
}

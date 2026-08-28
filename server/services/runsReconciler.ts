import { chatRepo } from "../repositories/chatRepo";
import { emitChatConversationUpdated } from "./chatRealtime";
import { dbAdapter } from "../db";
import { decrypt } from "../crypto";

import * as crypto from "crypto";
import { EventEmitter } from "events";



import { buildAgentAttachmentContextForPrompt, loadAndValidateChatAttachments } from "../utils/chatAttachments";
import { MANAGED_OPERATION_SYSTEM_POLICY } from "../utils/managedOperationGuard";
import { normalizeUsage } from "./usageNormalizer";


import {
  extractUpstreamErrorCode,
  isStaleSessionError,
  isStreamingDecoderCompatError,
  shouldFallbackSessionCreate,
  shouldPreferNonStreamingChatForInstance
} from "./runs/runHermesProtocol";
import {
  createRunLeaseController,
  DEFAULT_RUN_LEASE_POLICY,
  hasValidRunLease as validateRunLease,
} from "./runs/runLease";
import {
  sanitizeRunErrorCode,
  terminalizeRun,
  type RunTerminalStatus,
  type RunTerminalUsage,
} from "./runs/runTerminalization";
import {
  findRecoveredUpstreamId,
  handleDispatchRecordResult as resolveDispatchRecordResult,
  hasReachedDispatchAttemptLimit,
  isValidUpstreamRunId,
  normalizeDispatchError as normalizeRunDispatchError,
  shouldSearchForDispatchedRun,
} from "./runs/runDispatchRecovery";
import {
  hasRunExceededRuntime,
  resolveMaxRuntimeMs,
  resolvePartialOutput,
  resolveProbeFailure,
  resolveTerminalProbeOutcome,
} from "./runs/runProbeController";
import {
  createRunEventCacheController,
  createRunSseStreamController,
  type CachedRunEvent,
} from "./runs/runEventLifecycle";
import {
  type RunsRequestOptions,
  type RunsRequestResult,
} from "./runs/runHermesTransport";
import {
  createRunNonStreamingChatExecutor,
  filterCurrentRunMessageFromHistory as filterNonStreamingHistory,
} from "./runs/runNonStreamingChatExecutor";
import {
  createRunReconcileScheduler,
  type StartRunReconcileSchedulerOptions,
} from "./runs/runReconcileScheduler";
import {
  assertVerifiedRunCompletionV1,
  verifyRunCompletionV1,
} from "./runs/runCompletionVerification";
import { submitRunWithIdempotentRecovery } from "./runs/runSubmissionRecovery";
import { publishPendingRuntimeInteractions } from "./runs/runPendingInteractionRecovery";
import { convergeRunTerminalProbe } from "./runs/runTerminalConvergence";
import { recoverStoppingRun } from "./runs/runStopRecovery";
import {
  canRecoverApprovalInteractions,
  resolveConversationDispatchMode,
  resolveTerminalObservationCapability,
} from "./runs/runtimeCapabilityConsumers";
import { containsDsmlToolCallProtocol } from "../utils/dsmlToolCallGuard";
import { resolveRunDispatchAuthority } from "./instances/resourceAuthorityService";
import { runtimeRegistry } from "../runtime/runtimeRegistry";
import type {
  PersistedRuntimeBindingSubject,
  RuntimeDriver,
  RuntimeRunEventController,
  RuntimeRunPreparationController,
  RuntimeSessionBinding,
  RuntimeRunTerminalOutcome,
} from "../runtime/contracts";
import { toHermesReasoningModelOptions } from "../runtime/adapters/hermes/HermesRunPreparation";

export { sanitizeStep } from "./runs/runStepSanitizer";
export {
  extractUpstreamErrorCode,
  isFallbackHermesSessionId,
  isStaleSessionError,
  shouldFallbackSessionCreate
} from "./runs/runHermesProtocol";
export { toHermesReasoningModelOptions } from "../runtime/adapters/hermes/HermesRunPreparation";

export const runsEventsEmitter = new EventEmitter();

// Unique identifier for this reconciler instance to manage leases
export const RECONCILER_ID = `reconciler-${crypto.randomUUID()}`;

/**
 * Fail-closed lease validation shared by every dispatch/recovery path.
 * Missing, malformed, expired, or foreign leases must never authorize work.
 */
export function hasValidRunLease(
  run: any,
  reconcilerId: string = RECONCILER_ID,
  nowMs: number = Date.now()
): boolean {
  return validateRunLease(run, reconcilerId, nowMs);
}

// Memory event cache for SSE streaming
export type CachedSSEEvent = CachedRunEvent;


// Memory caches
const runReconcileScheduler = createRunReconcileScheduler({
  ownerId: RECONCILER_ID,
  isTestEnvironment: () => process.env.NODE_ENV === "test",
  createLeaseController: (claimLimit) => createRunLeaseController({
    repository: chatRepo,
    ownerId: RECONCILER_ID,
    policy: {
      ...DEFAULT_RUN_LEASE_POLICY,
      claimLimit,
    },
  }),
  emitClaimed: (run) => emitRunLifecycleStep(
    run.id,
    "worker-claimed",
    "Deployment worker claimed the Agent task",
    "completed",
    "model_reasoning",
    RECONCILER_ID,
    { runtime: "local" }
  ),
  processRun: (run, leaseLostRuns) => processSingleRun(run, leaseLostRuns),
  cleanupInactiveCaches: () => cleanupInactiveRunCaches(),
  clearStreams: () => runSseStreamController.clearAll(),
  logStarted: (intervalMs, ownerId) => console.log(
    "[RunsReconciler] Background asynchronous runs controller started (Interval: "
      + (intervalMs / 1000) + "s, Node: " + ownerId + ")"
  ),
  logError: (message, detail) => {
    if (detail === undefined) console.error(message);
    else console.error(message, detail);
  }
});
function createNonStreamingChatExecutor(requestRuns: (options: RunsRequestOptions) => Promise<RunsRequestResult>) {
  return createRunNonStreamingChatExecutor({
    requestRuns,
    emitStatus: (runId, status) => addEventToCache(runId, "status", JSON.stringify(status)),
    toReasoningModelOptions: (value) => toHermesReasoningModelOptions(value),
    completeRun: (runId, status, assistantContent, errorCode, usage, durationMs, completionEvidence) =>
      completeRun(runId, status, assistantContent, errorCode, usage as any, durationMs,
        completionEvidence ? { response: completionEvidence } : {}),
    logOperation: (operation, runId, instanceId, statusCode, errorCode, durationMs) =>
      logOperation(operation, runId, instanceId, statusCode, errorCode, durationMs),
    now: () => Date.now()
  });
}
function createRuntimeRunPreparation(driver: RuntimeDriver): RuntimeRunPreparationController {
  return driver.preparation.createController({
    request: (options) => driver.runs.request(options),
    bindConversationSessionId: (conversationId, sessionId) =>
      chatRepo.bindConversationSessionId(conversationId, sessionId),
    getConversationForSessionBinding: (conversationId) =>
      chatRepo.getConversationForSessionBinding(conversationId),
    logFallback: (conversationId, instanceId, statusCode) =>
      logOperation(
        "HERMES_SESSION_CREATE_UNAVAILABLE_FALLBACK",
        conversationId,
        instanceId,
        statusCode,
        "USING_STABLE_SESSION_ID"
      ),
    deduplicateHistoryEnabled: () => process.env.MYBAY_DEDUPLICATE_CHAT_HISTORY === "true",
    systemPolicy: MANAGED_OPERATION_SYSTEM_POLICY
  });
}
const runtimeRunEventControllers = new Map<string, RuntimeRunEventController>();

function getRuntimeRunEventController(driver: RuntimeDriver): RuntimeRunEventController {
  const key = `${driver.runtimeType}:${driver.providerKey}:${driver.contractVersion}`;
  const existing = runtimeRunEventControllers.get(key);
  if (existing) return existing;

  const controller = driver.events.createController({
    addEvent: (runId, event, data, ownerId) => addEventToCache(runId, event, data, ownerId),
    completeTerminal: (run, outcome, upstreamRunId) =>
      completeRunFromRuntimeEvent(run, outcome, upstreamRunId),
    requestReconcile: () => requestRunsReconcile(),
    warn: (message, detail) => console.warn(message, detail),
    randomUUID: () => crypto.randomUUID(),
    now: () => Date.now(),
  });
  runtimeRunEventControllers.set(key, controller);
  return controller;
}
const runSseStreamController = createRunSseStreamController();
const runEventCacheController = createRunEventCacheController({
  persistSequence: (runId, sequence, ownerId) =>
    chatRepo.updateChatRun(runId, { last_event_seq: sequence }, ownerId),
  emit: (runId, event) => {
    runsEventsEmitter.emit(`event:${runId}`, event);
  },
  onClear: (runId) => {
    runSseStreamController.clear(runId);
    for (const controller of runtimeRunEventControllers.values()) controller.clear(runId);
  },
  warn: (message) => console.warn(message),
  now: () => Date.now(),
});

function getMaxRuntimeMs(): number {
  return resolveMaxRuntimeMs(process.env.MYBAY_ASYNC_CHAT_MAX_RUNTIME_SECONDS);
}

/**
 * Clean logging utility to prevent sensitive parameter leaks
 */
function logOperation(
  operation: string,
  runId: string,
  instanceId: string,
  statusCode: number,
  errorCode?: string,
  durationMs?: number
) {
  console.log(
    `[RunsReconciler] Operation: ${operation} | MyBay runId: ${runId} | instanceId: ${instanceId} | statusCode: ${statusCode} | safe errorCode: ${errorCode || "none"} | durationMs: ${durationMs || 0}`
  );
}

export function touchRunActivity(runId: string) {
  runEventCacheController.touch(runId);
}

export function initRunSequence(runId: string, startSeq: number) {
  runEventCacheController.initSequence(runId, startSeq);
}

export function setTerminalRunExpiry(runId: string) {
  runEventCacheController.setTerminalExpiry(runId);
}

export function addEventToCache(
  runId: string,
  event: string,
  data: string,
  reconcilerId?: string
): { added: boolean; event?: CachedSSEEvent } {
  return runEventCacheController.add(runId, event, data, reconcilerId);
}

type RunLifecycleStepStatus = "running" | "completed" | "failed";
type RunLifecycleStepType = "model_reasoning" | "tool_call" | "final";

export function emitRunLifecycleStep(
  runId: string,
  stepKey: string,
  title: string,
  status: RunLifecycleStepStatus = "running",
  stepType: RunLifecycleStepType = "model_reasoning",
  reconcilerId?: string,
  metadata?: Record<string, unknown>
) {
  const timestamp = Date.now();
  addEventToCache(
    runId,
    "step",
    JSON.stringify({
      id: `${runId}-${stepKey}`,
      stepType,
      status,
      title,
      safe_summary: title,
      startedAt: status === "running" ? timestamp : undefined,
      completedAt: status !== "running" ? timestamp : undefined,
      metadata: metadata || {}
    }),
    reconcilerId
  );
}

export function getEventsFromCache(
  runId: string,
  lastEventId: number
): { events: CachedSSEEvent[]; recoveryOutOfBounds?: boolean } {
  return runEventCacheController.get(runId, lastEventId);
}

export function clearEventsCache(runId: string) {
  runEventCacheController.clear(runId);
}

export async function completeRunFromRuntimeEvent(
  run: any,
  outcome: RuntimeRunTerminalOutcome,
  upstreamRunId: string,
): Promise<boolean> {
  if (!run || !outcome || !/^[A-Za-z0-9_.-]{1,128}$/.test(upstreamRunId || "")) return false;

  if (outcome.status === "completed") {
    return completeRun(run.id, "completed", outcome.assistantContent, undefined, outcome.usage, outcome.durationMs, {
      expectedUpstreamRunId: upstreamRunId,
      runSnapshot: {
        ...run,
        status: run.status || "running",
        upstream_run_id: run.upstream_run_id || upstreamRunId,
      },
    });
  }

  if (outcome.status === "failed") {
    return completeRun(run.id, "failed", "", outcome.errorCode, outcome.usage, outcome.durationMs, {
      expectedUpstreamRunId: upstreamRunId,
    });
  }

  return completeRun(run.id, "cancelled", "", outcome.errorCode, outcome.usage, outcome.durationMs, {
    expectedUpstreamRunId: upstreamRunId,
  });
}

export function handleRuntimeRunEvent(
  driver: RuntimeDriver,
  run: any,
  event: unknown,
  upstreamRunId = String((event as any)?.run_id || ""),
) {
  getRuntimeRunEventController(driver).handle(run, event, upstreamRunId);
}
function ensureUpstreamRunEventStream(run: any, upstreamRunId: string, driver: RuntimeDriver) {
  runSseStreamController.ensure(
    run.id,
    (signal, onChunk) => driver.runs.streamEvents(run.instance_id, upstreamRunId, signal, onChunk),
    (event) => handleRuntimeRunEvent(driver, run, event, upstreamRunId),
  );
}

// Inactive cache cleanup is owned by the reconciler lifecycle.
function cleanupInactiveRunCaches() {
  runEventCacheController.cleanupInactive();
}

async function requestRuntimeRunsAPI(driver: RuntimeDriver, options: RunsRequestOptions): Promise<RunsRequestResult> {
  return driver.runs.request({
    instanceId: options.instanceId,
    method: options.method,
    path: options.path,
    body: options.body,
    headers: options.headers,
    timeoutMs: options.timeoutMs,
    sessionId: options.hermesSessionId,
  });
}

export async function requestRunsAPI(
  options: RunsRequestOptions,
  bindingSubject?: PersistedRuntimeBindingSubject,
): Promise<RunsRequestResult> {
  const driver = bindingSubject
    ? runtimeRegistry.getForBinding(runtimeRegistry.resolveRunBinding(bindingSubject))
    : runtimeRegistry.get();
  return requestRuntimeRunsAPI(driver, options);
}

export function requestRunsReconcile(): boolean {
  return runReconcileScheduler.requestReconcile();
}

export async function startRunsReconciler(
  intervalMs = 5000,
  options: StartRunReconcileSchedulerOptions = {}
) {
  return runReconcileScheduler.start(intervalMs, options);
}

export function stopRunsReconciler() {
  runReconcileScheduler.stop();
}
function normalizeDispatchError(statusCode: number, rawError?: unknown): string {
  return normalizeRunDispatchError(statusCode, rawError);
}
export function sanitizeErrorCode(rawError: unknown): string {
  return sanitizeRunErrorCode(rawError);
}

export function filterCurrentRunMessageFromHistory(
  history: Array<{ id?: string; request_id?: string; role: string; content: string }>,
  currentUserMessageId?: string | null,
  currentRequestId?: string | null
) {
  return filterNonStreamingHistory(history, currentUserMessageId, currentRequestId);
}
async function observeRunTerminalUsage(
  runId: string,
  effectiveStatus: RunTerminalStatus,
  usage: RunTerminalUsage,
): Promise<void> {
  const latestRun = await chatRepo.getChatRun(runId).catch(() => null);
  let provider: string | null = null;
  let model: string | null = null;
  let sessionId: string | null = null;

  if (latestRun?.conversation_id) {
    const conv = await chatRepo.getConversationForSessionBinding(latestRun.conversation_id).catch(() => null);
    if (conv?.session_id) {
      sessionId = conv.session_id;
    }
  }

  if (latestRun?.instance_id) {
    const inst = await dbAdapter.getInstanceById(latestRun.instance_id).catch(() => null);
    if (inst) {
      let cfg: any = {};
      if (typeof inst.config_json === "string") {
        try { cfg = JSON.parse(inst.config_json); } catch {}
      } else if (inst.config_json && typeof inst.config_json === "object") {
        cfg = inst.config_json;
      }
      provider = cfg.provider || cfg.model_provider || inst.model_provider || null;
      model = cfg.model || cfg.current_model || cfg.MODEL || inst.model_name || null;
    }
  }

  const normalizedObserved = normalizeUsage(usage);
  console.log(JSON.stringify({
    operation: "agent_run_usage_observed",
    runId,
    upstreamRunId: latestRun?.upstream_run_id || null,
    instanceId: latestRun?.instance_id || null,
    conversationId: latestRun?.conversation_id || null,
    sessionId: sessionId || latestRun?.session_id || null,
    provider,
    model,
    finalStatus: effectiveStatus,
    usageSchema: normalizedObserved.usageSchema,
    rawUsageKeys: normalizedObserved.rawUsageKeys,
    anomalies: normalizedObserved.anomalies,
    usage: normalizedObserved,
  }));
}

export async function completeRun(
  runId: string,
  finalStatus: RunTerminalStatus,
  assistantContent = "",
  errorCode?: string,
  usage?: RunTerminalUsage,
  durationMs?: number | null,
  authorization: {
    expectedUpstreamRunId?: string;
    response?: { requestId: string; responseStatusCode: number };
    runSnapshot?: any;
  } = {},
): Promise<boolean> {
  let completionAudit: Record<string, unknown> | undefined;
  if (finalStatus === "completed" && !containsDsmlToolCallProtocol(assistantContent)) {
    const run = authorization.runSnapshot || await chatRepo.getChatRun(runId).catch(() => null);
    const isAlreadyTerminal = ["completed", "failed", "cancelled", "expired"].includes(String(run?.status || ""));
    const claim = isAlreadyTerminal ? null : authorization.response
      ? {
          source: "runtime_response" as const,
          runId,
          assistantContent,
          observedAtMs: Date.now(),
          requestId: authorization.response.requestId,
          responseStatusCode: authorization.response.responseStatusCode,
        }
      : authorization.expectedUpstreamRunId
        ? {
            source: "runtime_status" as const,
            runId,
            assistantContent,
            observedAtMs: Date.now(),
            upstreamRunId: authorization.expectedUpstreamRunId,
          }
        : null;
    if (!isAlreadyTerminal && !claim) {
      console.warn(JSON.stringify({ operation: "run_completion_rejected", runId, reason: "RUN_COMPLETION_EVIDENCE_REQUIRED" }));
      return false;
    }
    const decision = claim ? verifyRunCompletionV1(run, claim, RECONCILER_ID) : null;
    if (decision && !decision.verified) {
      console.warn(JSON.stringify({
        operation: "run_completion_rejected",
        runId,
        reason: "reason" in decision ? decision.reason : "RUN_COMPLETION_REJECTED",
      }));
      return false;
    } else if (decision?.verified) {
      completionAudit = assertVerifiedRunCompletionV1(decision.verification, runId, assistantContent);
    }
  }

  return terminalizeRun({
    runId,
    finalStatus,
    assistantContent,
    errorCode,
    usage,
    durationMs,
    expectedUpstreamRunId: authorization.expectedUpstreamRunId,
    completionAudit,
  }, {
    ownerId: RECONCILER_ID,
    finishRun: (params) => chatRepo.finishChatRun(params),
    getRun: (id) => chatRepo.getChatRun(id),
    addEvent: addEventToCache,
    emitConversationUpdated: emitChatConversationUpdated,
    setTerminalExpiry: setTerminalRunExpiry,
    observeUsage: ({ runId: observedRunId, effectiveStatus, usage: observedUsage }) =>
      observeRunTerminalUsage(observedRunId, effectiveStatus, observedUsage),
    warn: (message) => console.warn(message),
  });
}

async function handleDispatchRecordResult(
  run: any,
  recordRes: { status: string; run_status: string | null },
  upstreamId: string,
  leaseLostRuns: Set<string>,
  runtimeDriver: RuntimeDriver,
): Promise<boolean> {
  return resolveDispatchRecordResult(run, recordRes, upstreamId, {
    publishStatus: (runId, status) => addEventToCache(runId, "status", JSON.stringify({ status })),
    startEventStream: (targetRun, targetUpstreamId) => ensureUpstreamRunEventStream(targetRun, targetUpstreamId, runtimeDriver),
    clearEvents: clearEventsCache,
    markLeaseLost: (runId) => {
      leaseLostRuns.add(runId);
    },
    logOperation,
    getRun: (runId) => chatRepo.getChatRun(runId),
    hasValidLease: hasValidRunLease,
    failRun: (runId, errorCode) => completeRun(runId, "failed", "", errorCode),
  });
}
export async function processSingleRun(run: any, leaseLostRuns: Set<string>) {
  const status = run.status;
  initRunSequence(run.id, run.last_event_seq || 0);

  const dispatchAuthority = await resolveRunDispatchAuthority(run);
  if (dispatchAuthority.ok === false) {
    logOperation("RUN_RESOURCE_AUTHORITY_REJECTED", run.id, run.instance_id, dispatchAuthority.status, dispatchAuthority.code);
    await completeRun(run.id, "failed", "", dispatchAuthority.code);
    return;
  }

  let runtimeDriver: RuntimeDriver;
  try {
    runtimeDriver = runtimeRegistry.getForBinding(runtimeRegistry.resolveRunBinding(run));
  } catch (error: any) {
    logOperation("RUN_RUNTIME_BINDING_REJECTED", run.id, run.instance_id, 422, error?.code || "UNSUPPORTED_RUNTIME_BINDING");
    await completeRun(run.id, "failed", "", "UNSUPPORTED_RUNTIME_BINDING");
    return;
  }
  const requestRunsForRun = (options: RunsRequestOptions) => requestRuntimeRunsAPI(runtimeDriver, options);
  const completeRunViaNonStreamingChat = createNonStreamingChatExecutor(requestRunsForRun);
  const runPreparation = createRuntimeRunPreparation(runtimeDriver);
  const runEvents = getRuntimeRunEventController(runtimeDriver);

  // Retrieve or initialize incremental tracker
  const tracker = runEvents.getOrCreate(run.id, run.partial_output);

  if (status === "queued") {
    if (!run.upstream_run_id) {
      // A. Load user message content to prepare context
      const userMsg = (await chatRepo.listMessages(run.conversation_id, 100)).find((msg: any) => msg.id === run.user_message_id);

      if (!userMsg) {
        logOperation("DISPATCH_FAILED_USER_MSG_MISSING", run.id, run.instance_id, 404, "USER_MESSAGE_MISSING");
        await completeRun(run.id, "failed", "", "USER_MESSAGE_MISSING");
        return;
      }

      // B. Increment dispatch attempts counter
      const nextAttempts = run.dispatch_attempts + 1;
      const success = await chatRepo.updateChatRun(run.id, {
        dispatch_attempts: nextAttempts,
        last_dispatch_at: new Date().toISOString()
      }, RECONCILER_ID);

      if (!success) {
        leaseLostRuns.add(run.id);
        clearEventsCache(run.id);
        return;
      }

      // C. Crash recovery check: search GET /v1/runs to see if it exists
      let recoveredUpstreamId: string | null = null;
      if (shouldSearchForDispatchedRun(nextAttempts)) {
        const queryRes = await requestRunsForRun({
          instanceId: run.instance_id,
          method: "GET",
          path: "/v1/runs",
          timeoutMs: 10000
        });
        if (queryRes.ok && queryRes.json) {
          recoveredUpstreamId = findRecoveredUpstreamId(queryRes.json, run.id);
        }
      }

      if (recoveredUpstreamId) {
        logOperation("DISPATCH_RECOVERED", run.id, run.instance_id, 200);
        const recordRes = await chatRepo.recordDispatchedChatRun({
          runId: run.id,
          reconcilerId: RECONCILER_ID,
          upstreamRunId: recoveredUpstreamId,
          startedAt: new Date().toISOString()
        });

        await handleDispatchRecordResult(run, recordRes, recoveredUpstreamId, leaseLostRuns, runtimeDriver);
        return;
      }

      // D. Build message context
      const history = await chatRepo.getLatestCompletedMessagesForContext(run.conversation_id);
      const filteredHistory = filterCurrentRunMessageFromHistory(history, userMsg?.id, userMsg?.request_id);
      const hermesMessages = filteredHistory.map(h => ({
        role: h.role,
        content: h.content
      }));
      hermesMessages.unshift({
        role: "system",
        content: MANAGED_OPERATION_SYSTEM_POLICY
      });
      const attachmentIds = Array.isArray(userMsg.metadata?.attachmentIds) ? userMsg.metadata.attachmentIds : [];
      let agentAttachmentContext = "";
      if (attachmentIds.length > 0) {
        try {
          const files = await loadAndValidateChatAttachments({
            attachmentIds,
            userId: run.user_id,
            instanceId: run.instance_id,
            conversationId: run.conversation_id,
            authority: dispatchAuthority,
          });
          agentAttachmentContext = buildAgentAttachmentContextForPrompt(files);
        } catch (attachmentErr: any) {
          logOperation("DISPATCH_FAILED_ATTACHMENT_INVALID", run.id, run.instance_id, attachmentErr?.status || 400, attachmentErr?.error || "INVALID_ATTACHMENT");
          await completeRun(run.id, "failed", "", attachmentErr?.error || "INVALID_ATTACHMENT");
          return;
        }
      }
      hermesMessages.push({
        role: "user",
        content: agentAttachmentContext ? `${userMsg.content}\n\n${agentAttachmentContext}` : userMsg.content
      });

      // E. Build dispatch body with the native Hermes session bound to this MyBay conversation.
      let sessionBinding: RuntimeSessionBinding;
      try {
        sessionBinding = await runPreparation.ensureSessionForConversation(run);
      } catch (sessionErr: any) {
        const errorCode = sessionErr?.message === "CONVERSATION_NOT_FOUND" ? "CONVERSATION_NOT_FOUND" : "HERMES_SESSION_CREATE_FAILED";
        logOperation("HERMES_SESSION_BIND_FAILED", run.id, run.instance_id, sessionErr?.statusCode || 500, errorCode);
        await completeRun(run.id, "failed", "", errorCode);
        return;
      }
      const runtimeSessionId = sessionBinding.sessionId;

      const payload = runPreparation.buildRunPayload({
        userContent: userMsg.content,
        currentUserMessageId: userMsg.id,
        currentRequestId: userMsg.request_id,
        agentAttachmentContext,
        sessionBinding,
        historyMessages: history,
        reasoningEffort: run.reasoning_effort,
      });

      emitRunLifecycleStep(
        run.id,
        "dispatch-preparing",
        "Connecting to Hermes Agent runtime",
        "running",
        "model_reasoning",
        RECONCILER_ID
      );
      addEventToCache(run.id, "status", JSON.stringify({ status: "queued" }));

      const dispatchInstance = await dbAdapter.getInstanceById(run.instance_id);
      const conversationDecision = resolveConversationDispatchMode(runtimeDriver.capabilities, {
        preferBatch: shouldPreferNonStreamingChatForInstance(dispatchInstance),
      });
      if (conversationDecision.supported === false) {
        await completeRun(run.id, "failed", "", conversationDecision.errorCode);
        return;
      }
      if (conversationDecision.mode === "batch") {
        await completeRunViaNonStreamingChat(run, hermesMessages, runtimeSessionId, "provider_compatibility", userMsg?.id, userMsg?.request_id);
        return;
      }

      // F. Pre-dispatch check: confirm run is still queued and lease is valid
      const freshRun = await chatRepo.getChatRun(run.id);
      if (!freshRun) {
        logOperation("DISPATCH_ABORTED_RUN_NOT_FOUND", run.id, run.instance_id, 404);
        return;
      }
      if (!hasValidRunLease(freshRun)) {
        logOperation("DISPATCH_ABORTED_LEASE_LOST", run.id, run.instance_id, 408);
        leaseLostRuns.add(run.id);
        clearEventsCache(run.id);
        return;
      }
      if (freshRun.status === "stopping") {
        logOperation("DISPATCH_ABORTED_STOPPING", run.id, run.instance_id, 200);
        if (!freshRun.upstream_run_id) {
          await completeRun(run.id, "cancelled", "", "CANCELLED_BY_USER");
        }
        return;
      }
      if (freshRun.status !== "queued") {
        logOperation("DISPATCH_ABORTED_NOT_QUEUED", run.id, run.instance_id, 400, "INVALID_STATE");
        return;
      }

      const startTime = Date.now();
      let dispatchRes = await submitRunWithIdempotentRecovery({
        submit: () => runtimeDriver.runs.request({
          instanceId: run.instance_id,
          method: "POST",
          path: "/v1/runs",
          body: payload,
          headers: { "Idempotency-Key": run.id },
          timeoutMs: 15000,
          sessionId: runtimeSessionId,
        }),
        recover: async () => {
          const lookup = await requestRunsForRun({
            instanceId: run.instance_id,
            method: "GET",
            path: "/v1/runs",
            timeoutMs: 10000,
          });
          if (!lookup.ok) return lookup;
          const recoveredId = findRecoveredUpstreamId(lookup.json, run.id);
          return { ...lookup, json: recoveredId ? { found: true, id: recoveredId } : { found: false } };
        },
        shouldContinue: async () => {
          const current = await chatRepo.getChatRun(run.id).catch(() => null);
          return Boolean(current && current.status === "queued" && hasValidRunLease(current));
        },
      });

      // Scheme B: Stale Hermes Session Recovery (guarded by MYBAY_RECOVER_STALE_HERMES_SESSION Feature Flag)
      const recoverStaleSessionEnabled = process.env.MYBAY_RECOVER_STALE_HERMES_SESSION === "true";
      if (!dispatchRes.ok && recoverStaleSessionEnabled && sessionBinding.state === "existing" && isStaleSessionError(dispatchRes.statusCode, dispatchRes.error)) {
        logOperation("HERMES_STALE_SESSION_DETECTED_REBINDING", run.id, run.instance_id, dispatchRes.statusCode);
        try {
          const convInfo = await chatRepo.getConversationForSessionBinding(run.conversation_id);
          const newBinding = await runPreparation.createSessionBinding(
            run.instance_id,
            run.conversation_id,
            convInfo?.title || "MyBay Agent Conversation",
            { bindImmediately: false }
          );

          const retryPayload = runPreparation.buildRunPayload({
            userContent: userMsg.content,
            currentUserMessageId: userMsg.id,
            currentRequestId: userMsg.request_id,
            agentAttachmentContext,
            sessionBinding: newBinding,
            historyMessages: filteredHistory,
            reasoningEffort: run.reasoning_effort,
          });

          dispatchRes = await runtimeDriver.runs.request({
            instanceId: run.instance_id,
            method: "POST",
            path: "/v1/runs",
            body: retryPayload,
            headers: {
              "Idempotency-Key": `${run.id}:session-rebind:1`
            },
            timeoutMs: 15000,
            sessionId: newBinding.sessionId
          });
          if (dispatchRes.ok) {
            await chatRepo.bindConversationSessionId(run.conversation_id, newBinding.sessionId);
          } else {
            logOperation("HERMES_SESSION_REBIND_DISPATCH_FAILED", run.id, run.instance_id, dispatchRes.statusCode, normalizeDispatchError(dispatchRes.statusCode, dispatchRes.error));
          }
        } catch (rebindErr: any) {
          const errorCode = sanitizeErrorCode(rebindErr?.message || "HERMES_SESSION_REBIND_FAILED");
          logOperation("HERMES_SESSION_REBIND_FAILED", run.id, run.instance_id, rebindErr?.statusCode || 500, errorCode);
          await completeRun(run.id, "failed", "", errorCode);
          return;
        }
      }

      const durationMs = Date.now() - startTime;

      const dispatchedUpstreamId = dispatchRes.json?.run_id || dispatchRes.json?.id;
      if (dispatchRes.ok && dispatchRes.json && dispatchedUpstreamId) {
        const upstreamId = String(dispatchedUpstreamId);

        // Strict upstream ID validation
        if (!isValidUpstreamRunId(upstreamId)) {
          logOperation("DISPATCH_FAILED_INVALID_UPSTREAM_ID", run.id, run.instance_id, 400, "INVALID_UPSTREAM_RUN_ID", durationMs);
          const fresh = await chatRepo.getChatRun(run.id);
          if (hasValidRunLease(fresh)) {
            await completeRun(run.id, "failed", "", "INVALID_UPSTREAM_RUN_ID");
          }
          return;
        }

        logOperation("DISPATCH_SUCCESS", run.id, run.instance_id, dispatchRes.statusCode, undefined, durationMs);
        emitRunLifecycleStep(
          run.id,
          "dispatch-preparing",
          "Connected to Hermes Agent runtime",
          "completed",
          "model_reasoning",
          RECONCILER_ID,
          { upstreamRunId: upstreamId }
        );
        emitRunLifecycleStep(
          run.id,
          "agent-running",
          "Agent is processing the request",
          "running",
          "model_reasoning",
          RECONCILER_ID
        );
        const recordRes = await chatRepo.recordDispatchedChatRun({
          runId: run.id,
          reconcilerId: RECONCILER_ID,
          upstreamRunId: upstreamId,
          startedAt: new Date().toISOString()
        });

        const dispatchActive = await handleDispatchRecordResult(run, recordRes, upstreamId, leaseLostRuns, runtimeDriver);
        if (dispatchActive && canRecoverApprovalInteractions(runtimeDriver.capabilities)) {
          publishPendingRuntimeInteractions(run, dispatchRes.json, "immediate_post_dispatch", {
            getTracker: (runId, initialPartialOutput) => runEvents.getOrCreate(runId, initialPartialOutput),
            consume: (target, event) => runEvents.handle(target, event, upstreamId),
            log: (entry) => console.log(JSON.stringify(entry)),
          });
        }
      } else {
        const dispatchErrorCode = normalizeDispatchError(dispatchRes.statusCode, dispatchRes.error);
        logOperation(
          "DISPATCH_ATTEMPT_FAILED",
          run.id,
          run.instance_id,
          dispatchRes.statusCode,
          dispatchErrorCode,
          durationMs
        );

        if (shouldFallbackSessionCreate(dispatchRes.statusCode, dispatchRes.error)) {
          logOperation("DISPATCH_FALLBACK_NON_STREAMING", run.id, run.instance_id, dispatchRes.statusCode, "PROVIDER_COMPATIBILITY");
          const history = await chatRepo.getLatestCompletedMessagesForContext(run.conversation_id);
          const filteredHistory = filterCurrentRunMessageFromHistory(history, userMsg?.id, userMsg?.request_id);
          const hermesMessages = filteredHistory.map(h => ({ role: h.role, content: h.content }));
          hermesMessages.push({
            role: "user",
            content: agentAttachmentContext ? `${userMsg.content}\n\n${agentAttachmentContext}` : userMsg.content
          });
          await completeRunViaNonStreamingChat(run, hermesMessages, runtimeSessionId, "provider_compatibility", userMsg?.id, userMsg?.request_id);
          return;
        }

        if (hasReachedDispatchAttemptLimit(nextAttempts)) {
          logOperation("DISPATCH_FAILED_MAX_ATTEMPTS", run.id, run.instance_id, dispatchRes.statusCode, dispatchErrorCode, durationMs);
          await completeRun(run.id, "failed", "", dispatchErrorCode);
        }
      }
    } else {
      // Already has upstream run ID, transition straight to running using atomic recordDispatchedChatRun
      const recordRes = await chatRepo.recordDispatchedChatRun({
        runId: run.id,
        reconcilerId: RECONCILER_ID,
        upstreamRunId: run.upstream_run_id,
        startedAt: new Date().toISOString()
      });

      await handleDispatchRecordResult(run, recordRes, run.upstream_run_id, leaseLostRuns, runtimeDriver);
    }
  } else if (status === "running") {
    if (!run.upstream_run_id) {
      logOperation("INCONSISTENT_STATE_RUNNING_NO_UPSTREAM", run.id, run.instance_id, 400, "INCONSISTENT_STATE");
      const success = await chatRepo.updateChatRun(run.id, { status: "queued" }, RECONCILER_ID);
      if (!success) {
        leaseLostRuns.add(run.id);
        clearEventsCache(run.id);
      }
      return;
    }

    ensureUpstreamRunEventStream(run, run.upstream_run_id, runtimeDriver);

    const terminalObservation = resolveTerminalObservationCapability(runtimeDriver.capabilities);
    if (terminalObservation.supported === false) {
      await completeRun(run.id, "failed", "", terminalObservation.errorCode);
      return;
    }

    const maxRuntimeMs = getMaxRuntimeMs();
    if (hasRunExceededRuntime(run.created_at, maxRuntimeMs, Date.now())) {
      logOperation("TIMEOUT_EXCEEDED", run.id, run.instance_id, 408, "RUNTIME_TIMEOUT_EXCEEDED");
      await requestRunsForRun({
        instanceId: run.instance_id,
        method: "POST",
        path: `/v1/runs/${run.upstream_run_id}/stop`,
        timeoutMs: 10000
      }).catch(() => {});

      await completeRun(run.id, "expired", "", "RUNTIME_TIMEOUT_EXCEEDED");
      return;
    }

    const startTime = Date.now();
    const statusRes = await requestRunsForRun({
      instanceId: run.instance_id,
      method: "GET",
      path: `/v1/runs/${run.upstream_run_id}`,
      timeoutMs: 10000
    });
    const durationMs = Date.now() - startTime;

    if (statusRes.ok && statusRes.json) {
      const terminalProbe = resolveTerminalProbeOutcome(statusRes.json, durationMs);
      const nowStr = new Date().toISOString();

      const success = await chatRepo.updateChatRun(run.id, {
        heartbeat_at: nowStr,
        last_observed_at: nowStr
      }, RECONCILER_ID);

      if (!success) {
        leaseLostRuns.add(run.id);
        clearEventsCache(run.id);
        return;
      }

      if (canRecoverApprovalInteractions(runtimeDriver.capabilities)) {
        publishPendingRuntimeInteractions(run, statusRes.json, "status_probe", {
          getTracker: (runId, initialPartialOutput) => runEvents.getOrCreate(runId, initialPartialOutput),
          consume: (target, event) => runEvents.handle(target, event, run.upstream_run_id),
          log: (entry) => console.log(JSON.stringify(entry)),
        });
      }

      if (terminalProbe?.status === "completed") {
        const finalContent = terminalProbe.assistantContent;
        const usage = terminalProbe.usage;
        const runDuration = terminalProbe.durationMs;

        logOperation("RUN_COMPLETED", run.id, run.instance_id, 200, undefined, runDuration);
        await convergeRunTerminalProbe(run, terminalProbe, "status_probe", {
          completeRun,
          log: (entry) => console.log(JSON.stringify(entry)),
        });
      } else if (terminalProbe?.status === "failed") {
        const upstreamError = terminalProbe.error;
        const hasNoPartialOutputForCompatFallback = !run.partial_output && !statusRes.json.partial_output;
        if (hasNoPartialOutputForCompatFallback && isStreamingDecoderCompatError(upstreamError)) {
          const userMsg = (await chatRepo.listMessages(run.conversation_id, 100)).find((msg: any) => msg.id === run.user_message_id);
          if (userMsg) {
            const history = await chatRepo.getLatestCompletedMessagesForContext(run.conversation_id);
            const filteredHistory = filterCurrentRunMessageFromHistory(history, userMsg?.id, (userMsg as any)?.request_id);
            const hermesMessages = filteredHistory.map(h => ({
              role: h.role,
              content: h.content
            }));
            const attachmentIds = Array.isArray((userMsg as any).metadata?.attachmentIds) ? (userMsg as any).metadata.attachmentIds : [];
            let agentAttachmentContext = "";
            if (attachmentIds.length > 0) {
              try {
                const files = await loadAndValidateChatAttachments({
                  attachmentIds,
                  userId: run.user_id,
                  instanceId: run.instance_id,
                  conversationId: run.conversation_id,
                  authority: dispatchAuthority,
                });
                agentAttachmentContext = buildAgentAttachmentContextForPrompt(files);
              } catch (attachmentErr: any) {
                await completeRun(run.id, "failed", "", attachmentErr?.error || "INVALID_ATTACHMENT");
                return;
              }
            }
            hermesMessages.push({
              role: "user",
              content: agentAttachmentContext ? `${userMsg.content}\n\n${agentAttachmentContext}` : userMsg.content
            });
            const runtimeSessionBinding = await runPreparation.ensureSessionForConversation(run);
            await completeRunViaNonStreamingChat(run, hermesMessages, runtimeSessionBinding.sessionId, "streaming_decoder_fallback", userMsg?.id, userMsg?.request_id);
            return;
          }
        }

        logOperation("RUN_FAILED_UPSTREAM", run.id, run.instance_id, 200, "UPSTREAM_FAILED", durationMs);
        await convergeRunTerminalProbe(run, terminalProbe, "status_probe", {
          completeRun,
          log: (entry) => console.log(JSON.stringify(entry)),
        });
      } else if (terminalProbe?.status === "cancelled") {
        logOperation("RUN_CANCELLED_UPSTREAM", run.id, run.instance_id, 200, "UPSTREAM_CANCELLED", durationMs);
        await convergeRunTerminalProbe(run, terminalProbe, "status_probe", {
          completeRun,
          log: (entry) => console.log(JSON.stringify(entry)),
        });
      } else {
        // Stream / parse partial outputs incrementally
        const partialOutput = resolvePartialOutput(tracker.lastPartialOutput, statusRes.json.partial_output);
        const newOutput = partialOutput.newOutput;
        if (partialOutput.changed) {
          tracker.lastPartialOutput = newOutput;
          if (partialOutput.delta) {
            addEventToCache(run.id, "text", partialOutput.delta);
          }
        }

        // Parse tool steps
        const steps = statusRes.json.steps || statusRes.json.tool_steps || [];
        if (Array.isArray(steps)) {
          for (const step of steps) {
            runEvents.emitStep(run.id, tracker, step, RECONCILER_ID);
          }
        }
        // Save progress to database
        const success = await chatRepo.updateChatRun(run.id, {
          partial_output: newOutput
        }, RECONCILER_ID);

        if (!success) {
          leaseLostRuns.add(run.id);
          clearEventsCache(run.id);
          return;
        }
      }
    } else {
      logOperation("PROBE_FAILED", run.id, run.instance_id, statusRes.statusCode, "STATUS_PROBE_FAILED", durationMs);

      const lastActiveTs = runEventCacheController.getLastActivity(run.id) || new Date(run.heartbeat_at || run.last_observed_at || run.started_at || run.created_at).getTime();
      const probeFailure = resolveProbeFailure(statusRes.statusCode, lastActiveTs, Date.now());
      if (probeFailure === "upstream_not_found") {
        logOperation("UPSTREAM_RUN_NOT_FOUND", run.id, run.instance_id, 404, "UPSTREAM_RUN_NOT_FOUND");
        await completeRun(run.id, "failed", "", "UPSTREAM_RUN_NOT_FOUND");
        return;
      }
      if (probeFailure === "zombie_timeout") {
        logOperation("ZOMBIE_RUN_TIMEOUT_CLEANUP", run.id, run.instance_id, 408, "ZOMBIE_RUN_TIMEOUT");
        await completeRun(run.id, "failed", "", "ZOMBIE_RUN_TIMEOUT");
        return;
      }
    }
  } else if (status === "stopping") {
    await recoverStoppingRun(run, {
      ownerId: RECONCILER_ID,
      requestRuns: requestRunsForRun,
      recordDispatched: (params) => chatRepo.recordDispatchedChatRun(params),
      updateRun: (runId, updates, ownerId) => chatRepo.updateChatRun(runId, updates, ownerId),
      completeRun,
      markLeaseLost: (runId) => leaseLostRuns.add(runId),
      hasLeaseBeenLost: (runId) => leaseLostRuns.has(runId),
      clearEvents: clearEventsCache,
      capabilities: runtimeDriver.capabilities,
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  }
}











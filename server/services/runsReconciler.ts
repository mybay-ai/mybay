import { chatRepo } from "../repositories/chatRepo";
import { emitChatConversationUpdated } from "./chatRealtime";
import { dbAdapter } from "../db";
import { decrypt } from "../crypto";
import { requestTraefikInternal } from "../utils/traefikInternalRequest";
import * as crypto from "crypto";
import { EventEmitter } from "events";
import { streamTraefikInternalSse } from "../utils/traefikInternalSse";
import { resolveInstanceInternalApiKey } from "../utils/instanceInternalApiKey";
import { containsDsmlToolCallProtocol, DSML_TOOL_CALL_ERROR_CODE } from "../utils/dsmlToolCallGuard";
import { buildAgentAttachmentContextForPrompt, loadAndValidateChatAttachments } from "../utils/chatAttachments";
import { MANAGED_OPERATION_SYSTEM_POLICY } from "../utils/managedOperationGuard";
import { normalizeUsage } from "./usageNormalizer";

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
  if (!run || typeof reconcilerId !== "string" || reconcilerId.trim() === "") {
    return false;
  }
  if (run.reconciled_by !== reconcilerId) {
    return false;
  }

  const expiresAtMs = new Date(run.lease_expires_at).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

// Memory event cache for SSE streaming
export interface CachedSSEEvent {
  id: number;
  event: string;
  data: string;
}

interface RunTracker {
  lastPartialOutput: string;
  sentSteps: Map<string, string>; // Maps stepId -> stepStatus:safeSummary to only emit on change
  activeToolIds: Map<string, string[]>;
}

type AgentReasoningEffort = "fast" | "balanced" | "deep";
type HermesReasoningEffort = "low" | "medium" | "high";

export function toHermesReasoningModelOptions(value: unknown) {
  const normalized: AgentReasoningEffort = value === "fast" || value === "deep" ? value : "balanced";
  const effort: HermesReasoningEffort = normalized === "fast" ? "low" : normalized === "deep" ? "high" : "medium";
  return {
    reasoning: { enabled: true, effort },
    reasoning_effort: effort
  };
}

// Memory caches
const runEventsCache = new Map<string, CachedSSEEvent[]>();
const runSeqTracker = new Map<string, number>();
const runTrackingMap = new Map<string, RunTracker>();
const runLastActiveMap = new Map<string, number>();
const terminalExpiresAtMap = new Map<string, number>();
const activeUpstreamEventStreams = new Map<string, AbortController>();
const upstreamEventBuffers = new Map<string, string>();

// Track the total size of cached items to maintain the 50MB global capacity limit
let globalCacheBytes = 0;
const GLOBAL_MAX_BYTES = 50 * 1024 * 1024; // 50MB

function getMaxRuntimeMs(): number {
  const envVal = parseInt(process.env.MYBAY_ASYNC_CHAT_MAX_RUNTIME_SECONDS || "1800", 10);
  const val = Math.max(60, Math.min(7200, isNaN(envVal) ? 1800 : envVal));
  return val * 1000;
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
  runLastActiveMap.set(runId, Date.now());
}

export function initRunSequence(runId: string, startSeq: number) {
  if (!runSeqTracker.has(runId)) {
    runSeqTracker.set(runId, startSeq);
  }
}

export function setTerminalRunExpiry(runId: string) {
  // Retain terminal event cache for 10 minutes (600,000 ms)
  terminalExpiresAtMap.set(runId, Date.now() + 10 * 60 * 1000);
}

export function addEventToCache(
  runId: string,
  event: string,
  data: string,
  reconcilerId?: string
): { added: boolean; event?: CachedSSEEvent } {
  touchRunActivity(runId);
  
  // Enforce single event size limit (32KB). If exceeded, save a safe fixed summary.
  const initialDataSize = Buffer.byteLength(data);
  if (initialDataSize > 32 * 1024) {
    data = JSON.stringify({
      truncated: true,
      message: "Event payload exceeded the allowed size.",
      summary: "Event payload exceeded the allowed size."
    });
  }

  // Determine strictly increasing sequence number
  let currentSeq = runSeqTracker.get(runId) || 0;
  currentSeq++;

  const newEvt: CachedSSEEvent = {
    id: currentSeq,
    event,
    data
  };

  const evtBytes = Buffer.byteLength(JSON.stringify(newEvt));

  // If the single event itself exceeds the global capacity, reject it
  if (evtBytes > GLOBAL_MAX_BYTES) {
    console.warn(`[RunsReconciler] Event for run ${runId} exceeds global maximum byte size.`);
    return { added: false };
  }

  let list = runEventsCache.get(runId);
  if (!list) {
    list = [];
    runEventsCache.set(runId, list);
  }

  // Evict the oldest OTHER runs' caches based on actual LRU when global cache is full
  while (globalCacheBytes + evtBytes > GLOBAL_MAX_BYTES) {
    let oldestOtherRunId: string | null = null;
    let oldestTime = Infinity;
    
    for (const [rId, lastActive] of runLastActiveMap.entries()) {
      if (rId !== runId && lastActive < oldestTime) {
        oldestTime = lastActive;
        oldestOtherRunId = rId;
      }
    }
    
    if (oldestOtherRunId) {
      clearEventsCache(oldestOtherRunId);
    } else {
      break;
    }
  }

  // If still full, evict oldest events of the current run
  while (globalCacheBytes + evtBytes > GLOBAL_MAX_BYTES && list.length > 0) {
    const shifted = list.shift();
    if (shifted) {
      const shiftedBytes = Buffer.byteLength(JSON.stringify(shifted));
      globalCacheBytes -= shiftedBytes;
    } else {
      break;
    }
  }
  globalCacheBytes = Math.max(0, globalCacheBytes);

  // If we still cannot fit it, return false
  if (globalCacheBytes + evtBytes > GLOBAL_MAX_BYTES) {
    console.warn(`[RunsReconciler] Unable to fit event for run ${runId} in cache even after clearing other runs.`);
    return { added: false };
  }

  // Successfully added to current run
  list.push(newEvt);
  globalCacheBytes += evtBytes;

  // Enforce single Run event count limit (200 events) and byte size limit (2MB)
  const PER_RUN_MAX_BYTES = 2 * 1024 * 1024;
  let runBytes = list.reduce((sum, evt) => sum + Buffer.byteLength(JSON.stringify(evt)), 0);
  
  while ((list.length > 200 || runBytes > PER_RUN_MAX_BYTES) && list.length > 0) {
    const shifted = list.shift();
    if (shifted) {
      const shiftedBytes = Buffer.byteLength(JSON.stringify(shifted));
      globalCacheBytes -= shiftedBytes;
      runBytes -= shiftedBytes;
    } else {
      break;
    }
  }
  globalCacheBytes = Math.max(0, globalCacheBytes);

  // Commit sequence number only on successful add
  runSeqTracker.set(runId, currentSeq);

  // Sync to database
  chatRepo.updateChatRun(runId, { last_event_seq: currentSeq }, reconcilerId).catch(() => {});

  // Emit event to active SSE stream connections
  runsEventsEmitter.emit(`event:${runId}`, newEvt);

  return { added: true, event: newEvt };
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
  touchRunActivity(runId);
  const list = runEventsCache.get(runId) || [];
  if (list.length === 0) {
    return { events: [] };
  }

  // Check if lastEventId is below our cached horizon
  if (lastEventId > 0) {
    const oldestSeq = list[0].id;
    if (oldestSeq > lastEventId + 1) {
      return { events: [], recoveryOutOfBounds: true };
    }
  }

  return { events: list.filter(e => e.id > lastEventId) };
}

export function clearEventsCache(runId: string) {
  activeUpstreamEventStreams.get(runId)?.abort();
  activeUpstreamEventStreams.delete(runId);
  upstreamEventBuffers.delete(runId);
  const list = runEventsCache.get(runId);
  if (list) {
    for (const evt of list) {
      globalCacheBytes -= Buffer.byteLength(JSON.stringify(evt));
    }
    globalCacheBytes = Math.max(0, globalCacheBytes);
    runEventsCache.delete(runId);
  }
  runSeqTracker.delete(runId);
  runTrackingMap.delete(runId);
  runLastActiveMap.delete(runId);
  terminalExpiresAtMap.delete(runId);
}

async function streamRunsEventsAPI(
  instanceId: string,
  upstreamRunId: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(upstreamRunId)) return;
  const instance = await dbAdapter.getInstanceById(instanceId);
  if (!instance) return;

  const keyResolution = resolveInstanceInternalApiKey(instance);
  if (!keyResolution.ok || !keyResolution.apiKey) return;
  const apiKey = keyResolution.apiKey;
  await streamTraefikInternalSse({
    instanceId,
    path: `/v1/runs/${upstreamRunId}/events`,
    apiKey,
    signal,
    onChunk
  });
}

function emitSafeRunStep(runId: string, tracker: RunTracker, step: any) {
  const sanitized = sanitizeStep(step);
  const cacheKey = `${sanitized.status}:${sanitized.safe_summary}`;
  if (tracker.sentSteps.get(sanitized.id) === cacheKey) return;
  tracker.sentSteps.set(sanitized.id, cacheKey);
  addEventToCache(runId, "step", JSON.stringify(sanitized));
}

function truncateSafeText(value: any, maxLength = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function normalizeApprovalChoices(choices: any): string[] {
  const allowed = new Set(["once", "session", "always", "deny"]);
  const incoming = Array.isArray(choices) ? choices : [];
  const normalized = incoming
    .map((choice: any) => String(choice?.id || choice?.value || choice || "").toLowerCase().trim())
    .filter((choice: string) => allowed.has(choice));
  return Array.from(new Set(normalized.length > 0 ? normalized : ["once", "deny"]));
}

function sanitizeApprovalEvent(event: any, status: "pending" | "resolved") {
  const rawId = String(event.approval_id || event.approvalId || event.id || event.request_id || "");
  const id = /^[A-Za-z0-9_.:-]{1,160}$/.test(rawId) ? rawId : `approval-${crypto.randomUUID()}`;
  return {
    id,
    status,
    title: truncateSafeText(event.title || event.name || event.action, 120),
    description: truncateSafeText(event.description || event.message || event.reason, 500),
    command: truncateSafeText(event.command, 700),
    choices: normalizeApprovalChoices(event.choices),
    choice: truncateSafeText(event.choice, 40),
    smartDenied: event.smart_denied === true || event.smartDenied === true,
    allowPermanent: event.allow_permanent === true || event.allowPermanent === true,
    timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now() / 1000
  };
}

export async function completeRunFromHermesEvent(run: any, event: any, upstreamRunId: string): Promise<boolean> {
  if (!run || !event || !/^[A-Za-z0-9_.-]{1,128}$/.test(upstreamRunId || "")) return false;
  const eventType = String(event.event || event.type || "");
  const tracker = runTrackingMap.get(run.id);
  const durationMs = Number.isFinite(Number(event.duration_ms)) ? Number(event.duration_ms) : null;

  if (["run.completed", "run.complete"].includes(eventType)) {
    const finalContent = typeof event.output === "string"
      ? event.output
      : typeof event.output?.message?.content === "string"
        ? event.output.message.content
        : tracker?.lastPartialOutput || "";
    return completeRun(run.id, "completed", finalContent, undefined, event.usage, durationMs, { expectedUpstreamRunId: upstreamRunId });
  }

  if (["run.failed", "run.error"].includes(eventType)) {
    const upstreamError = event.error || event.message || event.error_code || "RUN_FAILED_UPSTREAM";
    if (!tracker?.lastPartialOutput && isStreamingDecoderCompatError(upstreamError)) {
      requestRunsReconcile();
      return false;
    }
    return completeRun(run.id, "failed", "", String(upstreamError), event.usage, durationMs, { expectedUpstreamRunId: upstreamRunId });
  }

  if (["run.cancelled", "run.canceled"].includes(eventType)) {
    return completeRun(run.id, "cancelled", "", "CANCELLED_UPSTREAM", event.usage, durationMs, { expectedUpstreamRunId: upstreamRunId });
  }
  return false;
}

export function handleHermesRunEvent(run: any, event: any, upstreamRunId = String(event?.run_id || "")) {
  if (!event || typeof event !== "object") return;
  let tracker = runTrackingMap.get(run.id);
  if (!tracker) {
    tracker = { lastPartialOutput: run.partial_output || "", sentSteps: new Map(), activeToolIds: new Map() };
    runTrackingMap.set(run.id, tracker);
  }
  const eventType = String(event.event || event.type || "");

  if (eventType === "message.delta" && typeof event.delta === "string" && event.delta) {
    const nextOutput = tracker.lastPartialOutput + event.delta;
    if (containsDsmlToolCallProtocol(nextOutput)) {
      addEventToCache(run.id, "status", JSON.stringify({ status: "failed", errorCode: DSML_TOOL_CALL_ERROR_CODE }));
      return;
    }
    tracker.lastPartialOutput = nextOutput;
    addEventToCache(run.id, "text", event.delta);
    return;
  }

  if (["run.created", "run.queued"].includes(eventType)) {
    emitSafeRunStep(run.id, tracker, {
      id: `${run.id}-task_received`,
      stepType: "model_reasoning",
      status: "completed",
      title: "Task received",
      timestamp: event.timestamp
    });
    return;
  }

  if (["run.started", "run.in_progress", "run.running"].includes(eventType)) {
    emitSafeRunStep(run.id, tracker, {
      id: `${run.id}-model-reasoning`,
      stepType: "model_reasoning",
      status: "running",
      title: "Analyzing task context",
      timestamp: event.timestamp
    });
    return;
  }

  if (["run.completed", "run.complete"].includes(eventType)) {
    void completeRunFromHermesEvent(run, event, upstreamRunId).catch((error) => {
      console.warn(`[RunsReconciler] Immediate completion failed for run ${run.id}:`, error?.message || "unknown");
      requestRunsReconcile();
    });
    return;
  }

  if (["run.failed", "run.error", "run.cancelled", "run.canceled"].includes(eventType)) {
    void completeRunFromHermesEvent(run, event, upstreamRunId).catch((error) => {
      console.warn(`[RunsReconciler] Immediate terminal handling failed for run ${run.id}:`, error?.message || "unknown");
      requestRunsReconcile();
    });
    return;
  }

  if (eventType === "tool.started" || eventType === "tool.start") {
    const tool = String(event.tool || event.name || event.tool_name || "other");
    const id = `step-${crypto.randomUUID()}`;
    const queue = tracker.activeToolIds.get(tool) || [];
    queue.push(id);
    tracker.activeToolIds.set(tool, queue);
    emitSafeRunStep(run.id, tracker, {
      id,
      name: tool,
      tool,
      status: "running",
      title: event.title,
      startedAt: event.started_at || event.timestamp,
      query: event.query,
      count: event.count,
      source: event.source || event.provider
    });
    return;
  }

  if (eventType === "tool.completed" || eventType === "tool.complete") {
    const tool = String(event.tool || event.name || event.tool_name || "other");
    const queue = tracker.activeToolIds.get(tool) || [];
    const id = queue.shift() || `step-${crypto.randomUUID()}`;
    tracker.activeToolIds.set(tool, queue);
    emitSafeRunStep(run.id, tracker, {
      id,
      name: tool,
      tool,
      status: event.error === true ? "failed" : "completed",
      title: event.title,
      completedAt: event.completed_at || event.timestamp,
      count: event.count || event.result_count || event.results_count,
      source: event.source || event.provider
    });
    return;
  }

  if (eventType === "step" || eventType === "step.started" || eventType === "step.completed" || eventType === "step.failed") {
    emitSafeRunStep(run.id, tracker, {
      ...event,
      status: event.status || (eventType === "step.completed" ? "completed" : eventType === "step.failed" ? "failed" : "running")
    });
    return;
  }

  if (eventType === "approval.request") {
    addEventToCache(run.id, "approval", JSON.stringify(sanitizeApprovalEvent(event, "pending")));
    addEventToCache(run.id, "status", JSON.stringify({ status: "waiting_for_approval" }));
    return;
  }

  if (eventType === "approval.responded" || eventType === "approval.response") {
    addEventToCache(run.id, "approval", JSON.stringify(sanitizeApprovalEvent(event, "resolved")));
    addEventToCache(run.id, "status", JSON.stringify({ status: "running" }));
  }
}

function consumeHermesSseChunk(run: any, upstreamRunId: string, chunk: string) {
  let buffer = (upstreamEventBuffers.get(run.id) || "") + chunk;
  if (buffer.length > 1024 * 1024) buffer = buffer.slice(-1024 * 1024);
  const frames = buffer.split(/\r?\n\r?\n/);
  upstreamEventBuffers.set(run.id, frames.pop() || "");
  for (const frame of frames) {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try { handleHermesRunEvent(run, JSON.parse(data), upstreamRunId); } catch {}
  }
}

function ensureUpstreamRunEventStream(run: any, upstreamRunId: string) {
  if (activeUpstreamEventStreams.has(run.id)) return;
  const controller = new AbortController();
  activeUpstreamEventStreams.set(run.id, controller);
  void streamRunsEventsAPI(run.instance_id, upstreamRunId, controller.signal, (chunk) => {
    consumeHermesSseChunk(run, upstreamRunId, chunk);
  }).catch(() => {}).finally(() => {
    if (activeUpstreamEventStreams.get(run.id) === controller) activeUpstreamEventStreams.delete(run.id);
  });
}

// Inactive cache cleanup is owned by the reconciler lifecycle.
let cacheCleanupTimer: NodeJS.Timeout | null = null;
function cleanupInactiveRunCaches() {
  const now = Date.now();
  for (const [runId, lastActive] of runLastActiveMap.entries()) {
    const expiresAt = terminalExpiresAtMap.get(runId);
    if (expiresAt ? now > expiresAt : now - lastActive > 15 * 60 * 1000) clearEventsCache(runId);
  }
}

interface RunsRequestOptions {
  instanceId: string;
  method: string;
  path: string;
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  hermesSessionId?: string;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function sanitizeIdempotencyKey(value: unknown): string | undefined {
  const key = normalizeHeaderValue(value);
  if (!key) return undefined;
  if (key.length > 256) return undefined;
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) return undefined;
  return key;
}

function sanitizeRunsRequestHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  const safeHeaders: Record<string, string> = {};
  const idempotencyKey = sanitizeIdempotencyKey(headers?.["Idempotency-Key"] || headers?.["idempotency-key"]);
  if (idempotencyKey) safeHeaders["Idempotency-Key"] = idempotencyKey;
  return Object.keys(safeHeaders).length > 0 ? safeHeaders : undefined;
}

interface RunsRequestResult {
  ok: boolean;
  statusCode: number;
  json?: any;
  error?: string;
}

export async function requestRunsAPI(options: RunsRequestOptions): Promise<RunsRequestResult> {
  const { instanceId, method, path, body, timeoutMs = 15000, headers: extraHeaders, hermesSessionId } = options;

  try {
    const instance = await dbAdapter.getInstanceById(instanceId);
    if (!instance) {
      return { ok: false, statusCode: 404, error: "INSTANCE_NOT_FOUND" };
    }
    {
      const keyResolution = resolveInstanceInternalApiKey(instance);
      if (!keyResolution.ok || !keyResolution.apiKey) {
        return { ok: false, statusCode: 400, error: keyResolution.error || "HERMES_INTERNAL_API_KEY_MISSING" };
      }
      const apiKey = keyResolution.apiKey;

      const response = await requestTraefikInternal({
        instanceId,
        method,
        path,
        apiKey,
        body,
        timeoutMs,
        headers: sanitizeRunsRequestHeaders(extraHeaders),
        hermesSessionId
      });

      return {
        ok: response.ok,
        statusCode: response.statusCode,
        json: response.json,
        error: response.ok ? undefined : (response.error || response.rawBody)
      };
    }
  } catch (globalErr: any) {
    return {
      ok: false,
      statusCode: 500,
      error: globalErr.message || "INTERNAL_RECONCILER_REQUEST_ERROR"
    };
  }
}


function parseInstanceConfigJson(instance: any): any {
  const raw = instance?.config_json;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function getInstanceModelFingerprint(instance: any): string {
  const config = parseInstanceConfigJson(instance);
  return [
    instance?.model_provider,
    instance?.model_name,
    instance?.model_base_url,
    instance?.provider,
    instance?.model,
    instance?.current_provider,
    instance?.current_model,
    instance?.base_url,
    instance?.BASE_URL,
    config.provider,
    config.model_provider,
    config.modelProvider,
    config.current_provider,
    config.currentProvider,
    config.model,
    config.model_name,
    config.modelName,
    config.current_model,
    config.currentModel,
    config.MODEL,
    config.base_url,
    config.baseUrl,
    config.BASE_URL
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function shouldPreferNonStreamingChatForInstance(instance: any): boolean {
  // Agent mode must prefer Hermes Runs so tool calls are executed by Hermes instead of
  // being surfaced as raw model protocol text. Keep the legacy chat-completions
  // fallback opt-in only for emergency provider incidents.
  if (process.env.MYBAY_FORCE_AGENT_CHAT_COMPLETIONS_FALLBACK !== "true") {
    return false;
  }

  const fingerprint = getInstanceModelFingerprint(instance);
  return (
    fingerprint.includes("moonshot") ||
    fingerprint.includes("kimi") ||
    fingerprint.includes("api.moonshot.cn")
  );
}

function isStreamingDecoderCompatError(rawError: unknown): boolean {
  const code = extractUpstreamErrorCode(rawError);
  if ([
    "STREAMING_DECODER_ERROR",
    "STREAM_DECODER_ERROR",
    "BROTLI_DECODER_ERROR",
    "CONTENT_DECODING_ERROR",
    "ERR_CONTENT_DECODING_FAILED",
    "CAN_ACCEPT_MORE_DATA"
  ].includes(code)) {
    return true;
  }

  const text = JSON.stringify(rawError || "").toLowerCase();
  return (
    text.includes("brotli") && text.includes("can_accept_more_data") ||
    text.includes("streaming failed before delivery") ||
    text.includes("content decoding failed")
  );
}

function extractAssistantContentFromChatResponse(json: any): string {
  const choice = Array.isArray(json?.choices) ? json.choices[0] : undefined;
  const content = choice?.message?.content ?? choice?.delta?.content ?? json?.message ?? json?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function buildHermesChatMessages(messages: Array<{ role: string; content: string }>) {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content
  }));
}
function extractHermesSessionId(json: any): string | null {
  const candidates = [
    json?.session_id,
    json?.sessionId,
    json?.id,
    json?.session?.id,
    json?.data?.session_id,
    json?.data?.id
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildFallbackHermesSessionId(conversationId: string): string {
  const normalizedConversationId = String(conversationId || "").replace(/[^A-Za-z0-9]/g, "");
  return `mybay_${normalizedConversationId.slice(0, 80)}`;
}

function isLegacyGeneratedSessionId(sessionId: string | null | undefined, conversationId: string): boolean {
  if (!sessionId) return true;
  const normalizedConversationId = String(conversationId || "").replace(/[^A-Za-z0-9]/g, "");
  return sessionId === `conv_${normalizedConversationId}` || /^conv_[A-Za-z0-9]{24,64}$/.test(sessionId);
}

export function isFallbackHermesSessionId(sessionId: string | null | undefined, conversationId: string): boolean {
  if (!sessionId || !conversationId) return false;
  const expectedFallbackId = buildFallbackHermesSessionId(conversationId);
  return sessionId === expectedFallbackId;
}

function parsePotentialJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function extractUpstreamErrorCode(rawError: unknown): string {
  const visited = new Set<unknown>();
  const directKeys = ["errorCode", "error_code", "code"];

  const visit = (value: unknown, depth: number): string => {
    if (value === null || value === undefined || depth > 8) return "";

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        const parsed = parsePotentialJsonString(trimmed);
        if (parsed !== value) {
          const parsedCode = visit(parsed, depth + 1);
          if (parsedCode) return parsedCode;
        }
      }
      return trimmed.toUpperCase();
    }

    if (typeof value !== "object") return String(value).trim().toUpperCase();
    if (visited.has(value)) return "";
    visited.add(value);

    const obj = value as Record<string, unknown>;
    for (const key of directKeys) {
      const candidate = obj[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim().toUpperCase();
    }

    for (const key of ["error", "detail"]) {
      const nestedCode = visit(obj[key], depth + 1);
      if (nestedCode) return nestedCode;
    }

    const message = obj.message;
    if (typeof message === "string" && message.trim()) return message.trim().toUpperCase();

    for (const nested of Object.values(obj)) {
      const nestedCode = visit(nested, depth + 1);
      if (nestedCode) return nestedCode;
    }

    return "";
  };

  return visit(rawError, 0);
}

export function shouldFallbackSessionCreate(statusCode: number, rawError?: unknown): boolean {
  if (statusCode === 404 || statusCode === 405 || statusCode === 501) return true;

  const errorText = extractUpstreamErrorCode(rawError);
  const explicitUnsupportedCodes = [
    "UNSUPPORTED_PATH",
    "METHOD_NOT_ALLOWED",
    "NOT_IMPLEMENTED",
    "SESSION_API_NOT_SUPPORTED",
    "ENDPOINT_NOT_FOUND",
    "NOT_FOUND",
    "ROUTE_NOT_FOUND",
    "WORKER_UPSTREAM_ERROR"
  ];
  if (explicitUnsupportedCodes.includes(errorText)) return true;

  if (statusCode === 403 && /FORBIDDEN|UNAUTHORIZED|AUTH|WORKER_UPSTREAM_ERROR/.test(errorText)) return true;
  if (/CANNOT\s+(POST|GET)\s+\/API\/SESSIONS|ROUTE|NOT\s+FOUND|ENDPOINT/.test(errorText)) return true;

  return false;
}

export function isStaleSessionError(statusCode: number, rawError?: unknown): boolean {
  const validStatusCodes = [400, 404, 410, 422];
  if (!validStatusCodes.includes(statusCode)) return false;

  const errorCode = extractUpstreamErrorCode(rawError);
  const exactSessionErrorCodes = [
    "SESSION_NOT_FOUND",
    "INVALID_SESSION_ID",
    "SESSION_EXPIRED",
    "UNKNOWN_SESSION"
  ];

  return exactSessionErrorCodes.includes(errorCode);
}

export interface HermesSessionBindingResult {
  sessionId: string;
  state: "existing" | "created" | "fallback";
}

export async function createHermesSessionBinding(
  instanceId: string,
  conversationId: string,
  title?: string,
  options: { bindImmediately?: boolean } = {}
): Promise<HermesSessionBindingResult> {
  const createRes = await requestRunsAPI({
    instanceId,
    method: "POST",
    path: "/api/sessions",
    body: {
      title: title || "MyBay Agent Conversation"
    },
    timeoutMs: 10000
  });

  if (createRes.ok && createRes.json) {
    const sessionId = extractHermesSessionId(createRes.json);
    if (sessionId) {
      await chatRepo.bindConversationSessionId(conversationId, sessionId);
      return { sessionId, state: "created" };
    }
  }

  const missingSessionIdFromSuccessfulCreate = createRes.ok && !extractHermesSessionId(createRes.json);
  if (missingSessionIdFromSuccessfulCreate || shouldFallbackSessionCreate(createRes.statusCode, createRes.error)) {
    const fallbackSessionId = buildFallbackHermesSessionId(conversationId);
    logOperation("HERMES_SESSION_CREATE_UNAVAILABLE_FALLBACK", conversationId, instanceId, createRes.statusCode, "USING_STABLE_SESSION_ID");
    await chatRepo.bindConversationSessionId(conversationId, fallbackSessionId);
    return { sessionId: fallbackSessionId, state: "fallback" };
  }

  const err = new Error("HERMES_SESSION_CREATE_FAILED");
  (err as any).statusCode = createRes.statusCode;
  throw err;
}

export interface BuildRunPayloadOptions {
  userContent: string;
  currentUserMessageId?: string | null;
  currentRequestId?: string | null;
  agentAttachmentContext?: string;
  sessionBinding: HermesSessionBindingResult;
  historyMessages: Array<{ id?: string; request_id?: string; role: string; content: string }>;
  deduplicateHistoryEnabled?: boolean;
  reasoningEffort?: AgentReasoningEffort;
  systemPolicy?: string;
}

export function buildHermesRunPayload(options: BuildRunPayloadOptions) {
  const {
    userContent,
    currentUserMessageId,
    currentRequestId,
    agentAttachmentContext,
    sessionBinding,
    historyMessages,
    deduplicateHistoryEnabled = process.env.MYBAY_DEDUPLICATE_CHAT_HISTORY === "true",
    reasoningEffort = "balanced",
    systemPolicy = MANAGED_OPERATION_SYSTEM_POLICY
  } = options;

  const userPromptWithAttachment = agentAttachmentContext
    ? `${userContent}\n\n${agentAttachmentContext}`
    : userContent;

  // Filter out current user message from history if already present
  const filteredHistory = historyMessages.filter(h => {
    if (currentUserMessageId && h.id === currentUserMessageId) return false;
    if (currentRequestId && h.request_id === currentRequestId) return false;
    return true;
  });

  // History deduplication applies ONLY when:
  // 1. Feature Flag deduplicateHistoryEnabled is true
  // 2. Session state is "existing" (newly "created" or "fallback" sessions send history to populate session)
  if (deduplicateHistoryEnabled && sessionBinding.state === "existing") {
    return {
      input: userPromptWithAttachment,
      instructions: systemPolicy,
      session_id: sessionBinding.sessionId,
      model_options: toHermesReasoningModelOptions(reasoningEffort)
    };
  }

  // Fallback / Initial / Legacy behavior: build full messages array into input
  const hermesMessages = filteredHistory.map(h => ({
    role: h.role,
    content: h.content
  }));
  hermesMessages.unshift({
    role: "system",
    content: systemPolicy
  });
  hermesMessages.push({
    role: "user",
    content: userPromptWithAttachment
  });

  return {
    input: hermesMessages,
    session_id: sessionBinding.sessionId,
    model_options: toHermesReasoningModelOptions(reasoningEffort)
  };
}

async function ensureHermesSessionForConversation(run: any): Promise<HermesSessionBindingResult> {
  const conversation = await chatRepo.getConversationForSessionBinding(run.conversation_id);
  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const existingSessionId = typeof conversation.session_id === "string" ? conversation.session_id.trim() : "";
  if (existingSessionId && !isLegacyGeneratedSessionId(existingSessionId, run.conversation_id)) {
    if (isFallbackHermesSessionId(existingSessionId, run.conversation_id)) {
      return { sessionId: existingSessionId, state: "fallback" };
    }
    return { sessionId: existingSessionId, state: "existing" };
  }

  return createHermesSessionBinding(
    run.instance_id,
    run.conversation_id,
    conversation.title
  );
}

async function completeRunViaNonStreamingChat(
  run: any,
  hermesMessages: Array<{ id?: string; request_id?: string; role: string; content: string }>,
  hermesSessionId: string,
  reason: string,
  currentUserMessageId?: string | null,
  currentRequestId?: string | null
): Promise<boolean> {
  const filteredMessages = filterCurrentRunMessageFromHistory(
    hermesMessages,
    currentUserMessageId,
    currentRequestId
  );

  addEventToCache(run.id, "status", JSON.stringify({
    status: "running",
    mode: "non_streaming_chat",
    reason
  }));

  const startTime = Date.now();
  const chatRes = await requestRunsAPI({
    instanceId: run.instance_id,
    method: "POST",
    path: "/v1/chat/completions",
    body: {
      messages: buildHermesChatMessages(filteredMessages),
      model: "hermes-agent",
      stream: false,
      model_options: toHermesReasoningModelOptions(run.reasoning_effort)
    },
    hermesSessionId,
    timeoutMs: 120000
  });
  const durationMs = Date.now() - startTime;

  if (!chatRes.ok || !chatRes.json) {
    const errorCode = normalizeDispatchError(chatRes.statusCode, chatRes.error);
    logOperation("NON_STREAMING_CHAT_FAILED", run.id, run.instance_id, chatRes.statusCode, errorCode, durationMs);
    await completeRun(run.id, "failed", "", errorCode, undefined, durationMs);
    return false;
  }

  const assistantContent = extractAssistantContentFromChatResponse(chatRes.json);
  if (!assistantContent) {
    logOperation("NON_STREAMING_CHAT_EMPTY", run.id, run.instance_id, chatRes.statusCode, "INVALID_UPSTREAM_RESPONSE", durationMs);
    await completeRun(run.id, "failed", "", "UPSTREAM_FAILED", chatRes.json?.usage, durationMs);
    return false;
  }

  if (containsDsmlToolCallProtocol(assistantContent)) {
    logOperation("NON_STREAMING_CHAT_DSML_LEAK_BLOCKED", run.id, run.instance_id, chatRes.statusCode, DSML_TOOL_CALL_ERROR_CODE, durationMs);
    await completeRun(run.id, "failed", "", DSML_TOOL_CALL_ERROR_CODE, chatRes.json?.usage, durationMs);
    return false;
  }

  logOperation("RUN_COMPLETED_NON_STREAMING", run.id, run.instance_id, chatRes.statusCode, undefined, durationMs);
  await completeRun(run.id, "completed", assistantContent, undefined, chatRes.json?.usage || {}, durationMs);
  return true;
}

let reconcilerTimer: NodeJS.Timeout | null = null;
let isCycleRunning = false;
let runReconcileCycle: (() => Promise<void>) | null = null;
let reconcileWakeScheduled = false;
let reconcileWakePending = false;

export function requestRunsReconcile(): boolean {
  if (!runReconcileCycle) return false;
  reconcileWakePending = true;
  if (reconcileWakeScheduled) return true;
  reconcileWakeScheduled = true;
  queueMicrotask(() => {
    reconcileWakeScheduled = false;
    if (!reconcileWakePending || !runReconcileCycle) return;
    reconcileWakePending = false;
    void runReconcileCycle();
  });
  return true;
}

export async function startRunsReconciler(intervalMs = 5000, options: { allowInTest?: boolean; cacheCleanupIntervalMs?: number } = {}) {
  if (reconcilerTimer || (process.env.NODE_ENV === "test" && !options.allowInTest)) return;
  // Deliberately independent from the Interactive Runs creation gate: disabling
  // new runs must not strand queued/running runs that already exist in SQLite.
  console.log(`[RunsReconciler] Background asynchronous runs controller started (Interval: ${intervalMs / 1000}s, Node: ${RECONCILER_ID})`);

  runReconcileCycle = async () => {
    if (isCycleRunning) {
      reconcileWakePending = true;
      return;
    }
    isCycleRunning = true;

    const leaseLostRuns = new Set<string>();

    try {
      // 1. Claim a batch of runs (lease duration: 60 seconds, batch limit: 10)
      const claimedRuns = await chatRepo.claimRuns({
        reconcilerId: RECONCILER_ID,
        leaseSeconds: 60,
        limit: 10
      });

      if (claimedRuns.length === 0) return;

      // Start active lease renewal in the background for processing tasks
      const renewalTimer = setInterval(async () => {
        for (const run of claimedRuns) {
          if (leaseLostRuns.has(run.id)) continue;
          try {
            const ok = await chatRepo.renewRunLease({
              runId: run.id,
              reconcilerId: RECONCILER_ID,
              leaseSeconds: 60
            });
            if (!ok) {
              console.error(`[RunsReconciler] Lease renewal failed for run ${run.id}.`);
              leaseLostRuns.add(run.id);
            }
          } catch (renewErr: any) {
            console.error(`[RunsReconciler] Lease renewal exception for run ${run.id}:`, renewErr.message);
            leaseLostRuns.add(run.id);
          }
        }
      }, 25000); // Renew every 25 seconds

      try {
        for (const run of claimedRuns) {
          if (leaseLostRuns.has(run.id)) {
            console.error(`[RunsReconciler] Skipping run ${run.id} processing because lease was lost.`);
            continue;
          }
          try {
            emitRunLifecycleStep(
              run.id,
              "worker-claimed",
              "Deployment worker claimed the Agent task",
              "completed",
              "model_reasoning",
              RECONCILER_ID,
              { runtime: "local" }
            );
            await processSingleRun(run, leaseLostRuns);
          } catch (singleRunErr: any) {
            console.error(`[RunsReconciler] Exception processing run ${run.id}:`, singleRunErr.message);
          } finally {
            // Clean release of the lease
            if (!leaseLostRuns.has(run.id)) {
              await chatRepo.releaseRunLease({
                runId: run.id,
                reconcilerId: RECONCILER_ID
              }).catch(() => {});
            }
          }
        }
      } finally {
        clearInterval(renewalTimer);
      }
    } catch (cycleErr: any) {
      console.error("[RunsReconciler] Reconciliation cycle exception:", cycleErr.message);
    } finally {
      isCycleRunning = false;
      if (reconcileWakePending) requestRunsReconcile();
    }
  };

  reconcilerTimer = setInterval(() => { void runReconcileCycle?.(); }, intervalMs);
  reconcilerTimer.unref?.();
  cacheCleanupTimer = setInterval(cleanupInactiveRunCaches, options.cacheCleanupIntervalMs ?? 60000);
  cacheCleanupTimer.unref?.();
  void runReconcileCycle();
}

export function stopRunsReconciler() {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
  if (cacheCleanupTimer) clearInterval(cacheCleanupTimer);
  cacheCleanupTimer = null;
  runReconcileCycle = null;
  reconcileWakeScheduled = false;
  reconcileWakePending = false;
  for (const controller of activeUpstreamEventStreams.values()) controller.abort();
  activeUpstreamEventStreams.clear();
}

function normalizeDispatchError(statusCode: number, rawError?: unknown): string {
  const code = typeof rawError === "string" ? rawError.toUpperCase() : String(rawError || "").toUpperCase();

  if (
    code.includes("SESSION_NOT_FOUND") ||
    code.includes("INVALID_SESSION_ID") ||
    code.includes("SESSION_EXPIRED") ||
    code.includes("UNKNOWN_SESSION")
  ) {
    return code;
  }

  if (code === "HERMES_INTERNAL_API_KEY_MISSING" || code === "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED") {
    return code;
  }
  if (statusCode === 401 || statusCode === 403 || code.includes("AUTH")) {
    return "HERMES_API_AUTH_FAILED";
  }
  if (statusCode === 404 || code.includes("NOT_FOUND") || code.includes("ROUTE")) {
    return "DISPATCH_ROUTE_NOT_FOUND";
  }
  if (statusCode === 408 || statusCode === 504 || code.includes("TIMEOUT")) {
    return "DISPATCH_TIMEOUT";
  }
  if (statusCode === 400 || statusCode === 422) {
    return "DISPATCH_INVALID_REQUEST";
  }
  if (statusCode === 502 || statusCode === 503 || code.includes("ECONN") || code.includes("CONNECT") || code.includes("UNAVAILABLE")) {
    return "DISPATCH_UPSTREAM_UNAVAILABLE";
  }
  if (statusCode >= 500) {
    return "DISPATCH_UPSTREAM_UNAVAILABLE";
  }

  return "UPSTREAM_DISPATCH_ERR";
}
export function sanitizeErrorCode(rawError: unknown): string {
  if (!rawError) return "UPSTREAM_FAILED";
  const str = typeof rawError === "string" ? rawError : String(rawError);
  const upper = str.toUpperCase();
  
  // Whitelist of valid desensitized error codes
  const whitelist = [
    "USER_MESSAGE_MISSING",
    "INVALID_UPSTREAM_RUN_ID",
    "DISPATCH_MAX_ATTEMPTS_EXCEEDED",
    "RUNTIME_TIMEOUT_EXCEEDED",
    "UPSTREAM_FAILED",
    "CANCELLED_UPSTREAM",
    "UPSTREAM_RUN_NOT_FOUND",
    "CANCELLED_BY_USER",
    "INSTANCE_OFFLINE",
    "DISPATCH_FAILED",
    "STOP_CONFIRMATION_TIMEOUT",
    "STOP_REQUEST_FAILED",
    "TIMEOUT_EXCEEDED",
    "UPSTREAM_RUN_ID_CONFLICT",
    "HERMES_SESSION_REBIND_FAILED",
    "HERMES_SESSION_CREATE_FAILED",
    "SESSION_NOT_FOUND",
    "INVALID_SESSION_ID",
    "SESSION_EXPIRED",
    "UNKNOWN_SESSION"
  ];

  if (whitelist.includes(upper)) {
    return upper;
  }

  if (upper.includes("TIMEOUT")) {
    return "TIMEOUT_EXCEEDED";
  }
  if (upper.includes("OFFLINE") || upper.includes("CONN") || upper.includes("SOCKET") || upper.includes("UNREACHABLE")) {
    return "INSTANCE_OFFLINE";
  }
  if (upper.includes("CANCEL")) {
    return "CANCELLED_UPSTREAM";
  }
  
  // Fallback to a clean generic code
  return "UPSTREAM_FAILED";
}

export function filterCurrentRunMessageFromHistory(
  history: Array<{ id?: string; request_id?: string; role: string; content: string }>,
  currentUserMessageId?: string | null,
  currentRequestId?: string | null
) {
  if (!Array.isArray(history)) return [];
  return history.filter(h => {
    if (currentUserMessageId && h.id === currentUserMessageId) return false;
    if (currentRequestId && h.request_id === currentRequestId) return false;
    return true;
  });
}



export async function completeRun(
  runId: string,
  finalStatus: "completed" | "failed" | "cancelled" | "expired",
  assistantContent = "",
  errorCode?: string,
  usage?: any,
  durationMs?: number | null,
  authorization: { expectedUpstreamRunId?: string } = {}
): Promise<boolean> {
  const leakedToolProtocol = finalStatus === "completed" && containsDsmlToolCallProtocol(assistantContent);
  const effectiveStatus = leakedToolProtocol ? "failed" : finalStatus;
  const effectiveAssistantContent = leakedToolProtocol ? "" : assistantContent;
  const safeErrorCode = effectiveStatus !== "completed"
    ? sanitizeErrorCode(leakedToolProtocol ? DSML_TOOL_CALL_ERROR_CODE : errorCode)
    : undefined;

  if (leakedToolProtocol) {
    console.warn(JSON.stringify({
      operation: "agent_dsml_tool_call_leak_blocked",
      runId,
      errorCode: DSML_TOOL_CALL_ERROR_CODE
    }));
  }

  if (usage) {
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
      usage: normalizedObserved
    }));
  }

  // 1. Persist in database FIRST (passing RECONCILER_ID to enforce lease)
  const result = await chatRepo.finishChatRun({
    runId,
    status: effectiveStatus,
    assistantContent: effectiveAssistantContent,
    errorCode: safeErrorCode,
    usagePromptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? null,
    usageCompletionTokens: usage?.completion_tokens ?? usage?.output_tokens ?? null,
    usageTotalTokens: usage?.total_tokens ?? null,
    durationMs: durationMs ?? null,
    reconcilerId: authorization.expectedUpstreamRunId ? undefined : RECONCILER_ID,
    expectedUpstreamRunId: authorization.expectedUpstreamRunId
  });

  if (result.status === "already_terminal") {
    // Re-read actual DB terminal state rather than trusting caller-provided pseudo final status
    const latestRun = await chatRepo.getChatRun(runId);
    const dbStatus = latestRun?.status || finalStatus;
    const dbErrorCode = latestRun?.error_code || null;
    const dbDuration = latestRun?.duration_ms || null;

    addEventToCache(
      runId,
      "step",
      JSON.stringify(sanitizeStep({
        id: `${runId}-final`,
        stepType: "final",
        status: dbStatus === "completed" ? "completed" : "failed",
        title: dbStatus === "completed" ? "Final answer generated" : "Agent run ended",
        completedAt: Date.now()
      }))
    );

    addEventToCache(
      runId,
      "status",
      JSON.stringify({
        status: dbStatus,
        errorCode: dbErrorCode,
        durationMs: dbDuration
      })
    );

    if (latestRun?.user_id && latestRun?.instance_id && latestRun?.conversation_id) {
      emitChatConversationUpdated({
        userId: latestRun.user_id,
        instanceId: latestRun.instance_id,
        conversationId: latestRun.conversation_id,
        runId,
        source: dbStatus === "completed" ? "run_completed" : "run_failed",
        status: dbStatus
      });
    }

    setTerminalRunExpiry(runId);
    return true;
  }

  if (result.status !== "success" && result.status !== "failure_recorded") {
    console.warn(`[RunsReconciler] finishChatRun failed with status ${result.status} for run ${runId}. Aborting completion event.`);
    return false;
  }

  // 2. Send final status event ONLY AFTER successful DB commit
  addEventToCache(
    runId,
    "step",
    JSON.stringify(sanitizeStep({
      id: `${runId}-final`,
      stepType: "final",
      status: effectiveStatus === "completed" ? "completed" : "failed",
      title: effectiveStatus === "completed" ? "Final answer generated" : "Agent run ended",
      completedAt: Date.now()
    }))
  );

  const latestRun = await chatRepo.getChatRun(runId).catch(() => null);
  addEventToCache(
    runId,
    "status",
    JSON.stringify({
      status: effectiveStatus,
      errorCode: safeErrorCode || null,
      durationMs: durationMs || null
    })
  );

  if (latestRun?.user_id && latestRun?.instance_id && latestRun?.conversation_id) {
    emitChatConversationUpdated({
      userId: latestRun.user_id,
      instanceId: latestRun.instance_id,
      conversationId: latestRun.conversation_id,
      runId,
      source: effectiveStatus === "completed" ? "run_completed" : "run_failed",
      status: effectiveStatus
    });
  }

  // 3. Set terminal run cache TTL (instead of immediate clear)
  setTerminalRunExpiry(runId);
  return true;
}

async function handleDispatchRecordResult(
  run: any,
  recordRes: { status: string; run_status: string | null },
  upstreamId: string,
  leaseLostRuns: Set<string>
): Promise<boolean> {
  const statusStr = recordRes.status;
  if (statusStr === "recorded_running" || statusStr === "already_running") {
    addEventToCache(run.id, "status", JSON.stringify({ status: "running" }));
    ensureUpstreamRunEventStream(run, upstreamId);
    return true;
  } else if (statusStr === "recorded_stopping") {
    addEventToCache(run.id, "status", JSON.stringify({ status: "stopping" }));
    return false;
  } else if (statusStr === "already_terminal") {
    clearEventsCache(run.id);
    return false;
  } else if (statusStr === "lease_lost") {
    leaseLostRuns.add(run.id);
    clearEventsCache(run.id);
    return false;
  } else if (statusStr === "upstream_id_conflict") {
    logOperation("UPSTREAM_ID_CONFLICT", run.id, run.instance_id, 409, "UPSTREAM_RUN_ID_CONFLICT");
    const fresh = await chatRepo.getChatRun(run.id);
    if (hasValidRunLease(fresh)) {
      await completeRun(run.id, "failed", "", "UPSTREAM_RUN_ID_CONFLICT");
    }
    return false;
  } else if (statusStr === "invalid_upstream_run_id") {
    logOperation("INVALID_UPSTREAM_RUN_ID", run.id, run.instance_id, 400, "INVALID_UPSTREAM_RUN_ID");
    const fresh = await chatRepo.getChatRun(run.id);
    if (hasValidRunLease(fresh)) {
      await completeRun(run.id, "failed", "", "INVALID_UPSTREAM_RUN_ID");
    }
    return false;
  } else {
    logOperation("DISPATCH_RECORD_FAILED", run.id, run.instance_id, 500, statusStr);
    return false;
  }
}

type SafeToolCategory =
  | "search"
  | "browser"
  | "file"
  | "code"
  | "data"
  | "communication"
  | "other";

function getSafeToolCategory(incomingTool: string): SafeToolCategory {
  const t = incomingTool.toLowerCase();
  if (t.includes("search") || t.includes("google") || t.includes("bing")) {
    return "search";
  }
  if (t.includes("browser") || t.includes("web") || t.includes("page") || t.includes("scrape") || t.includes("visit") || t.includes("http")) {
    return "browser";
  }
  if (t.includes("file") || t.includes("read") || t.includes("write") || t.includes("save") || t.includes("upload") || t.includes("download") || t.includes("directory")) {
    return "file";
  }
  if (t.includes("code") || t.includes("exec") || t.includes("run") || t.includes("repl") || t.includes("python") || t.includes("interpreter") || t.includes("eval") || t.includes("bash") || t.includes("shell") || t.includes("cmd")) {
    return "code";
  }
  if (t.includes("db") || t.includes("sql") || t.includes("table") || t.includes("csv") || t.includes("json")) {
    return "data";
  }
  if (t.includes("mail") || t.includes("email") || t.includes("chat") || t.includes("slack") || t.includes("discord") || t.includes("telegram") || t.includes("feishu") || t.includes("send") || t.includes("message") || t.includes("communication")) {
    return "communication";
  }
  return "other";
}

type SafeRunStepStatus = "running" | "completed" | "failed";
type SafeRunStepType = "web_search" | "file_read" | "tool_call" | "model_reasoning" | "final";

type SafeRunStep = {
  id: string;
  tool_name: string;
  stepType: SafeRunStepType;
  status: SafeRunStepStatus;
  title: string;
  safe_summary: string;
  startedAt?: number;
  completedAt?: number;
  metadata: Record<string, string | number | boolean>;
};

function normalizeStepStatus(value: any): SafeRunStepStatus {
  const incomingStatus = String(value || "").toLowerCase();
  if (["completed", "complete", "success", "succeeded", "done"].includes(incomingStatus)) return "completed";
  if (["failed", "error", "errored", "cancelled", "canceled"].includes(incomingStatus)) return "failed";
  return "running";
}

function getStepTypeFromCategory(category: SafeToolCategory, incomingTool: string): SafeRunStepType {
  const normalized = incomingTool.toLowerCase();
  if (category === "search" || normalized.includes("web_search")) return "web_search";
  if (category === "browser") return "web_search";
  if (category === "file") return "file_read";
  if (normalized.includes("reason") || normalized.includes("think") || normalized.includes("model")) return "model_reasoning";
  return "tool_call";
}

function getStepTitleI18nKey(stepType: SafeRunStepType, category: SafeToolCategory, status: SafeRunStepStatus): string {
  if (status === "failed") return "chatWorkspace.toolStepFailed";
  if (stepType === "final") return status === "completed" ? "chatWorkspace.toolStepFinalGenerated" : "chatWorkspace.toolStepFinalGenerating";
  if (stepType === "model_reasoning") return status === "completed" ? "chatWorkspace.toolStepReasoningCompleted" : "chatWorkspace.toolStepReasoningAnalyzing";

  const completed = status === "completed";
  switch (category) {
    case "search":
      return completed ? "chatWorkspace.toolStepSearchCompleted" : "chatWorkspace.toolStepSearchRunning";
    case "browser":
      return completed ? "chatWorkspace.toolStepBrowserCompleted" : "chatWorkspace.toolStepBrowserRunning";
    case "file":
      return completed ? "chatWorkspace.toolStepFileCompleted" : "chatWorkspace.toolStepFileRunning";
    case "code":
      return completed ? "chatWorkspace.toolStepCodeCompleted" : "chatWorkspace.toolStepCodeRunning";
    case "data":
      return completed ? "chatWorkspace.toolStepDataCompleted" : "chatWorkspace.toolStepDataRunning";
    case "communication":
      return completed ? "chatWorkspace.toolStepCommunicationCompleted" : "chatWorkspace.toolStepCommunicationRunning";
    default:
      return completed ? "chatWorkspace.toolStepCompleted" : "chatWorkspace.toolStepExecuting";
  }
}

function safeTimestamp(value: any): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstSafeValue(...values: any[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const joined = value.map((item) => firstSafeValue(item)).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    if (typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function pickNestedSafeValue(step: any, ...paths: string[]): string {
  for (const path of paths) {
    const parts = path.split(".");
    let current = step;
    for (const part of parts) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = current[part];
    }
    const text = firstSafeValue(current);
    if (text) return text;
  }
  return "";
}

function buildSafeStepMetadata(step: any, category: SafeToolCategory): Record<string, string | number | boolean> {
  const metadata: Record<string, string | number | boolean> = { category };
  const rawCount = Number(step.count || step.result_count || step.results_count || step.items_count || step.output?.count || step.output?.total);
  if (Number.isFinite(rawCount) && rawCount >= 0 && rawCount <= 10000) metadata.count = rawCount;

  const source = truncateSafeText(firstSafeValue(step.source, step.provider, step.engine, step.site, step.domain, step.metadata?.source, step.metadata?.provider), 80);
  if (source) metadata.source = source;

  const query = truncateSafeText(firstSafeValue(
    step.query,
    step.search_query,
    step.keyword,
    step.keywords,
    step.metadata?.query,
    step.metadata?.search_query,
    pickNestedSafeValue(step, "input.query", "input.search_query", "args.query", "arguments.query", "params.query")
  ), 120);
  if (query && (category === "search" || category === "browser")) metadata.query = query;

  const url = truncateSafeText(firstSafeValue(
    step.url,
    step.href,
    step.link,
    step.page_url,
    step.metadata?.url,
    step.metadata?.href,
    step.metadata?.link,
    pickNestedSafeValue(step, "input.url", "args.url", "arguments.url", "params.url", "output.url", "result.url")
  ), 180);
  if (url && /^https?:\/\//i.test(url)) metadata.url = url;

  const pageTitle = truncateSafeText(firstSafeValue(step.page_title, step.title_text, step.metadata?.page_title, pickNestedSafeValue(step, "output.title", "result.title")), 120);
  if (pageTitle && pageTitle !== query) metadata.page_title = pageTitle;

  const filePath = truncateSafeText(firstSafeValue(
    step.file_path,
    step.file,
    step.path,
    step.filename,
    step.metadata?.file_path,
    step.metadata?.path,
    pickNestedSafeValue(step, "input.file_path", "input.path", "args.path", "arguments.path", "params.path", "output.path", "result.path")
  ), 180);
  if (filePath && !filePath.includes("..")) metadata.file_path = filePath;

  return metadata;
}

export function sanitizeStep(step: any): SafeRunStep {
  let stepId = String(step.id || step.step_id || "");
  if (!stepId || stepId.length > 96 || !/^[A-Za-z0-9_\-:.]+$/.test(stepId)) {
    stepId = `step-${crypto.randomUUID()}`;
  }

  const status = normalizeStepStatus(step.status);
  const incomingTool = String(step.name || step.tool_name || step.tool || step.action || "");
  const category = getSafeToolCategory(incomingTool);
  const rawStepType = String(step.stepType || step.step_type || "");
  const safeStepType: SafeRunStepType = ["web_search", "file_read", "tool_call", "model_reasoning", "final"].includes(rawStepType)
    ? rawStepType as SafeRunStepType
    : getStepTypeFromCategory(category, incomingTool);
  const title = truncateSafeText(step.title, 120) || getStepTitleI18nKey(safeStepType, category, status);
  const startedAt = safeTimestamp(step.startedAt || step.started_at || step.timestamp) || (status === "running" ? Date.now() : undefined);
  const completedAt = safeTimestamp(step.completedAt || step.completed_at) || (status !== "running" ? Date.now() : undefined);

  return {
    id: stepId,
    tool_name: category,
    stepType: safeStepType,
    status,
    title,
    safe_summary: title,
    startedAt,
    completedAt,
    metadata: buildSafeStepMetadata(step, category)
  };
}
export async function processSingleRun(run: any, leaseLostRuns: Set<string>) {
  const status = run.status;
  initRunSequence(run.id, run.last_event_seq || 0);

  // Retrieve or initialize incremental tracker
  let tracker = runTrackingMap.get(run.id);
  if (!tracker) {
    tracker = {
      lastPartialOutput: run.partial_output || "",
      sentSteps: new Map(),
      activeToolIds: new Map()
    };
    runTrackingMap.set(run.id, tracker);
  }

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
      if (nextAttempts > 1) {
        const queryRes = await requestRunsAPI({
          instanceId: run.instance_id,
          method: "GET",
          path: "/v1/runs",
          timeoutMs: 10000
        });

        let runList: any[] = [];
        if (queryRes.ok && queryRes.json) {
          if (Array.isArray(queryRes.json)) {
            runList = queryRes.json;
          } else if (Array.isArray(queryRes.json.runs)) {
            runList = queryRes.json.runs;
          } else if (Array.isArray(queryRes.json.data)) {
            runList = queryRes.json.data;
          }
        }

        const match = runList.find(
          (r: any) => r.id === run.id || r.run_id === run.id || r.upstream_run_id === run.id
        );
        if (match && match.id) {
          recoveredUpstreamId = match.id;
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

        await handleDispatchRecordResult(run, recordRes, recoveredUpstreamId, leaseLostRuns);
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
            conversationId: run.conversation_id
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
      let sessionBinding: HermesSessionBindingResult;
      try {
        sessionBinding = await ensureHermesSessionForConversation(run);
      } catch (sessionErr: any) {
        const errorCode = sessionErr?.message === "CONVERSATION_NOT_FOUND" ? "CONVERSATION_NOT_FOUND" : "HERMES_SESSION_CREATE_FAILED";
        logOperation("HERMES_SESSION_BIND_FAILED", run.id, run.instance_id, sessionErr?.statusCode || 500, errorCode);
        await completeRun(run.id, "failed", "", errorCode);
        return;
      }
      const hermesSessionId = sessionBinding.sessionId;

      const payload = buildHermesRunPayload({
        userContent: userMsg.content,
        currentUserMessageId: userMsg.id,
        currentRequestId: userMsg.request_id,
        agentAttachmentContext,
        sessionBinding,
        historyMessages: history,
        reasoningEffort: run.reasoning_effort
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
      if (shouldPreferNonStreamingChatForInstance(dispatchInstance)) {
        await completeRunViaNonStreamingChat(run, hermesMessages, hermesSessionId, "provider_compatibility", userMsg?.id, userMsg?.request_id);
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
      let dispatchRes = await requestRunsAPI({
        instanceId: run.instance_id,
        method: "POST",
        path: "/v1/runs",
        body: payload,
        headers: {
          "Idempotency-Key": run.id
        },
        timeoutMs: 15000,
        hermesSessionId
      });

      // Scheme B: Stale Hermes Session Recovery (guarded by MYBAY_RECOVER_STALE_HERMES_SESSION Feature Flag)
      const recoverStaleSessionEnabled = process.env.MYBAY_RECOVER_STALE_HERMES_SESSION === "true";
      if (!dispatchRes.ok && recoverStaleSessionEnabled && sessionBinding.state === "existing" && isStaleSessionError(dispatchRes.statusCode, dispatchRes.error)) {
        logOperation("HERMES_STALE_SESSION_DETECTED_REBINDING", run.id, run.instance_id, dispatchRes.statusCode);
        try {
          const convInfo = await chatRepo.getConversationForSessionBinding(run.conversation_id);
          const newBinding = await createHermesSessionBinding(
            run.instance_id,
            run.conversation_id,
            convInfo?.title || "MyBay Agent Conversation",
            { bindImmediately: false }
          );

          const retryPayload = buildHermesRunPayload({
            userContent: userMsg.content,
            currentUserMessageId: userMsg.id,
            currentRequestId: userMsg.request_id,
            agentAttachmentContext,
            sessionBinding: newBinding,
            historyMessages: filteredHistory,
            reasoningEffort: run.reasoning_effort
          });

          dispatchRes = await requestRunsAPI({
            instanceId: run.instance_id,
            method: "POST",
            path: "/v1/runs",
            body: retryPayload,
            headers: {
              "Idempotency-Key": `${run.id}:session-rebind:1`
            },
            timeoutMs: 15000,
            hermesSessionId: newBinding.sessionId
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
        if (!/^[A-Za-z0-9_\-\.]{1,128}$/.test(upstreamId)) {
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

        await handleDispatchRecordResult(run, recordRes, upstreamId, leaseLostRuns);
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
          await completeRunViaNonStreamingChat(run, hermesMessages, hermesSessionId, "provider_compatibility", userMsg?.id, userMsg?.request_id);
          return;
        }

        if (nextAttempts >= 3) {
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

      await handleDispatchRecordResult(run, recordRes, run.upstream_run_id, leaseLostRuns);
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

    ensureUpstreamRunEventStream(run, run.upstream_run_id);

    const maxRuntimeMs = getMaxRuntimeMs();
    const elapsed = Date.now() - new Date(run.created_at).getTime();
    if (elapsed > maxRuntimeMs) {
      logOperation("TIMEOUT_EXCEEDED", run.id, run.instance_id, 408, "RUNTIME_TIMEOUT_EXCEEDED");
      await requestRunsAPI({
        instanceId: run.instance_id,
        method: "POST",
        path: `/v1/runs/${run.upstream_run_id}/stop`,
        timeoutMs: 10000
      }).catch(() => {});

      await completeRun(run.id, "expired", "", "RUNTIME_TIMEOUT_EXCEEDED");
      return;
    }

    const startTime = Date.now();
    const statusRes = await requestRunsAPI({
      instanceId: run.instance_id,
      method: "GET",
      path: `/v1/runs/${run.upstream_run_id}`,
      timeoutMs: 10000
    });
    const durationMs = Date.now() - startTime;

    if (statusRes.ok && statusRes.json) {
      const upstreamStatus = statusRes.json.status;
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

      if (upstreamStatus === "completed") {
        const finalContent =
          (typeof statusRes.json.output === "string" ? statusRes.json.output : statusRes.json.output?.message?.content) ||
          statusRes.json.message || statusRes.json.content || "";
        const usage = statusRes.json.usage || {};
        const runDuration = statusRes.json.duration_ms || durationMs;

        logOperation("RUN_COMPLETED", run.id, run.instance_id, 200, undefined, runDuration);
        await completeRun(run.id, "completed", finalContent, undefined, usage, runDuration);
      } else if (upstreamStatus === "failed") {
        const upstreamError = statusRes.json.error || statusRes.json.message || statusRes.json.error_code || "RUN_FAILED_UPSTREAM";
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
                  conversationId: run.conversation_id
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
            const hermesSessionBinding = await ensureHermesSessionForConversation(run);
            await completeRunViaNonStreamingChat(run, hermesMessages, hermesSessionBinding.sessionId, "streaming_decoder_fallback", userMsg?.id, userMsg?.request_id);
            return;
          }
        }

        logOperation("RUN_FAILED_UPSTREAM", run.id, run.instance_id, 200, "UPSTREAM_FAILED", durationMs);
        await completeRun(run.id, "failed", "", upstreamError);
      } else if (upstreamStatus === "cancelled" || upstreamStatus === "cancelled_by_user") {
        logOperation("RUN_CANCELLED_UPSTREAM", run.id, run.instance_id, 200, "UPSTREAM_CANCELLED", durationMs);
        await completeRun(run.id, "cancelled", "", "CANCELLED_UPSTREAM");
      } else {
        // Stream / parse partial outputs incrementally
        const hasPartialOutput = typeof statusRes.json.partial_output === "string";
        const newOutput = hasPartialOutput ? statusRes.json.partial_output : tracker.lastPartialOutput;
        if (hasPartialOutput && newOutput !== tracker.lastPartialOutput) {
          let delta = "";
          if (newOutput.startsWith(tracker.lastPartialOutput)) {
            delta = newOutput.substring(tracker.lastPartialOutput.length);
          } else {
            delta = newOutput;
          }
          tracker.lastPartialOutput = newOutput;
          if (delta) {
            addEventToCache(run.id, "text", delta);
          }
        }

        // Parse tool steps
        const steps = statusRes.json.steps || statusRes.json.tool_steps || [];
        if (Array.isArray(steps)) {
          for (const step of steps) {
            const sanitized = sanitizeStep(step);
            const cacheKey = `${sanitized.status}:${sanitized.safe_summary}`;

            if (tracker.sentSteps.get(sanitized.id) !== cacheKey) {
              tracker.sentSteps.set(sanitized.id, cacheKey);

              // Safe whitelisted parameters only
              addEventToCache(
                run.id,
                "step",
                JSON.stringify(sanitized),
                RECONCILER_ID
              );
            }
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

      if (statusRes.statusCode === 404) {
        logOperation("UPSTREAM_RUN_NOT_FOUND", run.id, run.instance_id, 404, "UPSTREAM_RUN_NOT_FOUND");
        await completeRun(run.id, "failed", "", "UPSTREAM_RUN_NOT_FOUND");
        return;
      }

      // Zombie run cleanup check: if probe fails and run has been silent for > 3 minutes (180,000ms)
      const lastActiveTs = runLastActiveMap.get(run.id) || new Date(run.heartbeat_at || run.last_observed_at || run.started_at || run.created_at).getTime();
      const silentMs = Date.now() - (Number.isFinite(lastActiveTs) ? lastActiveTs : Date.now());

      if (silentMs > 180000) {
        logOperation("ZOMBIE_RUN_TIMEOUT_CLEANUP", run.id, run.instance_id, 408, "ZOMBIE_RUN_TIMEOUT");
        await completeRun(run.id, "failed", "", "ZOMBIE_RUN_TIMEOUT");
        return;
      }
    }
  } else if (status === "stopping") {
    if (!run.upstream_run_id) {
      logOperation("STOPPING_NO_UPSTREAM", run.id, run.instance_id, 200);
      if (leaseLostRuns.has(run.id)) return;

      const dispatchAttempts = Number(run.dispatch_attempts || 0);
      if (dispatchAttempts === 0) {
        // Scenario A: Never attempted dispatch.
        // Can directly be cancelled with CANCELLED_BY_USER
        await completeRun(run.id, "cancelled", "", "CANCELLED_BY_USER");
        return;
      } else {
        // Scenario B: Has attempted dispatch, but upstream_run_id is empty.
        // We must query GET /v1/runs to see if we can find it.
        const queryRes = await requestRunsAPI({
          instanceId: run.instance_id,
          method: "GET",
          path: "/v1/runs",
          timeoutMs: 10000
        });

        let runList: any[] = [];
        if (queryRes.ok && queryRes.json) {
          if (Array.isArray(queryRes.json)) {
            runList = queryRes.json;
          } else if (Array.isArray(queryRes.json.runs)) {
            runList = queryRes.json.runs;
          } else if (Array.isArray(queryRes.json.data)) {
            runList = queryRes.json.data;
          }
        }

        const match = runList.find(
          (r: any) => r.id === run.id || r.run_id === run.id || r.upstream_run_id === run.id
        );

        if (match && match.id) {
          // Found matching upstream Run!
          // Use record_dispatched_chat_run_v1 to save upstream_run_id
          const recordRes = await chatRepo.recordDispatchedChatRun({
            runId: run.id,
            reconcilerId: RECONCILER_ID,
            upstreamRunId: match.id,
            startedAt: new Date().toISOString()
          });

          if (recordRes.status === "recorded_stopping" || recordRes.status === "already_stopping" || recordRes.status === "recorded_running" || recordRes.status === "already_running") {
            logOperation("STOPPING_UPSTREAM_RECOVERED", run.id, run.instance_id, 200);
            return;
          }
        }

        // If not found in GET /v1/runs:
        // Perform finite recovery retries
        const stopAttempts = Number.isFinite(Number(run.stop_attempts)) ? Number(run.stop_attempts) : 0;
        const stopRequestedAtStr = run.stop_requested_at;
        const now = Date.now();
        let requestedTime = now;
        if (stopRequestedAtStr) {
          const parsedTime = new Date(stopRequestedAtStr).getTime();
          if (Number.isFinite(parsedTime)) {
            requestedTime = parsedTime;
          }
        }
        const timeElapsedSec = (now - requestedTime) / 1000;

        if (stopAttempts >= 3 || timeElapsedSec > 300) {
          logOperation("STOP_RECOVERY_TIMEOUT", run.id, run.instance_id, 408, "STOP_CONFIRMATION_TIMEOUT");
          await completeRun(run.id, "failed", "", "STOP_CONFIRMATION_TIMEOUT");
          return;
        }

        // Increment stop_attempts
        const nextAttempts = stopAttempts + 1;
        const nextRequestedAt = stopRequestedAtStr || new Date().toISOString();
        const dbSuccess = await chatRepo.updateChatRun(run.id, {
          stop_attempts: nextAttempts,
          stop_requested_at: nextRequestedAt
        }, RECONCILER_ID);

        if (!dbSuccess) {
          leaseLostRuns.add(run.id);
          clearEventsCache(run.id);
        }
        return;
      }
    }

    // 1. First probe upstream to check if it's already terminal
    const startTime = Date.now();
    const statusRes = await requestRunsAPI({
      instanceId: run.instance_id,
      method: "GET",
      path: `/v1/runs/${run.upstream_run_id}`,
      timeoutMs: 10000
    });
    const durationMs = Date.now() - startTime;

    const now = Date.now();
    const stopAttempts = Number.isFinite(Number(run.stop_attempts))
      ? Number(run.stop_attempts)
      : 0;

    const stopRequestedAtStr = run.stop_requested_at;
    let requestedTime = now;
    if (stopRequestedAtStr) {
      const parsedTime = new Date(stopRequestedAtStr).getTime();
      if (Number.isFinite(parsedTime)) {
        requestedTime = parsedTime;
      }
    }
    const timeElapsedSec = (now - requestedTime) / 1000;

    if (statusRes.ok && statusRes.json) {
      const upstreamStatus = statusRes.json.status;
      if (upstreamStatus === "completed") {
        const finalContent =
          (typeof statusRes.json.output === "string" ? statusRes.json.output : statusRes.json.output?.message?.content) ||
          statusRes.json.message || statusRes.json.content || "";
        const usage = statusRes.json.usage || {};
        const runDuration = statusRes.json.duration_ms || durationMs;
        logOperation("STOPPING_UPSTREAM_ALREADY_COMPLETED", run.id, run.instance_id, 200, undefined, runDuration);
        if (leaseLostRuns.has(run.id)) return;
        await completeRun(run.id, "completed", finalContent, undefined, usage, runDuration);
        return;
      } else if (upstreamStatus === "failed") {
        logOperation("STOPPING_UPSTREAM_ALREADY_FAILED", run.id, run.instance_id, 200, "UPSTREAM_FAILED", durationMs);
        if (leaseLostRuns.has(run.id)) return;
        await completeRun(run.id, "failed", "", statusRes.json.error || "RUN_FAILED_UPSTREAM");
        return;
      } else if (upstreamStatus === "cancelled" || upstreamStatus === "cancelled_by_user") {
        logOperation("STOPPING_UPSTREAM_ALREADY_CANCELLED", run.id, run.instance_id, 200, "UPSTREAM_CANCELLED", durationMs);
        if (leaseLostRuns.has(run.id)) return;
        await completeRun(run.id, "cancelled", "", "CANCELLED_UPSTREAM");
        return;
      }
    } else if (statusRes.statusCode === 404) {
      logOperation("STOPPING_UPSTREAM_NOT_FOUND_RETRYING", run.id, run.instance_id, 404, "UPSTREAM_RUN_NOT_FOUND");
      if (stopAttempts >= 3 || timeElapsedSec > 300) {
        logOperation("STOPPING_UPSTREAM_NOT_FOUND_TIMEOUT", run.id, run.instance_id, 404, "STOP_CONFIRMATION_TIMEOUT");
        if (leaseLostRuns.has(run.id)) return;
        await completeRun(run.id, "failed", "", "STOP_CONFIRMATION_TIMEOUT");
        return;
      }
      
      const nextAttempts = stopAttempts + 1;
      const nextRequestedAt = stopRequestedAtStr || new Date().toISOString();
      const dbSuccess = await chatRepo.updateChatRun(run.id, {
        stop_attempts: nextAttempts,
        stop_requested_at: nextRequestedAt
      }, RECONCILER_ID);
      
      if (!dbSuccess) {
        leaseLostRuns.add(run.id);
        clearEventsCache(run.id);
      }
      return;
    }

    // 2. Check retry bounds
    if (stopAttempts >= 3 || timeElapsedSec > 300) {
      logOperation(
        "STOP_MAX_ATTEMPTS_EXCEEDED",
        run.id,
        run.instance_id,
        408,
        "STOP_CONFIRMATION_TIMEOUT"
      );
      if (leaseLostRuns.has(run.id)) return;
      await completeRun(run.id, "failed", "", "STOP_CONFIRMATION_TIMEOUT");
      return;
    }

    // 3. Save attempt/metadata to database under lease lock FIRST before making network call
    const nextAttempts = stopAttempts + 1;
    const nextRequestedAt = stopRequestedAtStr || new Date().toISOString();

    const dbSuccess = await chatRepo.updateChatRun(run.id, {
      stop_attempts: nextAttempts,
      stop_requested_at: nextRequestedAt
    }, RECONCILER_ID);

    if (!dbSuccess) {
      leaseLostRuns.add(run.id);
      clearEventsCache(run.id);
      return;
    }

    logOperation("STOPPING_REQUESTED", run.id, run.instance_id, 200);
    const stopRes = await requestRunsAPI({
      instanceId: run.instance_id,
      method: "POST",
      path: `/v1/runs/${run.upstream_run_id}/stop`,
      timeoutMs: 10000
    });

    if (stopRes.ok) {
      logOperation("STOPPING_ACCEPTED_WAITING", run.id, run.instance_id, stopRes.statusCode);
      if (stopRes.json && (stopRes.json.status === "cancelled" || stopRes.json.status === "cancelled_by_user")) {
        if (leaseLostRuns.has(run.id)) return;
        await completeRun(run.id, "cancelled", "", "CANCELLED_UPSTREAM");
        return;
      }
      // Keep status as stopping, do not call completeRun or write cancelled
      return;
    } else {
      // Do NOT transition to completed / cancelled on error! 
      // Leave state in stopping and release lease for retry cycle.
      logOperation("STOPPING_FAILED_RETRYING", run.id, run.instance_id, stopRes.statusCode, "STOP_REQUEST_FAILED");
    }
  }
}











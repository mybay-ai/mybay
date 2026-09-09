import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.PI_BRIDGE_DATA_DIR || "/opt/data/pi";
const SESSION_DIR = process.env.PI_CODING_AGENT_SESSION_DIR || join(DATA_DIR, "sessions");
const RUN_DIR = join(DATA_DIR, "runs");
const APPROVAL_POLICY_FILE = join(DATA_DIR, "approval-policy.json");
const WORKSPACE_DIR = process.env.PI_WORKSPACE_DIR || "/opt/data/workspace";
const API_KEY = process.env.PI_BRIDGE_API_KEY || process.env.HERMES_API_KEY || "";
const PROVIDER = process.env.PI_PROVIDER || process.env.HERMES_MODEL_PROVIDER || "openai";
const MODEL = process.env.PI_MODEL || process.env.HERMES_MODEL || "gpt-4o-mini";
const PI_ENTRY = process.env.PI_CLI_ENTRY || join(
  dirname(fileURLToPath(import.meta.url)),
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "bundle",
  "cli.js",
);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RUNS = 200;
const runs = new Map();
const sessions = new Map();
const approvalBridgeToken = randomBytes(32).toString("hex");
const alwaysApprovedTools = new Set();
const GUARDED_APPROVAL_TOOLS = new Set(["bash", "powershell", "write", "edit"]);
const APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_for_approval"]);

export const PI_BRIDGE_FEATURES = Object.freeze({
  run_submission: true,
  run_status: true,
  run_events_sse: true,
  run_stop: true,
  tool_progress_events: true,
  chat_attachments: true,
  persisted_workspace: true,
  generated_file_evidence: true,
  a2a_tools: true,
  managed_collaboration: true,
  structured_questions: true,
  approval_events: true,
  run_approval_response: true,
  session_context_usage: true,
  auto_compaction: true,
  manual_compaction: true,
  session_resources: false,
});

export function normalizeReasoningEffort(modelOptions = {}, model = MODEL) {
  const value = String(modelOptions?.reasoning_effort || modelOptions?.reasoning?.effort || "medium").toLowerCase();
  if (model === "gemini-3.8-flash") {
    if (["off", "none", "minimal", "low"].includes(value)) return "low";
    if (["high", "xhigh", "max"].includes(value)) return "high";
    return "medium";
  }
  if (["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) return value;
  if (value === "none") return "off";
  return "medium";
}

export function normalizePrompt(input, instructions = "") {
  const prefix = typeof instructions === "string" && instructions.trim()
    ? `<system-instructions>\n${instructions.trim()}\n</system-instructions>\n\n`
    : "";
  if (typeof input === "string") return `${prefix}${input}`;
  if (Array.isArray(input)) {
    const transcript = input.map((message) => {
      const role = String(message?.role || "user").toUpperCase();
      const content = typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
      return `[${role}]\n${content}`;
    }).join("\n\n");
    return `${prefix}${transcript}`;
  }
  return `${prefix}${JSON.stringify(input ?? "")}`;
}

export function assistantText(message) {
  if (!message || typeof message !== "object" || message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function safeToolCallId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(text) ? text : null;
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function safeToolMetadata(toolName, args) {
  const tool = String(toolName || "").toLowerCase();
  if (!["read", "write", "edit"].includes(tool) || !args || typeof args !== "object" || Array.isArray(args)) return {};
  const rawPath = [args.path, args.file_path, args.filePath].find((value) => typeof value === "string");
  if (!rawPath) return {};
  let relative = rawPath.replaceAll("\\", "/").trim();
  const workspacePrefix = `${WORKSPACE_DIR.replaceAll("\\", "/").replace(/\/$/, "")}/`;
  let evidencePrefix = "/opt/data/workspace/";
  if (relative.startsWith(workspacePrefix)) {
    relative = relative.slice(workspacePrefix.length);
  } else if (relative.startsWith("/opt/data/")) {
    relative = relative.slice("/opt/data/".length);
    evidencePrefix = "/opt/data/";
  }
  if (relative.startsWith("./")) relative = relative.slice(2);
  if (!relative || relative.startsWith("/") || relative.length > 220
    || hasControlCharacter(relative) || /[:%?#*<>|"`$]/.test(relative)
    || relative.split("/").some((part) => !part || part === "." || part === "..")) return {};
  if (/^(?:pi|sessions|state|cache|logs|\.git)(?:\/|$)/i.test(relative)) return {};
  return { path: `${evidencePrefix}${relative}`, operation: tool };
}

export function normalizePiEvent(event, run) {
  if (!event || typeof event !== "object") return [];
  if (event.type === "compaction_start") {
    run.lastCompaction = {
      status: "running",
      reason: ["manual", "threshold", "overflow"].includes(event.reason) ? event.reason : undefined,
    };
    return [];
  }
  if (event.type === "compaction_end") {
    const result = event.result && typeof event.result === "object" ? event.result : {};
    run.lastCompaction = {
      status: event.aborted === true ? "aborted" : event.result ? "completed" : "failed",
      reason: ["manual", "threshold", "overflow"].includes(event.reason) ? event.reason : undefined,
      tokensBefore: safeNonNegativeInteger(result.tokensBefore),
      estimatedTokensAfter: safeNonNegativeInteger(result.estimatedTokensAfter),
    };
    return [];
  }
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    const delta = String(event.assistantMessageEvent.delta || "");
    return delta ? [{ type: "message.delta", delta }] : [];
  }
  if (event.type === "tool_execution_start") {
    const toolCallId = safeToolCallId(event.toolCallId);
    const metadata = safeToolMetadata(event.toolName, event.args);
    if (toolCallId) run.activeTools?.set(toolCallId, metadata);
    return [{
      type: "tool.started",
      tool: event.toolName || "tool",
      title: event.toolName || "Tool",
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
      ...metadata,
      timestamp: Date.now() / 1000,
    }];
  }
  if (event.type === "tool_execution_end") {
    const toolCallId = safeToolCallId(event.toolCallId);
    const metadata = toolCallId ? run.activeTools?.get(toolCallId) || {} : {};
    if (toolCallId) run.activeTools?.delete(toolCallId);
    return [{
      type: "tool.completed",
      tool: event.toolName || "tool",
      title: event.toolName || "Tool",
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
      ...metadata,
      status: event.isError ? "failed" : "completed",
      is_error: event.isError === true,
      timestamp: Date.now() / 1000,
    }];
  }
  if (event.type === "message_end") {
    const text = assistantText(event.message);
    if (text) run.output = text;
    if (event.message?.usage && typeof event.message.usage === "object") run.usage = event.message.usage;
    if (event.message?.model) run.model = event.message.model;
    if (event.message?.stopReason === "error") run.error = event.message.errorMessage || "PI_RUNTIME_RUN_FAILED";
    if (event.message?.stopReason === "aborted") run.stopRequested = true;
  }
  return [];
}

function safeId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_.:-]{8,160}$/.test(text) ? text : null;
}

function json(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("REQUEST_TOO_LARGE"), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("INVALID_JSON"), { statusCode: 400 }); }
}

function authorized(request) {
  if (!API_KEY) return false;
  const header = String(request.headers.authorization || "");
  return header === `Bearer ${API_KEY}` || header === `Basic ${Buffer.from(`mybay:${API_KEY}`).toString("base64")}`;
}

function publicRun(run) {
  return {
    id: run.id,
    run_id: run.id,
    client_run_id: run.clientRunId,
    session_id: run.sessionId,
    status: run.status,
    output: run.output || "",
    error: run.error || undefined,
    usage: run.usage || undefined,
    model: run.model || MODEL,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

async function persistRun(run) {
  const target = join(RUN_DIR, `${run.id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(publicRun(run)), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function publish(run, event) {
  const normalized = { ...event, run_id: run.id, timestamp: event.timestamp || Date.now() / 1000 };
  run.eventSequence = (run.eventSequence || run.events.length) + 1;
  run.events.push(normalized);
  if (run.events.length > 500) run.events.shift();
  for (const subscriber of run.subscribers) subscriber(normalized, run.eventSequence);
}

export function flushPiDeltas(run) {
  clearTimeout(run.deltaTimer); run.deltaTimer = undefined;
  if (!run.pendingDelta) return;
  const delta = run.pendingDelta; run.pendingDelta = "";
  publish(run, { type: "message.delta", delta });
}

export function emit(run, event) {
  if (event.type === "message.delta" && typeof event.delta === "string") {
    run.pendingDelta = (run.pendingDelta || "") + event.delta;
    if (!run.deltaTimer) run.deltaTimer = setTimeout(() => flushPiDeltas(run), 100);
    return;
  }
  flushPiDeltas(run);
  publish(run, event);
}

function sendSse(response, event, id) {
  response.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
}

function piArguments(sessionId, thinking) {
  return [
    PI_ENTRY,
    "--mode", "rpc",
    "--session-id", sessionId,
    "--session-dir", SESSION_DIR,
    "--provider", PROVIDER,
    "--model", MODEL,
    "--thinking", thinking,
    "--tools", "read,bash,edit,write,grep,find,ls,a2a_list,a2a_call,a2a_orchestrate,ask_user",
    "--no-extensions",
    "--extension", "/app/mybay-a2a-extension.mjs",
    "--extension", "/app/mybay-question-extension.mjs",
    "--extension", "/app/mybay-approval-extension.mjs",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--approve",
  ];
}

function createPiSession(sessionId, thinking) {
  const child = spawn(process.execPath, piArguments(sessionId, thinking), {
    cwd: WORKSPACE_DIR,
    env: {
      ...process.env,
      PI_TELEMETRY: "0",
      PI_SKIP_VERSION_CHECK: "1",
      MYBAY_PI_SESSION_ID: sessionId,
      MYBAY_PI_APPROVAL_BRIDGE_URL: `http://127.0.0.1:${PORT}/internal/approvals`,
      MYBAY_PI_APPROVAL_BRIDGE_TOKEN: approvalBridgeToken,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = {
    child,
    buffer: "",
    pendingRunId: null,
    stderr: "",
    thinking,
    lastInstructions: null,
    statsRunId: null,
    statsTimer: null,
    pendingCompaction: null,
    lastCompaction: null,
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => consumePiOutput(state, chunk));
  child.stderr.on("data", (chunk) => { state.stderr = `${state.stderr}${chunk}`.slice(-4000); });
  child.on("exit", (code, signal) => {
    if (state.statsTimer) clearTimeout(state.statsTimer);
    if (state.pendingCompaction) {
      const pending = state.pendingCompaction;
      state.pendingCompaction = null;
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error("PI_PROCESS_EXITED_DURING_COMPACTION"), { statusCode: 502 }));
    }
    const run = state.pendingRunId ? runs.get(state.pendingRunId) : null;
    if (run && ACTIVE_RUN_STATUSES.has(run.status)) {
      run.status = run.stopRequested ? "cancelled" : "failed";
      run.error = run.stopRequested ? "CANCELLED_UPSTREAM" : `PI_PROCESS_EXITED_${code ?? signal ?? "UNKNOWN"}`;
      run.updatedAt = new Date().toISOString();
      emit(run, { type: run.status === "cancelled" ? "run.cancelled" : "run.failed", error: run.error, output: run.output });
      for (const pending of run.pendingApprovals?.values() || []) pending.resolve("deny");
      run.pendingApprovals?.clear();
      void persistRun(run);
    }
    // A configuration change can replace an idle process before its exit event
    // arrives. Never let the old process remove the replacement session.
    if (sessions.get(sessionId) === state) sessions.delete(sessionId);
  });
  // Keep Pi's native threshold/overflow protection enabled even if a retained
  // user-level Pi setting disabled it in an earlier interactive session.
  child.stdin.write(`${JSON.stringify({ type: "set_auto_compaction", enabled: true })}\n`);
  sessions.set(sessionId, state);
  return state;
}

export function instructionsForPiTurn(state, rawInstructions) {
  const instructions = typeof rawInstructions === "string" ? rawInstructions.trim() : "";
  if (!instructions || state.lastInstructions === instructions) return "";
  state.lastInstructions = instructions;
  return instructions;
}

export function selectPiSession(existing, sessionId, thinking, createSession = createPiSession) {
  if (!existing || existing.child?.killed) return createSession(sessionId, thinking);
  return existing;
}

export function applyPiThinkingLevel(state, thinking) {
  if (state.thinking === thinking) return false;
  state.child.stdin.write(`${JSON.stringify({ type: "set_thinking_level", level: thinking })}\n`);
  state.thinking = thinking;
  return true;
}

function consumePiOutput(state, chunk) {
  state.buffer += chunk;
  for (;;) {
    const newline = state.buffer.indexOf("\n");
    if (newline < 0) break;
    const line = state.buffer.slice(0, newline).replace(/\r$/, "");
    state.buffer = state.buffer.slice(newline + 1);
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "compaction_start" && state.pendingCompaction) {
      state.pendingCompaction.evidence = { status: "running", reason: "manual" };
    }
    if (event.type === "compaction_end" && state.pendingCompaction) {
      const result = event.result && typeof event.result === "object" ? event.result : {};
      state.pendingCompaction.evidence = {
        status: event.aborted === true ? "aborted" : event.result ? "completed" : "failed",
        reason: "manual",
        tokensBefore: safeNonNegativeInteger(result.tokensBefore),
        estimatedTokensAfter: safeNonNegativeInteger(result.estimatedTokensAfter),
      };
    }
    if (event.type === "response" && event.command === "compact" && state.pendingCompaction) {
      const pending = state.pendingCompaction;
      state.pendingCompaction = null;
      clearTimeout(pending.timer);
      const data = event.data && typeof event.data === "object" ? event.data : {};
      const evidence = pending.evidence || {
        status: event.success === true ? "completed" : "failed",
        reason: "manual",
      };
      const errorText = event.success === true ? "" : String(event.error || "PI_COMPACTION_FAILED").slice(0, 240);
      const result = {
        ...evidence,
        status: event.success === true ? evidence.status : piCompactionFailureStatus(errorText),
        reason: "manual",
        tokensBefore: safeNonNegativeInteger(data.tokensBefore) ?? evidence.tokensBefore ?? null,
        estimatedTokensAfter: safeNonNegativeInteger(data.estimatedTokensAfter) ?? evidence.estimatedTokensAfter ?? null,
        error: event.success === true ? undefined : errorText,
      };
      state.lastCompaction = result;
      pending.resolve(result);
      continue;
    }
    if (event.type === "response" && event.command === "get_session_stats" && state.statsRunId) {
      const statsRun = runs.get(state.statsRunId);
      if (statsRun && event.success === true) applyPiSessionEvidence(statsRun, event.data);
      if (statsRun) finishRun(state, statsRun);
      continue;
    }
    const run = state.pendingRunId ? runs.get(state.pendingRunId) : null;
    if (!run) continue;
    for (const normalized of normalizePiEvent(event, run)) emit(run, normalized);
    if (event.type === "agent_start") {
      run.status = "running";
      run.updatedAt = new Date().toISOString();
      emit(run, { type: "run.started" });
    }
    if (event.type === "agent_settled") requestPiSessionStats(state, run);
    if (event.type === "response" && event.command === "prompt" && event.success === false) {
      run.error = event.error || "PI_PROMPT_REJECTED";
      finishRun(state, run);
    }
  }
}

export function piCompactionFailureStatus(error) {
  return /nothing to compact|session too small/i.test(String(error || "")) ? "aborted" : "failed";
}

export function requestPiCompaction(state, timeoutMs = 120_000) {
  if (!state || state.child?.killed) return Promise.reject(Object.assign(new Error("PI_SESSION_UNAVAILABLE"), { statusCode: 409 }));
  if (state.pendingRunId || state.pendingCompaction) return Promise.reject(Object.assign(new Error("PI_SESSION_BUSY"), { statusCode: 409 }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!state.pendingCompaction) return;
      state.pendingCompaction = null;
      reject(Object.assign(new Error("PI_COMPACTION_TIMEOUT"), { statusCode: 504 }));
    }, timeoutMs);
    timer.unref?.();
    state.pendingCompaction = { resolve, reject, timer, evidence: null };
    state.child.stdin.write(`${JSON.stringify({ id: `compact:${randomUUID()}`, type: "compact" })}\n`);
  });
}

function safeNonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safePercentage(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value * 100) / 100
    : null;
}

export function applyPiSessionEvidence(run, data) {
  const stats = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const context = stats.contextUsage && typeof stats.contextUsage === "object" && !Array.isArray(stats.contextUsage)
    ? stats.contextUsage
    : {};
  const compaction = run.lastCompaction && typeof run.lastCompaction === "object" ? run.lastCompaction : {};
  run.usage = {
    ...(run.usage && typeof run.usage === "object" && !Array.isArray(run.usage) ? run.usage : {}),
    scope: "session",
    context_tokens: safeNonNegativeInteger(context.tokens),
    context_window: safeNonNegativeInteger(context.contextWindow),
    context_percent: safePercentage(context.percent),
    compaction_status: compaction.status || undefined,
    compaction_reason: compaction.reason || undefined,
    compaction_tokens_before: safeNonNegativeInteger(compaction.tokensBefore),
    compaction_estimated_tokens_after: safeNonNegativeInteger(compaction.estimatedTokensAfter),
  };
  return run.usage;
}

function requestPiSessionStats(state, run) {
  if (state.statsRunId === run.id) return;
  state.statsRunId = run.id;
  state.statsTimer = setTimeout(() => finishRun(state, run), 1500);
  state.statsTimer.unref?.();
  state.child.stdin.write(`${JSON.stringify({ type: "get_session_stats" })}\n`);
}

function finishRun(state, run) {
  if (!ACTIVE_RUN_STATUSES.has(run.status)) return;
  if (state.statsRunId === run.id) {
    if (state.statsTimer) clearTimeout(state.statsTimer);
    state.statsRunId = null;
    state.statsTimer = null;
  }
  run.status = run.stopRequested ? "cancelled" : run.error ? "failed" : "completed";
  run.updatedAt = new Date().toISOString();
  emit(run, {
    type: run.status === "completed" ? "run.completed" : run.status === "cancelled" ? "run.cancelled" : "run.failed",
    output: run.output || "",
    error: run.error,
    usage: run.usage,
    model: run.model || MODEL,
    duration_ms: Date.now() - run.startedAtMs,
  });
  state.pendingRunId = null;
  void persistRun(run);
}

export function cancelActiveRun(state, run) {
  if (!ACTIVE_RUN_STATUSES.has(run.status)) return false;
  run.stopRequested = true;
  run.status = "cancelled";
  run.error = "CANCELLED_UPSTREAM";
  run.updatedAt = new Date().toISOString();
  emit(run, {
    type: "run.cancelled",
    output: run.output || "",
    error: run.error,
    usage: run.usage,
    model: run.model || MODEL,
    duration_ms: Date.now() - run.startedAtMs,
  });
  for (const pending of run.pendingApprovals?.values() || []) pending.resolve("deny");
  run.pendingApprovals?.clear();
  if (state?.pendingRunId === run.id) {
    // A queued prompt can start after an RPC abort acknowledgement. Terminate
    // the per-session process so cancellation is authoritative at every phase.
    if (!state.child.kill("SIGTERM")) {
      state.child.stdin.write(`${JSON.stringify({ id: `stop:${run.id}`, type: "abort" })}\n`);
    }
  } else if (state) {
    state.pendingRunId = null;
  }
  return true;
}

async function restoreRuns() {
  await mkdir(RUN_DIR, { recursive: true });
  await mkdir(SESSION_DIR, { recursive: true });
  await mkdir(WORKSPACE_DIR, { recursive: true });
  try {
    const policy = JSON.parse(await readFile(APPROVAL_POLICY_FILE, "utf8"));
    for (const tool of Array.isArray(policy?.alwaysApprovedTools) ? policy.alwaysApprovedTools : []) {
      if (GUARDED_APPROVAL_TOOLS.has(tool)) alwaysApprovedTools.add(tool);
    }
  } catch {
    // The approval policy is optional on first boot.
  }
  const files = (await readdir(RUN_DIR).catch(() => [])).filter((name) => name.endsWith(".json")).slice(-MAX_RUNS);
  for (const file of files) {
    try {
      const restored = JSON.parse(await readFile(join(RUN_DIR, file), "utf8"));
      const run = { ...restored, activeTools: new Map(), pendingApprovals: new Map(), events: [], subscribers: new Set(), startedAtMs: Date.parse(restored.created_at || restored.createdAt) || Date.now() };
      run.clientRunId = restored.client_run_id || restored.clientRunId;
      run.sessionId = restored.session_id || restored.sessionId;
      run.createdAt = restored.created_at || restored.createdAt;
      run.updatedAt = restored.updated_at || restored.updatedAt;
      if (ACTIVE_RUN_STATUSES.has(run.status)) {
        run.status = "failed";
        run.error = "PI_RUNTIME_RESTARTED";
        run.updatedAt = new Date().toISOString();
        await persistRun(run);
      }
      runs.set(run.id, run);
    } catch {
      // Ignore one malformed retained run without preventing Runtime startup.
    }
  }
}

async function createRun(request, response, body) {
  const sessionId = safeId(body.session_id || request.headers["x-hermes-session-id"] || request.headers["x-session-id"]);
  if (!sessionId) return json(response, 400, { error: "INVALID_SESSION_ID" });
  const idempotencyKey = safeId(request.headers["idempotency-key"]);
  if (idempotencyKey) {
    const existing = [...runs.values()].find((run) => run.clientRunId === idempotencyKey);
    if (existing) return json(response, 200, publicRun(existing));
  }
  const thinking = normalizeReasoningEffort(body.model_options);
  const state = selectPiSession(sessions.get(sessionId), sessionId, thinking);
  if (state.pendingRunId) return json(response, 409, { error: "PI_SESSION_BUSY" });
  // Pi RPC can change thinking level in place. Keep the warm process and its
  // transcript instead of paying a process restart on every mode switch.
  applyPiThinkingLevel(state, thinking);
  const run = {
    id: randomUUID(),
    clientRunId: idempotencyKey || randomUUID(),
    sessionId,
    status: "queued",
    output: "",
    error: "",
    usage: undefined,
    model: MODEL,
    stopRequested: false,
    activeTools: new Map(),
    pendingApprovals: new Map(),
    events: [],
    subscribers: new Set(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    lastCompaction: state.lastCompaction || undefined,
  };
  state.lastCompaction = null;
  runs.set(run.id, run);
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  state.pendingRunId = run.id;
  emit(run, { type: "run.created" });
  await persistRun(run);
  // A Pi RPC session owns and persists its transcript. Repeating an unchanged
  // system policy on every warm turn bloats the transcript and slows later
  // model calls. Re-inject only when the policy changes or the process restarts.
  const prompt = normalizePrompt(body.input, instructionsForPiTurn(state, body.instructions));
  state.child.stdin.write(`${JSON.stringify({ id: run.clientRunId, type: "prompt", message: prompt })}\n`);
  return json(response, 202, publicRun(run));
}

function safeApprovalText(value, maxLength) {
  return Array.from(String(value || ""), (character) => hasControlCharacter(character) ? " " : character).join("").trim().slice(0, maxLength);
}

async function persistApprovalPolicy() {
  const temporary = `${APPROVAL_POLICY_FILE}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, alwaysApprovedTools: [...alwaysApprovedTools].sort() }), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, APPROVAL_POLICY_FILE);
}

export function approvalPolicySnapshot(policy = alwaysApprovedTools) {
  return {
    version: 1,
    alwaysApprovedTools: [...policy].filter((tool) => GUARDED_APPROVAL_TOOLS.has(tool)).sort(),
    guardedTools: [...GUARDED_APPROVAL_TOOLS].sort(),
  };
}

export function revokeAlwaysApprovedTool(rawTool, policy = alwaysApprovedTools) {
  const tool = safeApprovalText(rawTool, 80).toLowerCase();
  if (!GUARDED_APPROVAL_TOOLS.has(tool)) return { ok: false, error: "INVALID_APPROVAL_TOOL" };
  return { ok: true, tool, revoked: policy.delete(tool) };
}

async function createApprovalRequest(request, response, body) {
  const sessionId = safeId(body.sessionId);
  const approvalId = safeToolCallId(body.approvalId);
  const toolName = safeApprovalText(body.toolName, 80).toLowerCase();
  if (!sessionId || !approvalId || !GUARDED_APPROVAL_TOOLS.has(toolName)) {
    return json(response, 400, { success: false, error: "INVALID_APPROVAL_REQUEST" });
  }
  if (alwaysApprovedTools.has(toolName)) return json(response, 200, { success: true, choice: "always" });
  const state = sessions.get(sessionId);
  const run = state?.pendingRunId ? runs.get(state.pendingRunId) : null;
  if (!run || run.sessionId !== sessionId || !ACTIVE_RUN_STATUSES.has(run.status)) {
    return json(response, 409, { success: false, error: "RUN_NOT_ACTIVE" });
  }
  run.pendingApprovals ||= new Map();
  if (run.pendingApprovals.has(approvalId)) {
    return json(response, 409, { success: false, error: "APPROVAL_ALREADY_PENDING" });
  }
  const choice = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!run.pendingApprovals?.delete(approvalId)) return;
      emit(run, { type: "approval.response", approval_id: approvalId, choice: "deny", reason: "APPROVAL_TIMEOUT" });
      if (run.pendingApprovals.size === 0 && run.status === "waiting_for_approval") {
        run.status = "running";
        run.updatedAt = new Date().toISOString();
      }
      resolve("deny");
    }, 300_000);
    run.pendingApprovals.set(approvalId, {
      toolName,
      resolve: (decision) => { clearTimeout(timeout); resolve(decision); },
    });
    run.status = "waiting_for_approval";
    run.updatedAt = new Date().toISOString();
    emit(run, {
      type: "approval.request",
      approval_id: approvalId,
      title: safeApprovalText(body.title, 120) || `Pi 请求执行 ${toolName}`,
      description: safeApprovalText(body.description, 500),
      command: safeApprovalText(body.command, 700),
      choices: ["once", "session", "always", "deny"],
      allow_permanent: true,
    });
    void persistRun(run);
  });
  return json(response, 200, { success: true, choice });
}

async function respondToApproval(response, run, body) {
  const choice = String(body.choice || "").trim().toLowerCase();
  if (!APPROVAL_CHOICES.has(choice)) return json(response, 400, { error: "INVALID_APPROVAL_CHOICE" });
  const requestedId = safeToolCallId(body.approval_id);
  if (body.approval_id !== undefined && !requestedId) return json(response, 400, { error: "INVALID_APPROVAL_ID" });
  const pending = [...(run.pendingApprovals?.entries() || [])];
  const selected = body.resolve_all === true
    ? pending
    : requestedId
      ? pending.filter(([id]) => id === requestedId)
      : pending.length === 1 ? pending : [];
  if (selected.length === 0) return json(response, 409, { error: pending.length > 1 ? "APPROVAL_ID_REQUIRED" : "NO_PENDING_APPROVAL" });
  if (choice === "always") {
    for (const [, approval] of selected) alwaysApprovedTools.add(approval.toolName);
    await persistApprovalPolicy();
  }
  for (const [id, approval] of selected) {
    run.pendingApprovals.delete(id);
    emit(run, { type: "approval.response", approval_id: id, choice });
    approval.resolve(choice);
  }
  if (run.pendingApprovals.size === 0 && run.status === "waiting_for_approval") {
    run.status = "running";
    run.updatedAt = new Date().toISOString();
  }
  await persistRun(run);
  return json(response, 200, { success: true, choice, resolved: selected.map(([id]) => id) });
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "POST" && url.pathname === "/internal/approvals") {
    if (String(request.headers.authorization || "") !== `Bearer ${approvalBridgeToken}`) {
      return json(response, 401, { success: false, error: "UNAUTHORIZED" });
    }
    return createApprovalRequest(request, response, await readJson(request));
  }
  if (request.method === "GET" && ["/health", "/api/health"].includes(url.pathname)) {
    return json(response, 200, { ok: true, runtime: "pi", version: "0.85.1" });
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return json(response, 200, { status: "ok", runtime: "pi", auth_required: true, auth_providers: ["basic"] });
  }
  if (request.method === "POST" && url.pathname === "/auth/password-login") {
    return json(response, 401, { error: "INVALID_CREDENTIALS" });
  }
  if (!authorized(request)) return json(response, 401, { error: "UNAUTHORIZED" });
  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    return json(response, 200, {
      runtime: "pi",
      features: PI_BRIDGE_FEATURES,
      endpoints: { sessions: "/api/sessions", runs: "/v1/runs" },
    });
  }
  if (request.method === "POST" && url.pathname === "/api/sessions") {
    return json(response, 201, { id: randomUUID(), runtime: "pi" });
  }
  const compactMatch = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9_.:-]{8,160})\/compact$/);
  if (request.method === "POST" && compactMatch) {
    const sessionId = safeId(compactMatch[1]);
    const state = sessionId ? selectPiSession(sessions.get(sessionId), sessionId, "medium") : null;
    if (!state) return json(response, 400, { error: "INVALID_SESSION_ID" });
    try {
      const result = await requestPiCompaction(state);
      return json(response, result.status === "completed" ? 200 : 409, { runtime: "pi", session_id: sessionId, ...result });
    } catch (error) {
      return json(response, Number(error?.statusCode || 500), { error: String(error?.message || "PI_COMPACTION_FAILED") });
    }
  }
  if (request.method === "GET" && url.pathname === "/v1/runs") {
    return json(response, 200, { data: [...runs.values()].map(publicRun), runs: [...runs.values()].map(publicRun) });
  }
  if (request.method === "POST" && url.pathname === "/v1/runs") {
    return createRun(request, response, await readJson(request));
  }
  if (request.method === "GET" && url.pathname === "/v1/approval-policy") {
    return json(response, 200, approvalPolicySnapshot());
  }
  if (request.method === "DELETE" && url.pathname === "/v1/approval-policy") {
    const result = revokeAlwaysApprovedTool((await readJson(request)).tool);
    if (!result.ok) return json(response, 400, { error: result.error });
    await persistApprovalPolicy();
    return json(response, 200, { success: true, ...result, policy: approvalPolicySnapshot() });
  }
  const match = url.pathname.match(/^\/v1\/runs\/([A-Za-z0-9_.:-]{8,160})(?:\/(events|stop|approval))?$/);
  if (match) {
    const run = runs.get(match[1]);
    if (!run) return json(response, 404, { error: "RUN_NOT_FOUND" });
    if (request.method === "GET" && !match[2]) return json(response, 200, publicRun(run));
    if (request.method === "POST" && match[2] === "stop") {
      const state = sessions.get(run.sessionId);
      cancelActiveRun(state, run);
      await persistRun(run);
      return json(response, 202, publicRun(run));
    }
    if (request.method === "POST" && match[2] === "approval") {
      return respondToApproval(response, run, await readJson(request));
    }
    if (request.method === "GET" && match[2] === "events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      let sequence = (run.eventSequence || run.events.length) - run.events.length;
      for (const event of run.events) sendSse(response, event, ++sequence);
      if (!ACTIVE_RUN_STATUSES.has(run.status)) return response.end();
      const subscriber = (event, eventSequence) => {
        sendSse(response, event, eventSequence);
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) response.end();
      };
      run.subscribers.add(subscriber);
      const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15000);
      request.on("close", () => { clearInterval(heartbeat); run.subscribers.delete(subscriber); });
      return;
    }
  }
  return json(response, 404, { error: "NOT_FOUND" });
}

export async function startServer() {
  await restoreRuns();
  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => json(response, error?.statusCode || 500, { error: error?.message || "INTERNAL_ERROR" }));
  });
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startServer();
  console.log(`[Pi Runtime Bridge] listening on ${HOST}:${PORT}, provider=${PROVIDER}, model=${MODEL}`);
}

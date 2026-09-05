import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.PI_BRIDGE_DATA_DIR || "/opt/data/pi";
const SESSION_DIR = process.env.PI_CODING_AGENT_SESSION_DIR || join(DATA_DIR, "sessions");
const RUN_DIR = join(DATA_DIR, "runs");
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

export function normalizeReasoningEffort(modelOptions = {}) {
  const value = String(modelOptions?.reasoning_effort || modelOptions?.reasoning?.effort || "medium").toLowerCase();
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

function emit(run, event) {
  const normalized = { ...event, run_id: run.id, timestamp: event.timestamp || Date.now() / 1000 };
  run.events.push(normalized);
  if (run.events.length > 500) run.events.shift();
  for (const subscriber of run.subscribers) subscriber(normalized);
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
    "--tools", "read,bash,edit,write,grep,find,ls",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--approve",
  ];
}

function createPiSession(sessionId, thinking) {
  const child = spawn(process.execPath, piArguments(sessionId, thinking), {
    cwd: WORKSPACE_DIR,
    env: { ...process.env, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = { child, buffer: "", pendingRunId: null, stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => consumePiOutput(state, chunk));
  child.stderr.on("data", (chunk) => { state.stderr = `${state.stderr}${chunk}`.slice(-4000); });
  child.on("exit", (code, signal) => {
    const run = state.pendingRunId ? runs.get(state.pendingRunId) : null;
    if (run && ["queued", "running"].includes(run.status)) {
      run.status = run.stopRequested ? "cancelled" : "failed";
      run.error = run.stopRequested ? "CANCELLED_UPSTREAM" : `PI_PROCESS_EXITED_${code ?? signal ?? "UNKNOWN"}`;
      run.updatedAt = new Date().toISOString();
      emit(run, { type: run.status === "cancelled" ? "run.cancelled" : "run.failed", error: run.error, output: run.output });
      void persistRun(run);
    }
    sessions.delete(sessionId);
  });
  sessions.set(sessionId, state);
  return state;
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
    const run = state.pendingRunId ? runs.get(state.pendingRunId) : null;
    if (!run) continue;
    for (const normalized of normalizePiEvent(event, run)) emit(run, normalized);
    if (event.type === "agent_start") {
      run.status = "running";
      run.updatedAt = new Date().toISOString();
      emit(run, { type: "run.started" });
    }
    if (event.type === "agent_settled") finishRun(state, run);
    if (event.type === "response" && event.command === "prompt" && event.success === false) {
      run.error = event.error || "PI_PROMPT_REJECTED";
      finishRun(state, run);
    }
  }
}

function finishRun(state, run) {
  if (!["queued", "running"].includes(run.status)) return;
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
  if (!["queued", "running"].includes(run.status)) return false;
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
  const files = (await readdir(RUN_DIR).catch(() => [])).filter((name) => name.endsWith(".json")).slice(-MAX_RUNS);
  for (const file of files) {
    try {
      const restored = JSON.parse(await readFile(join(RUN_DIR, file), "utf8"));
      const run = { ...restored, events: [], subscribers: new Set(), startedAtMs: Date.parse(restored.created_at || restored.createdAt) || Date.now() };
      run.clientRunId = restored.client_run_id || restored.clientRunId;
      run.sessionId = restored.session_id || restored.sessionId;
      run.createdAt = restored.created_at || restored.createdAt;
      run.updatedAt = restored.updated_at || restored.updatedAt;
      if (["queued", "running"].includes(run.status)) {
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
  const state = sessions.get(sessionId) || createPiSession(sessionId, normalizeReasoningEffort(body.model_options));
  if (state.pendingRunId) return json(response, 409, { error: "PI_SESSION_BUSY" });
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
    events: [],
    subscribers: new Set(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
  };
  runs.set(run.id, run);
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  state.pendingRunId = run.id;
  emit(run, { type: "run.created" });
  await persistRun(run);
  const prompt = normalizePrompt(body.input, body.instructions);
  state.child.stdin.write(`${JSON.stringify({ id: run.clientRunId, type: "prompt", message: prompt })}\n`);
  return json(response, 202, publicRun(run));
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
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
      features: { run_submission: true, run_status: true, run_events_sse: true, run_stop: true, tool_progress_events: true, approval_events: false, run_approval_response: false, session_resources: false },
      endpoints: { sessions: "/api/sessions", runs: "/v1/runs" },
    });
  }
  if (request.method === "POST" && url.pathname === "/api/sessions") {
    return json(response, 201, { id: randomUUID(), runtime: "pi" });
  }
  if (request.method === "GET" && url.pathname === "/v1/runs") {
    return json(response, 200, { data: [...runs.values()].map(publicRun), runs: [...runs.values()].map(publicRun) });
  }
  if (request.method === "POST" && url.pathname === "/v1/runs") {
    return createRun(request, response, await readJson(request));
  }
  const match = url.pathname.match(/^\/v1\/runs\/([A-Za-z0-9_.:-]{8,160})(?:\/(events|stop))?$/);
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
    if (request.method === "GET" && match[2] === "events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      let sequence = 0;
      for (const event of run.events) sendSse(response, event, ++sequence);
      if (!["queued", "running"].includes(run.status)) return response.end();
      const subscriber = (event) => {
        sendSse(response, event, ++sequence);
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

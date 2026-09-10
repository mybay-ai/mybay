import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { EventEmitter } from "node:events";

const ACTIVE = new Set(["queued", "running", "waiting_for_approval"]);
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{8,160}$/.test(value);
const fail = (code, statusCode = 400) => Object.assign(Error(code), { statusCode });
const safeModel = value => typeof value === "string" && value.length <= 160
  && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
  && !/(?:sk-|api[_-]?key|secret|password|token)/i.test(value) ? value : undefined;
const safeUsageInteger = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function contextUsage(tokenUsage) {
  const contextTokens = safeUsageInteger(tokenUsage?.last?.totalTokens);
  const contextWindow = safeUsageInteger(tokenUsage?.modelContextWindow);
  const ratio = contextTokens !== undefined && contextWindow > 0 ? (contextTokens / contextWindow) * 100 : undefined;
  return {
    context_tokens: contextTokens,
    context_window: contextWindow,
    context_percent: Number.isFinite(ratio) && ratio >= 0 && ratio <= 100 ? Math.round(ratio * 100) / 100 : undefined,
  };
}

export function approvalDecision(method, choice, availableDecisions) {
  if (!["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(method)) throw fail("CODEX_APPROVAL_UNSUPPORTED");
  // Native session grants differ between item types. Expose only exact one-shot decisions for now.
  const decision = choice === "deny" && Array.isArray(availableDecisions) && !availableDecisions.includes("decline") && availableDecisions.includes("cancel")
    ? "cancel" : { once: "accept", deny: "decline" }[choice];
  if (!decision || (Array.isArray(availableDecisions) && !availableDecisions.includes(decision))) throw fail("CODEX_APPROVAL_SCOPE_UNSUPPORTED");
  return { decision };
}

export function fileMetadata(workspace, filePath, kind) {
  if (typeof filePath !== "string") return {};
  const rel = relative(resolve(workspace), resolve(workspace, filePath)).replaceAll("\\", "/");
  if (!rel || isAbsolute(rel) || rel.split("/").some(p => !p || p === ".." || p === "." || p === ".git")
    || ([...rel].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || /[:%?#*<>|"`$]/.test(rel)) || rel.length > 220) return {};
  return { path: `/opt/data/workspace/${rel}`, operation: kind === "add" ? "write" : kind === "delete" ? "delete" : "edit" };
}

export class CodexRuntime extends EventEmitter {
  constructor({ rpc, dataDir, workspace, model, externalSandbox = false }) {
    super(); this.rpc = rpc; this.dataDir = dataDir; this.workspace = resolve(workspace); this.model = model;
    this.externalSandbox = externalSandbox;
    this.pendingDeltas = new Map(); this.deltaTimer = null;
    this.runs = new Map(); this.sessions = new Map(); this.loaded = new Set(); this.queue = Promise.resolve();
    rpc.on("message", message => {
      if (message.method === "item/agentMessage/delta" && typeof message.params?.delta === "string") {
        const p = message.params; const key = JSON.stringify([p.threadId, p.turnId, p.itemId]);
        const pending = this.pendingDeltas.get(key);
        if (pending) pending.params.delta += p.delta;
        else this.pendingDeltas.set(key, { ...message, params: { ...p } });
        if (!this.deltaTimer) this.deltaTimer = setTimeout(() => this.flushDeltas(), 100);
      } else {
        this.flushDeltas();
        this.enqueue(() => this.onMessage(message));
      }
    });
    rpc.on("closed", code => { this.flushDeltas(); this.enqueue(async () => {
      for (const run of this.runs.values()) if (ACTIVE.has(run.status)) await this.finish(run, "failed", code);
    }); });
  }
  flushDeltas() {
    clearTimeout(this.deltaTimer); this.deltaTimer = null;
    for (const message of this.pendingDeltas.values()) this.enqueue(() => this.onMessage(message));
    this.pendingDeltas.clear();
  }
  enqueue(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(error => { if (!error.statusCode) this.emit("persistenceError"); });
    return result;
  }
  async initialize() {
    await mkdir(this.dataDir, { recursive: true }); await mkdir(this.workspace, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(join(this.dataDir, "state.json"), "utf8"));
      for (const session of saved.sessions || []) if (safeId(session.id)) this.sessions.set(session.id, session);
      for (const run of saved.runs || []) if (safeId(run.id)) {
        run.approvals = {}; this.runs.set(run.id, run);
        // A process restart cannot preserve an outstanding native turn or approval.
        // Retain identity and partial output, and fail explicitly rather than replaying side effects.
        if (ACTIVE.has(run.status)) { run.status = "failed"; run.error = "CODEX_BRIDGE_RESTARTED"; run.events.push({ type: "run.failed", error: run.error, run_id: run.id }); }
      }
    } catch (error) { if (error.code !== "ENOENT") throw fail("CODEX_STATE_INVALID", 500); }
    await this.rpc.initialize(); await this.persist();
  }
  async persist() {
    const target = join(this.dataDir, "state.json");
    await writeFile(`${target}.tmp`, JSON.stringify({ sessions: [...this.sessions.values()], runs: [...this.runs.values()] }), { mode: 0o600 });
    await rename(`${target}.tmp`, target);
  }
  async createSession() {
    const session = { id: "codex-v2-" + randomUUID(), threadId: null };
    this.sessions.set(session.id, session); await this.persist(); return session;
  }
  publicRun(run) {
    return { id: run.id, run_id: run.id, client_run_id: run.clientRunId, session_id: run.sessionId,
      native_thread_id: run.threadId, native_turn_id: run.turnId, status: run.status, output: run.output,
      error: run.error || undefined, usage: run.usage, model: run.model, stop_requested: run.stopRequested,
      created_at: run.createdAt, updated_at: run.updatedAt };
  }
  async emitEvent(run, event) {
    const item = { ...event, run_id: run.id, timestamp: Date.now() / 1000 };
    run.events.push(item); run.updatedAt = new Date().toISOString();
    await this.persist(); this.emit("event", run.id, item, run.events.length);
  }
  async submit(body, key) {
    if (!safeId(body.session_id) || !this.sessions.has(body.session_id)) throw fail("SESSION_NOT_FOUND", 404);
    if (key && !safeId(key)) throw fail("INVALID_IDEMPOTENCY_KEY");
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const existing = key && [...this.runs.values()].find(r => r.clientRunId === key);
    if (existing) {
      if (existing.sessionId !== body.session_id || existing.fingerprint !== fingerprint) throw fail("IDEMPOTENCY_CONFLICT", 409);
      return existing;
    }
    if ([...this.runs.values()].some(r => r.sessionId === body.session_id && ACTIVE.has(r.status))) throw fail("CODEX_SESSION_BUSY", 409);
    if (this.runs.size >= 200) throw fail("CODEX_RUN_CAPACITY", 429);
    if (!(typeof body.input === "string" || Array.isArray(body.input))) throw fail("INVALID_INPUT");
    const session = this.sessions.get(body.session_id);
    const run = { id: randomUUID(), clientRunId: key || randomUUID(), fingerprint, sessionId: body.session_id,
      status: "queued", output: "", model: safeModel(this.model) || safeModel(session.model), threadId: null, turnId: null,
      stopRequested: false, approvals: {}, events: [], messages: {}, usageBaseline: this.sessions.get(body.session_id).tokenTotals || {}, createdAt: new Date().toISOString() };
    this.runs.set(run.id, run); await this.emitEvent(run, { type: "run.created" });
    // Queue mutation before awaiting RPC; notifications must never deadlock behind a pending response.
    void this.start(run, body).catch(error => this.enqueue(() => this.finish(run, "failed", error.message.startsWith("CODEX_") ? error.message : "CODEX_DISPATCH_FAILED")));
    return run;
  }
  async start(run, body) {
    const session = this.sessions.get(run.sessionId);
    const options = { cwd: this.workspace, model: this.model, approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "workspace-write" };
    if (!session.threadId) {
      const result = await this.rpc.request("thread/start", { ...options, developerInstructions: String(body.instructions || "") || undefined });
      if (!safeId(result?.thread?.id)) throw fail("CODEX_THREAD_INVALID");
      await this.enqueue(async () => {
        session.threadId = result.thread.id; session.model = safeModel(result.model) || safeModel(result.thread?.model) || run.model;
        this.loaded.add(session.id); run.threadId = session.threadId; run.model = session.model; await this.persist();
      });
    } else if (!this.loaded.has(session.id)) {
      const result = await this.rpc.request("thread/resume", { ...options, threadId: session.threadId, developerInstructions: String(body.instructions || "") || undefined });
      if (result?.thread?.id !== session.threadId) throw fail("CODEX_THREAD_MISMATCH");
      session.model = safeModel(result.model) || safeModel(result.thread?.model) || run.model;
      run.model = session.model; this.loaded.add(session.id);
    }
    await this.enqueue(async () => { run.threadId = session.threadId; await this.persist(); });
    if (run.stopRequested) return this.enqueue(() => this.finish(run, "cancelled"));
    const text = typeof body.input === "string" ? body.input : body.input.map(m => `[${String(m.role || "user")}]\n${String(m.content || "")}`).join("\n\n");
    const requestedEffort = body.model_options?.reasoning_effort;
    const effort = this.model?.startsWith("deepseek-v4-")
      ? (["low", "high", "max"].includes(requestedEffort) ? requestedEffort : "high")
      : (["low", "medium", "high"].includes(requestedEffort) ? requestedEffort : "medium");
    const result = await this.rpc.request("turn/start", { threadId: session.threadId, input: [{ type: "text", text }], effort,
      ...(this.externalSandbox ? { sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" } } : {}) });
    await this.enqueue(async () => {
      if (!safeId(result?.turn?.id)) throw fail("CODEX_TURN_INVALID");
      if (run.turnId && run.turnId !== result.turn.id) throw fail("CODEX_TURN_MISMATCH");
      run.turnId = result.turn.id; await this.persist();
      if (run.stopRequested && ACTIVE.has(run.status)) void this.interrupt(run);
    });
  }
  async interrupt(run) {
    try { await this.rpc.request("turn/interrupt", { threadId: run.threadId, turnId: run.turnId }); }
    catch { await this.enqueue(async () => { run.error = "CODEX_STOP_UNCONFIRMED"; await this.persist(); }); }
  }
  async stop(run) {
    if (!ACTIVE.has(run.status)) return run;
    run.stopRequested = true; await this.persist();
    if (run.turnId) void this.interrupt(run);
    return run;
  }
  async approve(run, body) {
    if (!ACTIVE.has(run.status)) throw fail("CODEX_RUN_TERMINAL", 409);
    if (body.resolve_all) throw fail("CODEX_APPROVAL_SCOPE_UNSUPPORTED");
    const approval = run.approvals[body.approval_id];
    if (!approval) throw fail("CODEX_APPROVAL_NOT_FOUND", 404);
    const decision = approvalDecision(approval.method, body.choice, approval.availableDecisions);
    this.rpc.respond(approval.id, decision); delete run.approvals[body.approval_id];
    run.status = Object.keys(run.approvals).length ? "waiting_for_approval" : "running";
    await this.emitEvent(run, { type: "approval.responded", approval_id: body.approval_id, choice: body.choice });
    return run;
  }
  async finish(run, status, error) {
    if (!ACTIVE.has(run.status)) return;
    run.status = status; run.error = error; run.approvals = {};
    if (run.tokenTotals) this.sessions.get(run.sessionId).tokenTotals = run.tokenTotals;
    await this.emitEvent(run, { type: `run.${status}`, output: run.output, error, usage: run.usage, model: run.model });
  }
  async onMessage(message) {
    const p = message.params || {};
    const run = [...this.runs.values()].find(r => r.threadId === p.threadId && ACTIVE.has(r.status));
    if (!run || (run.turnId && p.turnId && run.turnId !== p.turnId)) {
      if (message.id !== undefined) this.rpc.send({ id: message.id, error: { code: -32602, message: "No matching active MyBay run" } });
      return;
    }
    if (message.method === "turn/started") {
      if (run.turnId && run.turnId !== p.turn?.id) return;
      run.turnId = p.turn?.id; run.status = "running"; await this.emitEvent(run, { type: "run.started" });
      if (run.stopRequested) void this.interrupt(run);
    } else if (message.id !== undefined) {
      if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) {
        const id = randomUUID();
        run.approvals[id] = { id: message.id, method: message.method, availableDecisions: p.availableDecisions };
        run.status = "waiting_for_approval";
        await this.emitEvent(run, { type: "approval.request", approval_id: id,
          tool: message.method.includes("commandExecution") ? "shell" : "edit", description: String(p.command || p.reason || "Codex requests permission for file changes").slice(0, 1000), choices: ["once", "deny"] });
      } else {
        // Unknown native requests are never auto-approved or left silently waiting.
        this.rpc.send({ id: message.id, error: { code: -32601, message: "Native request not supported by this MyBay Runtime" } });
        run.stopRequested = true; await this.persist(); if (run.turnId) void this.interrupt(run);
      }
    } else if (message.method === "item/agentMessage/delta" && typeof p.delta === "string") {
      run.messages[p.itemId] = (run.messages[p.itemId] || "") + p.delta;
      run.output += p.delta; await this.emitEvent(run, { type: "message.delta", delta: p.delta });
    } else if (["item/started", "item/completed"].includes(message.method)) {
      const item = p.item || {}; const completed = message.method === "item/completed";
      if (item.type === "agentMessage" && completed && typeof item.text === "string") {
        const seen = run.messages[item.id] || "";
        if (item.text.startsWith(seen) && item.text.length > seen.length) {
          const delta = item.text.slice(seen.length); run.output += delta; run.messages[item.id] = item.text;
          await this.emitEvent(run, { type: "message.delta", delta });
        }
      }
      if (["commandExecution", "fileChange", "mcpToolCall"].includes(item.type)) {
        const changes = item.type === "fileChange" ? (item.changes || []).map((c, i) => ({ id: `${item.id}:${i}`, tool: "edit", ...fileMetadata(this.workspace, c.path, c.kind?.type || c.kind) })) : [{ id: item.id, tool: item.type === "commandExecution" ? "shell" : "mcp" }];
        for (const change of changes) await this.emitEvent(run, { type: completed ? "tool.completed" : "tool.started", tool_call_id: change.id, tool: change.tool, path: change.path, operation: change.operation, success: completed ? item.status === "completed" : undefined, status: item.status === "completed" ? "completed" : completed ? "failed" : "running" });
      }
    } else if (message.method === "thread/tokenUsage/updated") {
      const u = p.tokenUsage?.total;
      if (u) {
        // Native releases differ on whether a resumed thread reports counters from zero or from
        // persisted history. Keep the durable baseline when counters continue, and reset it only
        // when the first observed cumulative total is genuinely smaller.
        if (safeUsageInteger(u.totalTokens) !== undefined && safeUsageInteger(run.usageBaseline.totalTokens) !== undefined
          && u.totalTokens < run.usageBaseline.totalTokens) run.usageBaseline = {};
        const delta = key => Number.isSafeInteger(u[key]) && u[key] >= (run.usageBaseline[key] || 0) ? u[key] - (run.usageBaseline[key] || 0) : undefined;
        run.tokenTotals = u;
        run.usage = { scope: "run", input_tokens: delta("inputTokens"), output_tokens: delta("outputTokens"), total_tokens: delta("totalTokens"),
          input_tokens_details: { cached_tokens: delta("cachedInputTokens") }, model: run.model, ...contextUsage(p.tokenUsage) };
        await this.persist();
      }
    } else if (message.method === "model/rerouted") {
      const model = safeModel(p.toModel);
      if (model) {
        run.model = model; this.sessions.get(run.sessionId).model = model;
        if (run.usage) run.usage.model = model;
        await this.persist();
      }
    } else if (message.method === "thread/settings/updated") {
      const model = safeModel(p.threadSettings?.model);
      if (model) {
        run.model = model; this.sessions.get(run.sessionId).model = model;
        if (run.usage) run.usage.model = model;
        await this.persist();
      }
    } else if (message.method === "turn/completed" && (!run.turnId || p.turn?.id === run.turnId)) {
      const status = p.turn?.status;
      await this.finish(run, status === "completed" ? "completed" : status === "interrupted" ? "cancelled" : "failed", status === "failed" ? (p.turn?.error?.codexErrorInfo === "unauthorized" ? "CODEX_AUTH_REQUIRED" : ["usageLimitExceeded", "rateLimitExceeded", "sessionBudgetExceeded"].includes(p.turn?.error?.codexErrorInfo) ? "CODEX_USAGE_LIMIT" : "CODEX_TURN_FAILED") : undefined);
    }
  }
}

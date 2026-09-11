import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexRuntime, approvalDecision, fileMetadata } from "./runtime.mjs";

class Rpc extends EventEmitter {
  calls = []; responses = [];
  async initialize() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "native-thread-1234" }, model: "gpt-6-astra" };
    if (method === "thread/resume") return { thread: { id: params.threadId }, model: "gpt-6-astra" };
    if (method === "turn/start") return { turn: { id: "native-turn-1234" } };
    return {};
  }
  respond(id, result) { this.responses.push({ id, result }); }
  send(value) { this.responses.push(value); }
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mybay-codex-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rpc = new Rpc();
  const runtime = new CodexRuntime({ rpc, dataDir: join(root, "data"), workspace: join(root, "workspace") });
  await runtime.initialize();
  const session = await runtime.enqueue(() => runtime.createSession());
  const run = await runtime.enqueue(() => runtime.submit({ session_id: session.id, input: "hello" }, "client-run-1234"));
  for (let i = 0; i < 30 && !run.turnId; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(run.turnId, "native-turn-1234");
  await runtime.queue;
  const event = (method, params = {}, id) => runtime.enqueue(() => runtime.onMessage({ method, id, params: { threadId: run.threadId, turnId: run.turnId, ...params } }));
  return { runtime, rpc, session, run, root, event };
}
test("native approval decisions never widen once/deny to persistent grants", () => {
  for (const method of ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"]) {
    assert.deepEqual(approvalDecision(method, "once"), { decision: "accept" });
    assert.deepEqual(approvalDecision(method, "deny"), { decision: "decline" });
    assert.deepEqual(approvalDecision(method, "deny", ["accept", "cancel"]), { decision: "cancel" });
    for (const choice of ["session", "always", "invalid"]) assert.throws(() => approvalDecision(method, choice));
    assert.throws(() => approvalDecision(method, "once", ["decline"]));
  }
});
test("file evidence stays inside workspace and excludes private paths", () => {
  assert.deepEqual(fileMetadata("/opt/data/workspace", "/opt/data/workspace/report.txt", "add"), { path: "/opt/data/workspace/report.txt", operation: "write" });
  for (const path of ["../codex/auth.json", "/etc/passwd", ".git/config", "private?token=secret"]) assert.deepEqual(fileMetadata("/opt/data/workspace", path, "add"), {});
});
test("stream, completion and cancellation preserve exact native identity", async t => {
  const { run, event, runtime } = await fixture(t);
  await event("item/agentMessage/delta", { itemId: "msg-1", delta: "hello" });
  await event("item/completed", { item: { type: "agentMessage", id: "msg-1", text: "hello world" } });
  assert.equal(run.output, "hello world");
  await event("turn/completed", { turn: { id: "wrong-turn", status: "completed" } });
  assert.equal(run.status, "queued");
  await runtime.enqueue(() => runtime.stop(run));
  assert.notEqual(run.status, "cancelled");
  await event("turn/completed", { turn: { id: run.turnId, status: "interrupted" } });
  assert.equal(run.status, "cancelled");
  await event("turn/completed", { turn: { id: run.turnId, status: "completed" } });
  assert.equal(run.status, "cancelled");
});
test("approval rejects wrong IDs, bulk grants and duplicate answers", async t => {
  const { run, event, runtime, rpc } = await fixture(t);
  await event("item/commandExecution/requestApproval", {}, 92);
  const id = Object.keys(run.approvals)[0];
  await assert.rejects(runtime.approve(run, { approval_id: "wrong", choice: "once" }));
  await assert.rejects(runtime.approve(run, { approval_id: id, choice: "once", resolve_all: true }));
  await runtime.enqueue(() => runtime.approve(run, { approval_id: id, choice: "deny" }));
  assert.deepEqual(rpc.responses[0], { id: 92, result: { decision: "decline" } });
  await assert.rejects(runtime.approve(run, { approval_id: id, choice: "once" }));
});
test("foreign turn events and unsupported native requests cannot approve a tool", async t => {
  const { run, event, rpc } = await fixture(t);
  await event("item/commandExecution/requestApproval", { turnId: "foreign-turn" }, 4);
  assert.equal(Object.keys(run.approvals).length, 0);
  assert.equal(rpc.responses[0].error.code, -32602);
  await event("item/permissions/requestApproval", {}, 5);
  assert.equal(rpc.responses[1].error.code, -32601);
  assert.equal(run.stopRequested, true);
});
test("idempotency rejects reuse across sessions or different inputs", async t => {
  const { runtime, session, run } = await fixture(t);
  assert.equal(await runtime.submit({ session_id: session.id, input: "hello" }, "client-run-1234"), run);
  await assert.rejects(runtime.submit({ session_id: session.id, input: "different" }, "client-run-1234"), /IDEMPOTENCY_CONFLICT/);
  const second = await runtime.enqueue(() => runtime.createSession());
  await assert.rejects(runtime.submit({ session_id: second.id, input: "hello" }, "client-run-1234"), /IDEMPOTENCY_CONFLICT/);
});
test("restart retains terminal evidence and resumes original session without replaying a turn", async t => {
  const { runtime, root, run, session } = await fixture(t);
  const nextRpc = new Rpc();
  const next = new CodexRuntime({ rpc: nextRpc, dataDir: join(root, "data"), workspace: join(root, "workspace") });
  await next.initialize();
  assert.equal(next.runs.get(run.id).status, "failed");
  assert.equal(next.runs.get(run.id).error, "CODEX_BRIDGE_RESTARTED");
  assert.equal(next.sessions.get(session.id).threadId, run.threadId);
  assert.equal(nextRpc.calls.length, 0);
  await next.enqueue(() => next.submit({ session_id: session.id, input: "continue" }, "client-next-1234"));
  for (let i = 0; i < 30 && !nextRpc.calls.some(c => c.method === "turn/start"); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(nextRpc.calls[0].method, "thread/resume");
  await next.queue; await runtime.queue;
});

test("batches token deltas without reordering completion", async t => {
  const { runtime, rpc, run } = await fixture(t);
  for (const delta of ["one", " ", "two"]) rpc.emit("message", { method: "item/agentMessage/delta", params: { threadId: run.threadId, turnId: run.turnId, itemId: "message-batch", delta } });
  rpc.emit("message", { method: "turn/completed", params: { threadId: run.threadId, turnId: run.turnId, turn: { id: run.turnId, status: "completed" } } });
  await runtime.queue;
  assert.equal(run.output, "one two");
  assert.equal(run.events.filter(e => e.type === "message.delta").length, 1);
  assert.equal(run.events.at(-1).type, "run.completed");
});

test("retains the effective native model and previous-turn context usage", async t => {
  const { run, session, event, runtime } = await fixture(t);
  assert.equal(run.model, "gpt-6-astra");
  assert.equal(session.model, "gpt-6-astra");
  await event("thread/tokenUsage/updated", { tokenUsage: {
    total: { inputTokens: 15254, cachedInputTokens: 12160, outputTokens: 6, totalTokens: 15260 },
    last: { inputTokens: 15254, cachedInputTokens: 12160, outputTokens: 6, totalTokens: 15260 },
    modelContextWindow: 258400,
  } });
  assert.deepEqual(run.usage, {
    scope: "run", input_tokens: 15254, output_tokens: 6, total_tokens: 15260,
    input_tokens_details: { cached_tokens: 12160 }, model: "gpt-6-astra",
    context_tokens: 15260, context_window: 258400, context_percent: 5.91,
  });
  await event("model/rerouted", { fromModel: "gpt-6-astra", toModel: "gpt-6-astra-fast", reason: "fallback" });
  assert.equal(run.model, "gpt-6-astra-fast");
  assert.equal(run.usage.model, "gpt-6-astra-fast");
  await event("turn/completed", { turn: { id: run.turnId, status: "completed" } });
  const next = await runtime.enqueue(() => runtime.submit({ session_id: session.id, input: "again" }, "client-run-next-1234"));
  assert.equal(next.model, "gpt-6-astra-fast");
  for (let i = 0; i < 30 && !next.turnId; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await runtime.queue;
  await runtime.enqueue(() => runtime.finish(next, "cancelled"));
});

test("subtracts persisted counters after resume and detects native counter resets", async t => {
  const { run, event } = await fixture(t);
  run.usageBaseline = { inputTokens: 100, cachedInputTokens: 60, outputTokens: 10, totalTokens: 110 };
  await event("thread/tokenUsage/updated", { tokenUsage: {
    total: { inputTokens: 140, cachedInputTokens: 80, outputTokens: 15, totalTokens: 155 },
    last: { inputTokens: 44, cachedInputTokens: 20, outputTokens: 5, totalTokens: 49 },
    modelContextWindow: 1000,
  } });
  assert.deepEqual(run.usage, {
    scope: "run", input_tokens: 40, output_tokens: 5, total_tokens: 45,
    input_tokens_details: { cached_tokens: 20 }, model: "gpt-6-astra",
    context_tokens: 49, context_window: 1000, context_percent: 4.9,
  });

  run.usageBaseline = { inputTokens: 200, cachedInputTokens: 120, outputTokens: 20, totalTokens: 220 };
  await event("thread/tokenUsage/updated", { tokenUsage: {
    total: { inputTokens: 40, cachedInputTokens: 10, outputTokens: 5, totalTokens: 45 },
    last: { inputTokens: 40, cachedInputTokens: 10, outputTokens: 5, totalTokens: 45 },
    modelContextWindow: 1000,
  } });
  assert.equal(run.usage.total_tokens, 45);
  assert.equal(run.usage.input_tokens, 40);
});

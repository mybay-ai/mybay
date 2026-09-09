import test from "node:test";
import assert from "node:assert/strict";
import { emit, flushPiDeltas } from "./server.mjs";

test("batches Pi deltas and flushes them before terminal delivery", () => {
  const received = [];
  const run = { id: "test-run", events: [], subscribers: new Set([(event, id) => received.push({ event, id })]) };
  for (let i = 0; i < 2000; i++) emit(run, { type: "message.delta", delta: "x" });
  assert.equal(received.length, 0);
  emit(run, { type: "run.completed" });
  assert.equal(received.length, 2);
  assert.equal(received[0].event.delta.length, 2000);
  assert.equal(received[1].event.type, "run.completed");
  assert.deepEqual(received.map(v => v.id), [1, 2]);
  flushPiDeltas(run);
  assert.equal(received.length, 2);
});

test("Pi replay sequence does not reset when the retained window rolls over", () => {
  const run = { id: "test-run", events: [], subscribers: new Set() };
  for (let i = 0; i < 750; i++) emit(run, { type: "tool.started", tool_call_id: String(i) });
  assert.equal(run.events.length, 500);
  assert.equal(run.eventSequence, 750);
  assert.equal(run.eventSequence - run.events.length + 1, 251);
  emit(run, { type: "run.completed" });
  assert.equal(run.eventSequence, 751);
});
import { PI_BRIDGE_FEATURES, applyPiSessionEvidence, applyPiThinkingLevel, approvalPolicySnapshot, assistantText, cancelActiveRun, instructionsForPiTurn, normalizePiEvent, normalizePrompt, normalizeReasoningEffort, piCompactionFailureStatus, requestPiCompaction, revokeAlwaysApprovedTool, safeToolMetadata, selectPiSession } from "./server.mjs";

test("advertises the managed attachment and generated-file contract", () => {
  assert.equal(PI_BRIDGE_FEATURES.chat_attachments, true);
  assert.equal(PI_BRIDGE_FEATURES.persisted_workspace, true);
  assert.equal(PI_BRIDGE_FEATURES.generated_file_evidence, true);
  assert.equal(PI_BRIDGE_FEATURES.a2a_tools, true);
  assert.equal(PI_BRIDGE_FEATURES.managed_collaboration, true);
  assert.equal(PI_BRIDGE_FEATURES.structured_questions, true);
  assert.equal(PI_BRIDGE_FEATURES.approval_events, true);
  assert.equal(PI_BRIDGE_FEATURES.run_approval_response, true);
  assert.equal(PI_BRIDGE_FEATURES.session_context_usage, true);
  assert.equal(PI_BRIDGE_FEATURES.auto_compaction, true);
  assert.equal(PI_BRIDGE_FEATURES.manual_compaction, true);
  assert.equal(PI_BRIDGE_FEATURES.session_resources, false);
});

test("submits one native Pi compact RPC and rejects busy sessions", async () => {
  const writes = [];
  const state = { pendingRunId: null, pendingCompaction: null, child: { killed: false, stdin: { write: value => writes.push(JSON.parse(value)) } } };
  const pending = requestPiCompaction(state, 5_000);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, "compact");
  assert.match(writes[0].id, /^compact:/);
  clearTimeout(state.pendingCompaction.timer);
  state.pendingCompaction.resolve({ status: "completed", reason: "manual" });
  state.pendingCompaction = null;
  assert.deepEqual(await pending, { status: "completed", reason: "manual" });
  await assert.rejects(requestPiCompaction({ ...state, pendingRunId: "run-1" }), /PI_SESSION_BUSY/);
});

test("treats a small Pi session as a truthful compaction no-op", () => {
  assert.equal(piCompactionFailureStatus("Nothing to compact (session too small)"), "aborted");
  assert.equal(piCompactionFailureStatus("provider request failed"), "failed");
});

test("normalizes MyBay reasoning levels for Pi", () => {
  assert.equal(normalizeReasoningEffort({ reasoning_effort: "none" }), "off");
  assert.equal(normalizeReasoningEffort({ reasoning: { effort: "high" } }), "high");
  assert.equal(normalizeReasoningEffort({ reasoning_effort: "unexpected" }), "medium");
  assert.equal(normalizeReasoningEffort({ reasoning_effort: "minimal" }, "gemini-3.8-flash"), "low");
  assert.equal(normalizeReasoningEffort({ reasoning_effort: "max" }, "gemini-3.8-flash"), "high");
});

test("keeps an idle Pi session warm when the requested reasoning level changes", () => {
  const existing = { thinking: "medium", pendingRunId: null, child: { killed: false } };
  assert.equal(selectPiSession(existing, "pi-session-1234", "off", () => assert.fail("warm process must be reused")), existing);
});

test("keeps a busy Pi session stable until its active run settles", () => {
  const existing = { thinking: "medium", pendingRunId: "run-active", child: { killed: false, kill: () => assert.fail("busy process must not restart") } };
  assert.equal(selectPiSession(existing, "pi-session-1234", "off", () => assert.fail("busy process must not be replaced")), existing);
});

test("changes Pi thinking level through RPC only when needed", () => {
  const writes = [];
  const state = { thinking: "medium", child: { stdin: { write: value => writes.push(value) } } };
  assert.equal(applyPiThinkingLevel(state, "off"), true);
  assert.deepEqual(writes.map(line => JSON.parse(line)), [{ type: "set_thinking_level", level: "off" }]);
  assert.equal(state.thinking, "off");
  assert.equal(applyPiThinkingLevel(state, "off"), false);
  assert.equal(writes.length, 1);
});

test("preserves instructions and structured history in a Pi prompt", () => {
  const prompt = normalizePrompt([{ role: "assistant", content: "Earlier" }, { role: "user", content: "Continue" }], "Stay concise");
  assert.match(prompt, /<system-instructions>[\s\S]*Stay concise/);
  assert.match(prompt, /\[ASSISTANT\]\nEarlier/);
  assert.match(prompt, /\[USER\]\nContinue/);
});

test("injects unchanged system instructions only once per warm Pi process", () => {
  const state = { lastInstructions: null };
  assert.equal(instructionsForPiTurn(state, "  Stay concise  "), "Stay concise");
  assert.equal(instructionsForPiTurn(state, "Stay concise"), "");
  assert.equal(instructionsForPiTurn(state, "Use tools carefully"), "Use tools carefully");
  assert.equal(instructionsForPiTurn(state, ""), "");
});

test("maps Pi text and tool lifecycle events to MyBay Runtime events", () => {
  const run = { activeTools: new Map() };
  assert.deepEqual(normalizePiEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }, run), [{ type: "message.delta", delta: "hello" }]);
  const started = normalizePiEvent({ type: "tool_execution_start", toolCallId: "call-1", toolName: "write", args: { path: "report.txt", content: "private" } }, run)[0];
  assert.deepEqual(started, { type: "tool.started", tool: "write", title: "write", tool_call_id: "call-1", path: "/opt/data/workspace/report.txt", operation: "write", timestamp: started.timestamp });
  const completed = normalizePiEvent({ type: "tool_execution_end", toolCallId: "call-1", toolName: "write", result: { content: "private" }, isError: false }, run)[0];
  assert.deepEqual(completed, { type: "tool.completed", tool: "write", title: "write", tool_call_id: "call-1", path: "/opt/data/workspace/report.txt", operation: "write", status: "completed", is_error: false, timestamp: completed.timestamp });
  assert.equal(run.activeTools.size, 0);
});

test("records truthful Pi compaction and current context evidence", () => {
  const run = { usage: { totalTokens: 25 }, activeTools: new Map() };
  normalizePiEvent({ type: "compaction_start", reason: "threshold" }, run);
  assert.deepEqual(run.lastCompaction, { status: "running", reason: "threshold" });
  normalizePiEvent({
    type: "compaction_end",
    reason: "threshold",
    result: { tokensBefore: 111000, estimatedTokensAfter: 24000 },
    aborted: false,
  }, run);
  assert.deepEqual(applyPiSessionEvidence(run, {
    contextUsage: { tokens: 25000, contextWindow: 128000, percent: 19.53 },
  }), {
    totalTokens: 25,
    scope: "session",
    context_tokens: 25000,
    context_window: 128000,
    context_percent: 19.53,
    compaction_status: "completed",
    compaction_reason: "threshold",
    compaction_tokens_before: 111000,
    compaction_estimated_tokens_after: 24000,
  });
});

test("does not manufacture context or successful compaction evidence", () => {
  const run = { usage: {} };
  normalizePiEvent({ type: "compaction_end", reason: "overflow", result: null, aborted: true }, run);
  expectNoSecrets(applyPiSessionEvidence(run, { contextUsage: { tokens: "100", contextWindow: -1, percent: 101 } }));
  assert.deepEqual(run.usage, {
    scope: "session",
    context_tokens: null,
    context_window: null,
    context_percent: null,
    compaction_status: "aborted",
    compaction_reason: "overflow",
    compaction_tokens_before: null,
    compaction_estimated_tokens_after: null,
  });
});

function expectNoSecrets(value) {
  assert.equal(JSON.stringify(value).includes("PRIVATE"), false);
}

test("exposes only bounded workspace file metadata", () => {
  assert.deepEqual(safeToolMetadata("write", { path: "docs/report.md", content: "private" }), { path: "/opt/data/workspace/docs/report.md", operation: "write" });
  assert.deepEqual(safeToolMetadata("edit", { path: "/opt/data/workspace/report.txt", oldText: "private" }), { path: "/opt/data/workspace/report.txt", operation: "edit" });
  assert.deepEqual(safeToolMetadata("write", { path: "/opt/data/report.txt" }), { path: "/opt/data/report.txt", operation: "write" });
  assert.deepEqual(safeToolMetadata("bash", { path: "report.txt" }), {});
  assert.deepEqual(safeToolMetadata("write", { path: "../secret.txt" }), {});
  assert.deepEqual(safeToolMetadata("read", { path: "/opt/data/pi/sessions/private.jsonl" }), {});
});

test("extracts only assistant text blocks", () => {
  assert.equal(assistantText({ role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "visible" }] }), "visible");
  assert.equal(assistantText({ role: "user", content: "no" }), "");
});

test("cancels a queued run authoritatively before it can start", () => {
  const signals = [];
  const state = {
    pendingRunId: "run-queued",
    child: { kill: (signal) => { signals.push(signal); return true; }, stdin: { write: () => assert.fail("kill fallback should not run") } },
  };
  const run = {
    id: "run-queued", status: "queued", output: "", error: "", model: "test-model",
    stopRequested: false, events: [], subscribers: new Set(), startedAtMs: Date.now(), updatedAt: "",
  };
  assert.equal(cancelActiveRun(state, run), true);
  assert.equal(run.status, "cancelled");
  assert.equal(run.error, "CANCELLED_UPSTREAM");
  assert.equal(run.stopRequested, true);
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(run.events.at(-1).type, "run.cancelled");
  assert.equal(cancelActiveRun(state, run), false);
});

test("lists and revokes only guarded persistent approval tools", () => {
  const policy = new Set(["write", "bash", "read"]);
  assert.deepEqual(approvalPolicySnapshot(policy), {
    version: 1,
    alwaysApprovedTools: ["bash", "write"],
    guardedTools: ["bash", "edit", "powershell", "write"],
  });
  assert.deepEqual(revokeAlwaysApprovedTool("WRITE", policy), { ok: true, tool: "write", revoked: true });
  assert.equal(policy.has("write"), false);
  assert.deepEqual(revokeAlwaysApprovedTool("read", policy), { ok: false, error: "INVALID_APPROVAL_TOOL" });
});

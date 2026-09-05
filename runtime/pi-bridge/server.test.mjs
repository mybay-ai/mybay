import test from "node:test";
import assert from "node:assert/strict";
import { assistantText, cancelActiveRun, normalizePiEvent, normalizePrompt, normalizeReasoningEffort, safeToolMetadata } from "./server.mjs";

test("normalizes MyBay reasoning levels for Pi", () => {
  assert.equal(normalizeReasoningEffort({ reasoning_effort: "none" }), "off");
  assert.equal(normalizeReasoningEffort({ reasoning: { effort: "high" } }), "high");
  assert.equal(normalizeReasoningEffort({ reasoning_effort: "unexpected" }), "medium");
});

test("preserves instructions and structured history in a Pi prompt", () => {
  const prompt = normalizePrompt([{ role: "assistant", content: "Earlier" }, { role: "user", content: "Continue" }], "Stay concise");
  assert.match(prompt, /<system-instructions>[\s\S]*Stay concise/);
  assert.match(prompt, /\[ASSISTANT\]\nEarlier/);
  assert.match(prompt, /\[USER\]\nContinue/);
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

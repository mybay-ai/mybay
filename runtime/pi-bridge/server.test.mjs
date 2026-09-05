import test from "node:test";
import assert from "node:assert/strict";
import { assistantText, normalizePiEvent, normalizePrompt, normalizeReasoningEffort } from "./server.mjs";

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
  const run = {};
  assert.deepEqual(normalizePiEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }, run), [{ type: "message.delta", delta: "hello" }]);
  assert.match(normalizePiEvent({ type: "tool_execution_start", toolName: "read" }, run)[0].type, /tool\.started/);
  assert.equal(normalizePiEvent({ type: "tool_execution_end", toolName: "read", isError: false }, run)[0].status, "completed");
});

test("extracts only assistant text blocks", () => {
  assert.equal(assistantText({ role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "visible" }] }), "visible");
  assert.equal(assistantText({ role: "user", content: "no" }), "");
});

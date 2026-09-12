import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { CodexQuestionBridge, normalizeCodexQuestion, questionBridgeConfig } from "./question-bridge.mjs";

test("accepts only an authenticated instance-scoped question bridge", () => {
  assert.deepEqual(questionBridgeConfig({
    MYBAY_QUESTION_BRIDGE_URL: "http://mybay-local-control-panel:3000/internal/questions/instance-1",
    MYBAY_QUESTION_BRIDGE_TOKEN: "a".repeat(64),
  }), { url: "http://mybay-local-control-panel:3000/internal/questions/instance-1", token: "a".repeat(64) });
  assert.equal(questionBridgeConfig({ MYBAY_QUESTION_BRIDGE_URL: "https://attacker.invalid/questions", MYBAY_QUESTION_BRIDGE_TOKEN: "a".repeat(64) }), null);
});

test("normalizes native options without accepting secret or malformed questions", () => {
  const question = normalizeCodexQuestion({ id: "region", header: "Region", question: "Where?", isOther: true,
    options: [{ label: "EU", description: "European Union" }] });
  assert.deepEqual(question.spec, { title: "Region\nWhere?", multiple: false, allowCustom: true,
    options: [{ id: "option_1", label: "EU — European Union" }] });
  assert.throws(() => normalizeCodexQuestion({ id: "secret", header: "Token", question: "Paste token", isSecret: true }), /CODEX_SECRET_QUESTION_UNSUPPORTED/);
  assert.throws(() => normalizeCodexQuestion({ id: "__proto__", header: "Unsafe", question: "Choose", options: [] }), /CODEX_QUESTION_INVALID/);
});

test("round-trips a selected native answer through the local Run question API", async t => {
  let polls = 0; let posted;
  const server = http.createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    if (request.method === "POST") posted = JSON.parse(body);
    const payload = request.method === "POST"
      ? { success: true, question: { status: "pending" } }
      : { success: true, question: ++polls > 0 ? { status: "answered", answer: { selected: ["option_1"], custom: "" } } : { status: "pending" } };
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const bridge = new CodexQuestionBridge({ url: `http://127.0.0.1:${server.address().port}/internal/questions/instance`, token: "b".repeat(64) }, { sleep: async () => {}, now: (() => { let value = 0; return () => ++value; })() });
  const answer = await bridge.ask("session-1234", { id: "region", header: "Region", question: "Where?", isOther: false,
    options: [{ label: "EU", description: "European Union" }] }, undefined, "question-1234");
  assert.deepEqual(posted, { runtimeType: "codex", sessionId: "session-1234", id: "question-1234",
    spec: { title: "Region\nWhere?", multiple: false, allowCustom: false, options: [{ id: "option_1", label: "EU — European Union" }] } });
  assert.deepEqual(answer, { id: "region", answers: ["EU"] });
});

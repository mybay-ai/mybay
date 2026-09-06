import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import register, { askUser } from "./mybay-question-extension.mjs";

const spec = { title: "Choose", multiple: false, allowCustom: false, options: [{ id: "pass", label: "Pass" }] };

test("registers ask_user only with a bounded authenticated bridge configuration", () => {
  const previous = { ...process.env };
  try {
    const tools = [];
    process.env.MYBAY_QUESTION_BRIDGE_URL = "http://controller:3000/internal/questions/instance";
    process.env.MYBAY_QUESTION_BRIDGE_TOKEN = "a".repeat(64);
    process.env.MYBAY_PI_SESSION_ID = "session-1234";
    register({ registerTool: tool => tools.push(tool) });
    assert.deepEqual(tools.map(tool => tool.name), ["ask_user"]);
    process.env.MYBAY_QUESTION_BRIDGE_URL = "https://attacker.invalid/questions";
    register({ registerTool: () => assert.fail("unsafe bridge must not register") });
  } finally {
    for (const key of ["MYBAY_QUESTION_BRIDGE_URL", "MYBAY_QUESTION_BRIDGE_TOKEN", "MYBAY_PI_SESSION_ID"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test("waits for and returns the persisted user answer", async () => {
  let polls = 0;
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${"b".repeat(64)}`);
    if (request.method === "POST") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const payload = JSON.parse(raw);
      assert.equal(payload.runtimeType, "pi");
      assert.equal(payload.sessionId, "session-1234");
      response.end(JSON.stringify({ success: true, question: { id: payload.id, spec, status: "pending" } }));
      return;
    }
    polls += 1;
    response.end(JSON.stringify({ success: true, question: { id: "question-1234", spec, status: "answered", answer: { selected: ["pass"], custom: "" } } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const output = await askUser({ url: `http://127.0.0.1:${port}/internal/questions/instance`, token: "b".repeat(64), sessionId: "session-1234" }, spec, undefined, { questionId: "question-1234", sleep: async () => {}, now: (() => { let value = 0; return () => ++value; })() });
    assert.equal(polls, 1);
    assert.deepEqual(JSON.parse(output.content[0].text).answer.selected, ["pass"]);
    assert.deepEqual(output.details, { questionId: "question-1234", status: "answered" });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

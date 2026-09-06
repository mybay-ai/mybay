import test from "node:test";
import assert from "node:assert/strict";
import register, { approvalSummary, requestApproval } from "./mybay-approval-extension.mjs";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("registers a tool_call guard only with local authenticated configuration", () => {
  const previous = { ...process.env };
  try {
    let handler;
    process.env.MYBAY_PI_APPROVAL_BRIDGE_URL = "http://127.0.0.1:8080/internal/approvals";
    process.env.MYBAY_PI_APPROVAL_BRIDGE_TOKEN = "a".repeat(64);
    process.env.MYBAY_PI_SESSION_ID = "session-1234";
    register({ on: (event, callback) => { assert.equal(event, "tool_call"); handler = callback; } });
    assert.equal(typeof handler, "function");
    process.env.MYBAY_PI_APPROVAL_BRIDGE_URL = "http://attacker.invalid/internal/approvals";
    register({ on: () => assert.fail("non-loopback approval bridge must not register") });
  } finally {
    for (const key of ["MYBAY_PI_APPROVAL_BRIDGE_URL", "MYBAY_PI_APPROVAL_BRIDGE_TOKEN", "MYBAY_PI_SESSION_ID"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test("guards mutating tools without exposing write content", () => {
  assert.deepEqual(approvalSummary({ toolName: "write", input: { path: "report.md", content: "secret" } }), {
    toolName: "write", title: "Pi 请求执行 write", description: "将通过 write 修改文件：report.md",
  });
  assert.equal(approvalSummary({ toolName: "bash", input: { command: "echo ok" } }).command, "echo ok");
});

test("implements once, deny, and session approval decisions", async () => {
  const config = { url: "http://127.0.0.1:8080/internal/approvals", token: "b".repeat(64), sessionId: "session-1234" };
  const event = { toolCallId: "call-1234", toolName: "write", input: { path: "report.md", content: "secret" } };
  const seen = [];
  const sessionApprovals = new Set();
  const once = await requestApproval(config, event, undefined, sessionApprovals, async (_url, init) => { seen.push(JSON.parse(init.body)); return response({ success: true, choice: "once" }); });
  assert.equal(once, undefined);
  assert.equal(seen[0].content, undefined);
  const denied = await requestApproval(config, event, undefined, sessionApprovals, async () => response({ success: true, choice: "deny" }));
  assert.equal(denied.block, true);
  await requestApproval(config, event, undefined, sessionApprovals, async () => response({ success: true, choice: "session" }));
  await requestApproval(config, event, undefined, sessionApprovals, async () => assert.fail("session approval must bypass future prompts"));
});

test("does not prompt for read-only tools", async () => {
  const result = await requestApproval(
    { url: "http://127.0.0.1:8080/internal/approvals", token: "c".repeat(64), sessionId: "session-1234" },
    { toolCallId: "call-1234", toolName: "read", input: { path: "report.md" } },
    undefined,
    new Set(),
    async () => assert.fail("read must not request approval"),
  );
  assert.equal(result, undefined);
});

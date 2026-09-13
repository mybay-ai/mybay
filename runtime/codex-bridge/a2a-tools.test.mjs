import test from "node:test";
import assert from "node:assert/strict";
import { executeA2ATool, readConfiguredPeers } from "./a2a-tools.mjs";

const peers = readConfiguredPeers(JSON.stringify([{ id: "reviewer-1", name: "Reviewer", url: "http://relay.internal/a2a", token: "secret", capabilities: ["review"] }]));

test("configured peer metadata is bounded and list output never exposes credentials", async () => {
  assert.equal(peers.length, 1);
  const result = await executeA2ATool(peers, "a2a_list", {});
  assert.equal(result.success, true);
  assert.match(result.text, /reviewer-1/);
  assert.doesNotMatch(result.text, /secret|relay\.internal/);
  assert.deepEqual(readConfiguredPeers("not-json"), []);
});

test("A2A call binds bearer, RPC and collaboration context exactly", async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = { headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.body.id, result: {
      id: "remote-task-1", contextId: "ctx-room", status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [{ parts: [{ kind: "text", text: "review complete" }] }],
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await executeA2ATool(peers, "a2a_call", { agent: "reviewer-1", message: "Review this", context_id: "ctx-room" }, undefined, fetchImpl);
  assert.equal(result.success, true);
  assert.match(result.text, /review complete/);
  assert.equal(request.headers.Authorization, "Bearer secret");
  assert.equal(request.body.method, "message/send");
  assert.equal(request.body.params.message.contextId, "ctx-room");
});

test("unknown tools, extra arguments and mismatched responses fail closed", async () => {
  await assert.rejects(executeA2ATool(peers, "unknown", {}), /A2A_TOOL_UNSUPPORTED/);
  await assert.rejects(executeA2ATool(peers, "a2a_call", { agent: "reviewer-1", message: "x", extra: true }), /A2A_ARGUMENT_INVALID/);
  await assert.rejects(executeA2ATool(peers, "a2a_orchestrate", { task: "x", mode: "unsafe" }), /A2A_ARGUMENT_INVALID/);
  await assert.rejects(executeA2ATool(peers, "a2a_call", { agent: "reviewer-1", message: "x", context_id: "ctx-room" }, undefined,
    async (_url, options) => new Response(JSON.stringify({ id: JSON.parse(options.body).id, result: { id: "remote", contextId: "wrong", status: { state: "TASK_STATE_COMPLETED" } } }))), /A2A_RESPONSE_MISMATCH/);
});

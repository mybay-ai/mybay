import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import myBayA2AExtension, { callPeer, readConfiguredPeers } from "./mybay-a2a-extension.mjs";

test("accepts only bounded authenticated peer configuration", () => {
  const peers = readConfiguredPeers(JSON.stringify([
    { id: "peer-1", name: "Reviewer", url: "http://peer:3000/a2a", token: "secret", capabilities: ["review"] },
    { id: "../bad", name: "Bad", url: "file:///tmp/x", token: "secret" },
  ]));
  assert.deepEqual(peers, [{ id: "peer-1", name: "Reviewer", url: "http://peer:3000/a2a", token: "secret", capabilities: ["review"] }]);
});

test("calls a peer with bearer auth and preserves terminal task evidence", async () => {
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    assert.equal(request.headers.authorization, "Bearer secret");
    assert.equal(rpc.method, "message/send");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {
      id: "remote-task", contextId: rpc.params.message.contextId,
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [{ parts: [{ kind: "text", text: "peer result" }] }],
    } }));
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    const result = await callPeer({ id: "peer-1", name: "Reviewer", url: `http://127.0.0.1:${address.port}`, token: "secret", capabilities: [] }, "review", "ctx-room", undefined);
    assert.deepEqual(result, { taskId: "remote-task", contextId: "ctx-room", state: "completed", text: "peer result" });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("registers the three collaboration tools without exposing credentials", async () => {
  const previous = process.env.MYBAY_A2A_PEERS_JSON;
  process.env.MYBAY_A2A_PEERS_JSON = JSON.stringify([{ id: "peer-1", name: "Reviewer", url: "http://peer/a2a", token: "secret", capabilities: ["review"] }]);
  const tools = new Map();
  try {
    myBayA2AExtension({ registerTool: (tool) => tools.set(tool.name, tool) });
    assert.deepEqual([...tools.keys()], ["a2a_list", "a2a_call", "a2a_orchestrate"]);
    const listed = await tools.get("a2a_list").execute();
    assert.match(listed.content[0].text, /Reviewer \(peer-1\)/);
    assert.doesNotMatch(JSON.stringify(listed), /secret|http:\/\/peer/);
  } finally {
    if (previous === undefined) delete process.env.MYBAY_A2A_PEERS_JSON;
    else process.env.MYBAY_A2A_PEERS_JSON = previous;
  }
});

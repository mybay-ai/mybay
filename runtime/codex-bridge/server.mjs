import release from "./release.json" with { type: "json" };
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServer } from "./app-server.mjs";
import { CodexRuntime } from "./runtime.mjs";

export const CODEX_BRIDGE_FEATURES = Object.freeze({
  run_submission: true, run_status: true, run_events_sse: true, run_stop: true,
  tool_progress_events: true, chat_attachments: true, persisted_workspace: true,
  generated_file_evidence: true, approval_events: true, run_approval_response: true,
  structured_questions: false, a2a_tools: false, managed_collaboration: false,
  session_context_usage: true, manual_compaction: false, session_resources: false,
});

function json(response, code, payload) {
  response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}
async function readBody(request) {
  let bytes = 0; const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw Object.assign(Error("BODY_TOO_LARGE"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(Error("INVALID_JSON"), { statusCode: 400 }); }
}
export async function startServer(options = {}) {
  const env = options.env || process.env;
  const apiKey = env.CODEX_BRIDGE_API_KEY;
  if (!apiKey || apiKey.length < 24) throw Error("CODEX_BRIDGE_API_KEY_MISSING");
  const dataDir = resolve(env.CODEX_BRIDGE_DATA_DIR || "/opt/data/codex-bridge");
  const workspace = resolve(env.CODEX_WORKSPACE_DIR || "/opt/data/workspace");
  const codexHome = resolve(env.CODEX_HOME || "/opt/data/codex");
  const rpc = options.rpc || new CodexAppServer({
    command: env.CODEX_CLI_PATH || process.execPath,
    args: env.CODEX_CLI_PATH ? [] : [join(dirname(fileURLToPath(import.meta.url)), "node_modules/@openai/codex/bin/codex.js")],
    cwd: dirname(fileURLToPath(import.meta.url)), env: { ...env, CODEX_HOME: codexHome },
  });
  const runtime = new CodexRuntime({ rpc, dataDir, workspace, model: env.CODEX_MODEL || undefined, externalSandbox: env.CODEX_EXTERNAL_SANDBOX === "true" });
  try { await runtime.initialize(); } catch (error) { rpc.close(); throw error; }
  const expected = Buffer.from(`Bearer ${apiKey}`);
  async function handle(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && ["/health", "/api/health"].includes(url.pathname)) return json(response, rpc.closed ? 503 : 200, { ok: !rpc.closed, runtime: "codex", version: release.nativeVersion, bridgeVersion: release.bridgeVersion });
    const supplied = Buffer.from(String(request.headers.authorization || ""));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(response, 401, { error: "UNAUTHORIZED" });
    if (request.method === "GET" && url.pathname === "/v1/capabilities") {
      const account = env.CODEX_AUTH_MODE === "api" ? { account: null } : await rpc.request("account/read", { refreshToken: false });
      const ready = env.CODEX_AUTH_MODE === "api" ? Boolean(env.MYBAY_CODEX_PROVIDER_KEY) : Boolean(account.account);
      return json(response, 200, { runtime: "codex", auth_ready: ready, features: { ...CODEX_BRIDGE_FEATURES, run_submission: ready }, endpoints: { sessions: "/api/sessions", runs: "/v1/runs" } });
    }
    if (request.method === "POST" && url.pathname === "/api/sessions") return json(response, 201, await runtime.enqueue(() => runtime.createSession()));
    if (request.method === "GET" && url.pathname === "/v1/runs") return json(response, 200, { data: [...runtime.runs.values()].map(r => runtime.publicRun(r)) });
    if (request.method === "POST" && url.pathname === "/v1/runs") {
      const body = await readBody(request);
      const run = await runtime.enqueue(() => runtime.submit(body, request.headers["idempotency-key"]));
      return json(response, 202, runtime.publicRun(run));
    }
    const match = url.pathname.match(/^\/v1\/runs\/([A-Za-z0-9_.:-]{8,160})(?:\/(events|stop|approval))?$/);
    if (!match || !runtime.runs.has(match[1])) return json(response, 404, { error: "RUN_NOT_FOUND" });
    const run = runtime.runs.get(match[1]);
    if (request.method === "GET" && !match[2]) return json(response, 200, runtime.publicRun(run));
    if (request.method === "POST" && match[2] === "stop") return json(response, 202, runtime.publicRun(await runtime.enqueue(() => runtime.stop(run))));
    if (request.method === "POST" && match[2] === "approval") {
      const body = await readBody(request);
      return json(response, 200, runtime.publicRun(await runtime.enqueue(() => runtime.approve(run, body))));
    }
    if (request.method === "GET" && match[2] === "events") {
      const cursor = Number(request.headers["last-event-id"] || 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > run.events.length) return json(response, 400, { error: "INVALID_EVENT_CURSOR" });
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
      const send = (event, id) => response.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
      for (let i = cursor; i < run.events.length; i++) send(run.events[i], i + 1);
      if (["completed", "failed", "cancelled"].includes(run.status)) return response.end();
      const listener = (id, event, sequence) => {
        if (id !== run.id) return;
        send(event, sequence);
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) response.end();
      };
      runtime.on("event", listener);
      const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15000);
      response.on("close", () => { clearInterval(heartbeat); runtime.off("event", listener); });
      return;
    }
    return json(response, 404, { error: "NOT_FOUND" });
  }
  const server = http.createServer((request, response) => {
    void handle(request, response).catch(error => {
      if (!response.headersSent) json(response, error.statusCode || 500, { error: error.statusCode ? error.message : "CODEX_BRIDGE_FAILED" });
      else response.destroy();
    });
  });
  runtime.on("persistenceError", () => { rpc.close(); });
  server.on("close", () => rpc.close());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(Number(env.PORT || 8080), env.HOST || "0.0.0.0", resolve); });
  return { server, runtime, rpc };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, rpc } = await startServer();
  const stop = () => { rpc.close(); server.close(); server.closeAllConnections(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  console.log("[Codex Runtime Bridge] ready");
}

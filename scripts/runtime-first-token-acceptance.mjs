#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: process.env.MYBAY_ENV_FILE || ".env", quiet: true });

function readArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inline] = token.slice(2).split("=", 2);
    const following = argv[index + 1];
    const next = inline ?? (!following || following.startsWith("--") ? "true" : argv[++index]);
    values[rawKey] = next;
  }
  return values;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

const args = readArgs(process.argv.slice(2));
if (args.help === "true") {
  console.log("Usage: node scripts/runtime-first-token-acceptance.mjs --runtime pi|codex --instance <uuid> [--base-url http://127.0.0.1:3000] [--rounds 5] [--topology shared-session|new-session] [--output path]");
  process.exit(0);
}

const runtime = String(args.runtime || "").trim().toLowerCase();
const instanceId = String(args.instance || "").trim();
const baseUrl = String(args["base-url"] || "http://127.0.0.1:3000").replace(/\/$/, "");
const rounds = Math.max(1, Math.min(20, Number.parseInt(args.rounds || "5", 10) || 5));
const topology = args.topology === "new-session" ? "new-session" : "shared-session";
const username = process.env.LOCAL_ADMIN_USERNAME || "admin";
const password = process.env.LOCAL_ADMIN_PASSWORD;

if (!new Set(["pi", "codex"]).has(runtime)) throw new Error("--runtime must be pi or codex");
if (!/^[0-9a-f-]{36}$/i.test(instanceId)) throw new Error("--instance must be a UUID");
if (!password) throw new Error("LOCAL_ADMIN_PASSWORD is required in the environment or local .env file");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(route, init = {}, cookie) {
  const headers = new Headers(init.headers);
  headers.set("origin", baseUrl);
  if (init.body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(baseUrl + route, { ...init, headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { invalidJson: true }; }
  if (!response.ok) throw new Error(`${init.method || "GET"} ${route} -> ${response.status}: ${JSON.stringify(body)}`);
  return { response, body };
}

async function login() {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const cookie = result.response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Login did not return a session cookie");
  return cookie;
}

function parseFrame(raw) {
  if (!raw.trim() || raw.startsWith(":")) return null;
  let event = "message";
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

async function captureRun(cookie, runId, requestStartedAt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const response = await fetch(`${baseUrl}/api/instances/${instanceId}/runs/${runId}/events`, {
    headers: { cookie, origin: baseUrl, accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) throw new Error(`SSE stream unavailable: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstFeedbackMs = null;
  let firstTextMs = null;
  let textEventCount = 0;
  let terminalStatus = null;
  try {
    while (!terminalStatus) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replaceAll("\r\n", "\n");
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = parseFrame(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
        if (!frame) continue;
        const elapsed = Math.round(performance.now() - requestStartedAt);
        firstFeedbackMs ??= elapsed;
        if (frame.event === "text" && frame.data) {
          firstTextMs ??= elapsed;
          textEventCount += 1;
        } else if (frame.event === "status") {
          try {
            const status = JSON.parse(frame.data)?.status;
            if (["completed", "failed", "cancelled", "stopped", "expired"].includes(status)) terminalStatus = status;
          } catch {
            // Non-JSON status frames cannot establish a terminal state.
          }
        }
      }
      if (done) break;
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }
  return { firstFeedbackMs, firstTextMs, textEventCount, terminalStatus };
}

async function waitForRun(cookie, runId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const run = (await request(`/api/instances/${instanceId}/runs/${runId}`, {}, cookie)).body.run;
    if (["completed", "failed", "cancelled", "stopped", "expired"].includes(run.status)) return run;
    await sleep(250);
  }
  throw new Error(`Run timed out: ${runId}`);
}

async function createConversation(cookie, suffix) {
  const result = await request(`/api/instances/${instanceId}/conversations`, {
    method: "POST",
    body: JSON.stringify({ title: `Latency acceptance ${runtime} ${suffix} ${new Date().toISOString()}` }),
  }, cookie);
  const conversationId = result.body.conversation?.id || result.body.id;
  if (!conversationId) throw new Error("Conversation creation failed");
  return conversationId;
}

const cookie = await login();
let conversationId = await createConversation(cookie, "shared");
const samples = [];
for (let index = 0; index < rounds; index += 1) {
  if (topology === "new-session" && index > 0) conversationId = await createConversation(cookie, `new-${index + 1}`);
  const effort = index % 2 === 0 ? "fast" : "balanced";
  const marker = `LATENCY-${runtime.toUpperCase()}-${index + 1}-${crypto.randomBytes(4).toString("hex")}`;
  const requestStartedAt = performance.now();
  const accepted = await request(`/api/instances/${instanceId}/runs`, {
    method: "POST",
    body: JSON.stringify({
      conversationId,
      requestId: crypto.randomUUID(),
      reasoningEffort: effort,
      content: `Do not use tools. Reply immediately with exactly ${marker} and nothing else.`,
    }),
  }, cookie);
  const acceptedAt = performance.now();
  const runId = accepted.body.runId;
  const streamed = await captureRun(cookie, runId, requestStartedAt);
  const final = await waitForRun(cookie, runId);
  samples.push({
    index: index + 1,
    runId,
    conversationId,
    effort,
    acceptMs: Math.round(acceptedAt - requestStartedAt),
    ...streamed,
    totalMs: Math.round(performance.now() - requestStartedAt),
    finalStatus: final.status,
    exactOutput: String(final.partialOutput || final.partial_output || "").trim() === marker,
  });
  await sleep(750);
}

const result = {
  schemaVersion: 1,
  artifactType: "runtime-first-token-acceptance",
  capturedAt: new Date().toISOString(),
  target: { runtime, instanceId, baseUrl, topology },
  summary: {
    runs: samples.length,
    passed: samples.filter(sample => sample.finalStatus === "completed" && sample.exactOutput).length,
    acceptMedianMs: percentile(samples.map(sample => sample.acceptMs), 0.5),
    acceptP95Ms: percentile(samples.map(sample => sample.acceptMs), 0.95),
    firstFeedbackMedianMs: percentile(samples.map(sample => sample.firstFeedbackMs).filter(Number.isFinite), 0.5),
    firstTextMedianMs: percentile(samples.map(sample => sample.firstTextMs).filter(Number.isFinite), 0.5),
    firstTextP95Ms: percentile(samples.map(sample => sample.firstTextMs).filter(Number.isFinite), 0.95),
  },
  samples,
  containsSecrets: false,
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (args.output) {
  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
}
process.stdout.write(serialized);

import { randomUUID } from "node:crypto";
import { Type } from "typebox";

const MAX_RESPONSE_BYTES = 32 * 1024;
const POLL_INTERVAL_MS = 1_000;
const QUESTION_TIMEOUT_MS = 300_000;

function bridgeConfig(env = process.env) {
  const url = String(env.MYBAY_QUESTION_BRIDGE_URL || "").trim();
  const token = String(env.MYBAY_QUESTION_BRIDGE_TOKEN || "").trim();
  const sessionId = String(env.MYBAY_PI_SESSION_ID || "").trim();
  if (!/^http:\/\/[A-Za-z0-9_.-]+:\d+\/internal\/questions\/[A-Za-z0-9_-]{1,80}$/.test(url)
    || !/^[a-f0-9]{64}$/.test(token)
    || !/^[A-Za-z0-9_.:-]{8,160}$/.test(sessionId)) return null;
  return { url, token, sessionId };
}

async function boundedJson(response) {
  if (!response.body) throw new Error("QUESTION_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("QUESTION_RESPONSE_LIMIT");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(text);
}

async function request(config, method, suffix, body, signal) {
  const response = await fetch(`${config.url}${suffix}`, {
    method,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000),
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await boundedJson(response);
  if (!response.ok || payload?.success !== true) throw Object.assign(new Error(payload?.error || `QUESTION_HTTP_${response.status}`), { status: response.status });
  return payload.question;
}

function result(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

export async function askUser(config, spec, signal, options = {}) {
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const questionId = options.questionId || randomUUID();
  let question = await request(config, "POST", "", {
    runtimeType: "pi", sessionId: config.sessionId, id: questionId, spec,
  }, signal);
  const started = now();
  while (now() - started < QUESTION_TIMEOUT_MS) {
    if (question.status === "answered") return result(JSON.stringify({ status: "answered", answer: question.answer, question: question.spec }), { questionId, status: "answered" });
    if (question.status === "rejected" || question.status === "expired") return result(JSON.stringify({ status: question.status, message: "No answer was accepted. Do not invent a user choice." }), { questionId, status: question.status });
    await sleep(POLL_INTERVAL_MS);
    try {
      const query = new URLSearchParams({ runtimeType: "pi", sessionId: config.sessionId });
      question = await request(config, "GET", `/${questionId}?${query}`, null, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if ([401, 403, 404, 409, 410].includes(error?.status)) return result(JSON.stringify({ status: "expired", message: "The question or Run is no longer available." }), { questionId, status: "expired" });
    }
  }
  return result(JSON.stringify({ status: "expired", message: "The question timed out. Do not invent a user choice." }), { questionId, status: "expired" });
}

export default function register(pi) {
  const config = bridgeConfig();
  if (!config) return;
  pi.registerTool({
    name: "ask_user",
    label: "Ask user",
    description: "Ask the user one structured question and wait for the answer in this same task. Never invent an answer.",
    parameters: Type.Object({
      title: Type.String({ maxLength: 2_000 }),
      multiple: Type.Boolean(),
      allowCustom: Type.Boolean(),
      options: Type.Array(Type.Object({ id: Type.String({ pattern: "^[A-Za-z0-9_-]{1,40}$" }), label: Type.String({ maxLength: 200 }) }), { maxItems: 8 }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params, signal) => askUser(config, params, signal),
  });
}

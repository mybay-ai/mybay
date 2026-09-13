import { randomUUID } from "node:crypto";

const MAX_RESPONSE_BYTES = 32 * 1024;
const QUESTION_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1_000;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const hasUnsafeControlCharacter = value => [...value].some(character => {
  const code = character.charCodeAt(0);
  return code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
});

function boundedText(value, maximum) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum
    || hasUnsafeControlCharacter(value)) throw Error("CODEX_QUESTION_INVALID");
  return value.trim();
}

export function questionBridgeConfig(env = process.env) {
  const url = String(env.MYBAY_QUESTION_BRIDGE_URL || "").trim();
  const token = String(env.MYBAY_QUESTION_BRIDGE_TOKEN || "").trim();
  if (!/^http:\/\/[A-Za-z0-9_.-]+:\d+\/internal\/questions\/[A-Za-z0-9_-]{1,80}$/.test(url)
    || !/^[a-f0-9]{64}$/.test(token)) return null;
  return { url, token };
}

export function normalizeCodexQuestion(input) {
  if (!input || typeof input !== "object" || !SAFE_ID.test(String(input.id || ""))
    || ["__proto__", "constructor", "prototype"].includes(String(input.id)) || input.isSecret === true) {
    throw Error(input?.isSecret === true ? "CODEX_SECRET_QUESTION_UNSUPPORTED" : "CODEX_QUESTION_INVALID");
  }
  const header = boundedText(input.header, 80);
  const question = boundedText(input.question, 1_919);
  if (input.options !== null && input.options !== undefined && !Array.isArray(input.options)) throw Error("CODEX_QUESTION_INVALID");
  const options = (input.options || []).map((option, index) => {
    if (!option || typeof option !== "object") throw Error("CODEX_QUESTION_INVALID");
    const label = boundedText(option.label, 200);
    const description = boundedText(option.description, 500);
    return { id: `option_${index + 1}`, label: `${label} — ${description}`.slice(0, 200).trim(), answer: label };
  });
  if (options.length > 8 || new Set(options.map(option => option.answer)).size !== options.length) throw Error("CODEX_QUESTION_INVALID");
  const allowCustom = input.isOther === true || options.length === 0;
  if (options.length === 0 && !allowCustom) throw Error("CODEX_QUESTION_INVALID");
  return {
    nativeId: input.id,
    spec: { title: `${header}\n${question}`, multiple: false, allowCustom, options: options.map(({ id, label }) => ({ id, label })) },
    optionAnswers: new Map(options.map(({ id, answer }) => [id, answer])),
  };
}

async function boundedJson(response) {
  if (!response.body) throw Error("CODEX_QUESTION_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = ""; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw Error("CODEX_QUESTION_RESPONSE_LIMIT");
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
  const timeout = AbortSignal.timeout(6_000);
  const response = await fetch(`${config.url}${suffix}`, {
    method,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await boundedJson(response);
  if (!response.ok || payload?.success !== true) throw Object.assign(Error(payload?.error || `CODEX_QUESTION_HTTP_${response.status}`), { status: response.status });
  return payload.question;
}

export class CodexQuestionBridge {
  constructor(config, options = {}) {
    this.config = config;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  async ask(sessionId, input, signal, questionId = randomUUID()) {
    const normalized = normalizeCodexQuestion(input);
    let question = await request(this.config, "POST", "", {
      runtimeType: "codex", sessionId, id: questionId, spec: normalized.spec,
    }, signal);
    const started = this.now();
    while (this.now() - started < QUESTION_TIMEOUT_MS) {
      if (question.status === "answered") {
        const selected = question.answer?.selected || [];
        const answers = selected.map(id => normalized.optionAnswers.get(id)).filter(Boolean);
        if (question.answer?.custom) answers.push(question.answer.custom);
        return { id: normalized.nativeId, answers };
      }
      if (["rejected", "expired"].includes(question.status)) return { id: normalized.nativeId, answers: [] };
      await this.sleep(POLL_INTERVAL_MS);
      const query = new URLSearchParams({ runtimeType: "codex", sessionId });
      try { question = await request(this.config, "GET", `/${questionId}?${query}`, null, signal); }
      catch (error) {
        if (signal?.aborted) throw error;
        if ([401, 403, 404, 409, 410].includes(error?.status)) return { id: normalized.nativeId, answers: [] };
      }
    }
    return { id: normalized.nativeId, answers: [] };
  }
}

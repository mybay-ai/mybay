import { randomUUID } from "node:crypto";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const SAFE_CONTEXT = /^[-A-Za-z0-9]{1,160}$/;

function text(value, max) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) throw new Error("A2A_ARGUMENT_INVALID");
  return normalized;
}

function optionalText(value, max) {
  if (value === undefined || value === null || value === "") return "";
  return text(value, max);
}

function plainArguments(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("A2A_ARGUMENT_INVALID");
  }
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("A2A_ARGUMENT_INVALID");
  }
  return value;
}

export function readConfiguredPeers(raw = process.env.MYBAY_A2A_PEERS_JSON || "") {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 64) return [];
    return parsed.map(peer => ({
      id: optionalText(peer?.id, 160),
      name: optionalText(peer?.name, 80),
      url: optionalText(peer?.url, 2_000),
      token: optionalText(peer?.token, 1_000),
      capabilities: Array.isArray(peer?.capabilities)
        ? peer.capabilities.map(value => optionalText(value, 64)).filter(Boolean).slice(0, 8)
        : [],
    })).filter(peer => /^[A-Za-z0-9-]{1,160}$/.test(peer.id) && /^https?:\/\//.test(peer.url) && peer.token);
  } catch {
    return [];
  }
}

function resolvePeer(peers, requested) {
  const key = text(requested, 160).toLowerCase();
  const matches = peers.filter(peer => peer.id.toLowerCase() === key || peer.name.toLowerCase() === key);
  if (matches.length !== 1) throw new Error(matches.length ? "A2A_AGENT_AMBIGUOUS" : "A2A_AGENT_NOT_CONFIGURED");
  return matches[0];
}

async function boundedJson(response) {
  if (!response.body) throw new Error("A2A_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("A2A_RESPONSE_LIMIT");
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(body);
}

function taskText(task) {
  const artifacts = Array.isArray(task?.artifacts) ? task.artifacts : [];
  const parts = artifacts.flatMap(artifact => Array.isArray(artifact?.parts) ? artifact.parts : []);
  const artifactText = parts.map(part => optionalText(part?.text, 16_000)).filter(Boolean).join("\n");
  const statusParts = Array.isArray(task?.status?.message?.parts) ? task.status.message.parts : [];
  return artifactText || statusParts.map(part => optionalText(part?.text, 16_000)).filter(Boolean).join("\n") || "No text result returned.";
}

function normalizedState(task) {
  return String(task?.status?.state || "").trim().slice(0, 80).replace(/^TASK_STATE_/, "").toLowerCase().replaceAll("_", "-");
}

export async function callPeer(peer, message, contextId, signal, fetchImpl = fetch) {
  const rpcId = randomUUID();
  const combinedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)])
    : AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const response = await fetchImpl(peer.url, {
    method: "POST", redirect: "error", signal: combinedSignal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${peer.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "message/send", params: {
      message: { role: "user", contextId, messageId: randomUUID(), parts: [{ kind: "text", text: text(message, 32_000) }] },
    } }),
  });
  const rpc = await boundedJson(response).catch(error => {
    if (!response.ok) throw new Error(`A2A_HTTP_${response.status}`);
    throw error;
  });
  if (!response.ok) throw new Error(`A2A_HTTP_${response.status}`);
  if (rpc?.id !== rpcId || rpc?.error) throw new Error(rpc?.error ? optionalText(rpc.error.message || `A2A_RPC_${rpc.error.code}`, 1_000) : "A2A_RESPONSE_MISMATCH");
  const task = rpc?.result?.task || rpc?.result;
  if (!task?.id || task.contextId !== contextId) throw new Error("A2A_RESPONSE_MISMATCH");
  const state = normalizedState(task);
  if (!["completed", "input-required", "auth-required"].includes(state)) {
    throw new Error(`A2A_TASK_${state || "unknown"}`.toUpperCase().replaceAll("-", "_"));
  }
  return { taskId: String(task.id), contextId, state, text: taskText(task) };
}

export const A2A_DYNAMIC_TOOLS = Object.freeze([
  { type: "function", name: "a2a_list", description: "List trusted MyBay Agents available for authenticated A2A collaboration.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { type: "function", name: "a2a_call", description: "Send one task to a configured trusted MyBay Agent. Use an Agent ID from a2a_list.", inputSchema: { type: "object", additionalProperties: false, required: ["agent", "message"], properties: {
    agent: { type: "string", minLength: 1, maxLength: 160 }, message: { type: "string", minLength: 1, maxLength: 32_000 }, context_id: { type: "string", minLength: 1, maxLength: 160 },
  } } },
  { type: "function", name: "a2a_orchestrate", description: "Delegate a task to trusted MyBay Agents, optionally selecting them by capability.", inputSchema: { type: "object", additionalProperties: false, required: ["task"], properties: {
    task: { type: "string", minLength: 1, maxLength: 32_000 }, capability: { type: "string", minLength: 1, maxLength: 64 }, mode: { type: "string", enum: ["all", "first", "best"] }, context_id: { type: "string", minLength: 1, maxLength: 160 },
  } } },
]);

function contextId(value) {
  if (value && !SAFE_CONTEXT.test(value)) throw new Error("A2A_ARGUMENT_INVALID");
  return value || `ctx-${randomUUID()}`;
}

export async function executeA2ATool(peers, name, rawArguments, signal, fetchImpl = fetch) {
  const args = plainArguments(rawArguments);
  if (name === "a2a_list") {
    if (Object.keys(args).length) throw new Error("A2A_ARGUMENT_INVALID");
    if (!peers.length) return { success: true, text: "No trusted A2A Agents are configured." };
    const lines = peers.map(peer => `- ${peer.name} (${peer.id})${peer.capabilities.length ? `: ${peer.capabilities.join(", ")}` : ""}`);
    return { success: true, text: `Configured A2A agents:\n${lines.join("\n")}` };
  }
  if (name === "a2a_call") {
    if (Object.keys(args).some(key => !["agent", "message", "context_id"].includes(key))) throw new Error("A2A_ARGUMENT_INVALID");
    const peer = resolvePeer(peers, args.agent);
    const context = contextId(optionalText(args.context_id, 160));
    const response = await callPeer(peer, text(args.message, 32_000), context, signal, fetchImpl);
    return { success: true, text: `[${peer.id} · context ${context}]\n${response.text}` };
  }
  if (name === "a2a_orchestrate") {
    if (Object.keys(args).some(key => !["task", "capability", "mode", "context_id"].includes(key))) throw new Error("A2A_ARGUMENT_INVALID");
    if (args.mode !== undefined && !["all", "first", "best"].includes(args.mode)) throw new Error("A2A_ARGUMENT_INVALID");
    const capability = optionalText(args.capability, 64).toLowerCase();
    const selected = capability ? peers.filter(peer => peer.capabilities.some(item => item.toLowerCase() === capability)) : peers;
    if (!selected.length) throw new Error("A2A_AGENT_NOT_CONFIGURED");
    const context = contextId(optionalText(args.context_id, 160));
    const mode = ["first", "best"].includes(args.mode) ? args.mode : "all";
    const outcomes = [];
    for (const peer of selected) {
      try {
        const response = await callPeer(peer, text(args.task, 32_000), context, signal, fetchImpl);
        outcomes.push({ peerId: peer.id, success: true, text: response.text });
        if (mode === "first") break;
      } catch (error) {
        outcomes.push({ peerId: peer.id, success: false, text: `Error: ${String(error?.message || error).slice(0, 1_000)}` });
      }
    }
    return { success: outcomes.some(outcome => outcome.success), text: `Orchestrated '${capability || "all"}' to ${outcomes.length} peer(s):\n\n${outcomes.map(outcome => `--- ${outcome.peerId} ---\n${outcome.text}`).join("\n\n")}` };
  }
  throw new Error("A2A_TOOL_UNSUPPORTED");
}

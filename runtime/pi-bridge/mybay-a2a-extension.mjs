import { randomUUID } from "node:crypto";
import { Type } from "typebox";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;

function bounded(value, max = 16_000) {
  return String(value ?? "").trim().slice(0, max);
}

export function readConfiguredPeers(raw = process.env.MYBAY_A2A_PEERS_JSON || "") {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((peer) => ({
      id: bounded(peer?.id, 160),
      name: bounded(peer?.name, 80),
      url: bounded(peer?.url, 2_000),
      token: bounded(peer?.token, 1_000),
      capabilities: Array.isArray(peer?.capabilities)
        ? peer.capabilities.map((value) => bounded(value, 64)).filter(Boolean).slice(0, 8)
        : [],
    })).filter((peer) => /^[A-Za-z0-9-]{1,160}$/.test(peer.id)
      && /^https?:\/\//.test(peer.url) && peer.token);
  } catch {
    return [];
  }
}

function resolvePeer(peers, requested) {
  const key = bounded(requested, 160).toLowerCase();
  const matches = peers.filter((peer) => peer.id.toLowerCase() === key || peer.name.toLowerCase() === key);
  if (matches.length !== 1) throw new Error(matches.length ? "A2A_AGENT_AMBIGUOUS" : "A2A_AGENT_NOT_CONFIGURED");
  return matches[0];
}

function combineSignal(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function boundedJson(response) {
  if (!response.body) throw new Error("A2A_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("A2A_RESPONSE_LIMIT");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(text);
}

function taskText(task) {
  const artifacts = Array.isArray(task?.artifacts) ? task.artifacts : [];
  const parts = artifacts.flatMap((artifact) => Array.isArray(artifact?.parts) ? artifact.parts : []);
  const artifactText = parts.map((part) => bounded(part?.text, 16_000)).filter(Boolean).join("\n");
  const statusParts = Array.isArray(task?.status?.message?.parts) ? task.status.message.parts : [];
  return artifactText || statusParts.map((part) => bounded(part?.text, 16_000)).filter(Boolean).join("\n") || "No text result returned.";
}

function normalizedState(task) {
  return bounded(task?.status?.state, 80).replace(/^TASK_STATE_/, "").toLowerCase().replaceAll("_", "-");
}

export async function callPeer(peer, message, contextId, signal) {
  const rpcId = randomUUID();
  const response = await fetch(peer.url, {
    method: "POST",
    redirect: "error",
    signal: combineSignal(signal),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${peer.token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: rpcId,
      method: "message/send",
      params: { message: { role: "user", contextId, messageId: randomUUID(), parts: [{ kind: "text", text: bounded(message, 32_000) }] } },
    }),
  });
  const rpc = await boundedJson(response).catch((error) => {
    if (!response.ok) throw new Error(`A2A_HTTP_${response.status}`);
    throw error;
  });
  if (!response.ok) throw new Error(`A2A_HTTP_${response.status}`);
  if (rpc?.id !== rpcId) throw new Error("A2A_RESPONSE_MISMATCH");
  if (rpc?.error) throw new Error(bounded(rpc.error.message || `A2A_RPC_${rpc.error.code}`, 1_000));
  const task = rpc?.result?.task || rpc?.result;
  if (!task?.id || task?.contextId !== contextId) throw new Error("A2A_RESPONSE_MISMATCH");
  const state = normalizedState(task);
  if (!["completed", "input-required", "auth-required"].includes(state)) {
    throw new Error(`A2A_TASK_${state || "unknown"}`.toUpperCase().replaceAll("-", "_"));
  }
  return { taskId: String(task.id), contextId, state, text: taskText(task) };
}

function result(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

export default function myBayA2AExtension(pi) {
  const peers = readConfiguredPeers();
  pi.registerTool({
    name: "a2a_list",
    label: "List trusted Agents",
    description: "List the trusted MyBay Agents that this Agent is allowed to call through authenticated A2A collaboration.",
    parameters: Type.Object({}),
    async execute() {
      if (!peers.length) return result("No trusted A2A Agents are configured.", { peers: [] });
      const lines = peers.map((peer) => `- ${peer.name} (${peer.id})${peer.capabilities.length ? `: ${peer.capabilities.join(", ")}` : ""}`);
      return result(`Configured A2A agents:\n${lines.join("\n")}`, { peers: peers.map(({ token, url, ...peer }) => peer) });
    },
  });

  pi.registerTool({
    name: "a2a_call",
    label: "Call trusted Agent",
    description: "Send one task to a configured trusted MyBay Agent. Use the Agent ID from a2a_list. Preserve a supplied collaboration context_id.",
    parameters: Type.Object({
      agent: Type.String({ description: "Configured Agent ID or exact display name" }),
      message: Type.String({ minLength: 1, description: "Task for the peer Agent" }),
      context_id: Type.Optional(Type.String({ description: "Existing A2A collaboration context ID" })),
    }),
    async execute(_toolCallId, params, signal) {
      const peer = resolvePeer(peers, params.agent);
      const contextId = /^[-A-Za-z0-9]{1,160}$/.test(params.context_id || "") ? params.context_id : `ctx-${randomUUID()}`;
      try {
        const response = await callPeer(peer, params.message, contextId, signal);
        return result(`[${peer.id} · context ${contextId}]\n${response.text}`, { peerId: peer.id, ...response });
      } catch (error) {
        return result(`Error: peer '${peer.id}' call failed: ${bounded(error?.message || error, 1_000)}`, { peerId: peer.id, contextId, state: "failed" });
      }
    },
  });

  pi.registerTool({
    name: "a2a_orchestrate",
    label: "Orchestrate trusted Agents",
    description: "Delegate a task to trusted MyBay Agents by capability. mode=all calls every matching Agent; mode=first stops after the first successful result.",
    parameters: Type.Object({
      capability: Type.Optional(Type.String({ description: "Optional capability tag used to select peers" })),
      task: Type.String({ minLength: 1, description: "Task sent to each selected Agent" }),
      mode: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("first"), Type.Literal("best")])),
      context_id: Type.Optional(Type.String({ description: "Existing A2A collaboration context ID" })),
    }),
    async execute(_toolCallId, params, signal) {
      const capability = bounded(params.capability, 64).toLowerCase();
      const selected = capability ? peers.filter((peer) => peer.capabilities.some((item) => item.toLowerCase() === capability)) : peers;
      if (!selected.length) return result(`Error: no configured peer matches capability '${capability || "any"}'.`, { peers: [] });
      const contextId = /^[-A-Za-z0-9]{1,160}$/.test(params.context_id || "") ? params.context_id : `ctx-${randomUUID()}`;
      const mode = params.mode === "first" || params.mode === "best" ? params.mode : "all";
      const outcomes = [];
      for (const peer of selected) {
        try {
          const response = await callPeer(peer, params.task, contextId, signal);
          outcomes.push({ peerId: peer.id, state: response.state, taskId: response.taskId, text: response.text });
          if (mode === "first") break;
        } catch (error) {
          outcomes.push({ peerId: peer.id, state: "failed", text: `Error: ${bounded(error?.message || error, 1_000)}` });
        }
      }
      const text = `Orchestrated '${capability || "all"}' to ${outcomes.length} peer(s):\n\n${outcomes.map((item) => `--- ${item.peerId} ---\n${item.text}`).join("\n\n")}`;
      return result(text, { contextId, mode, outcomes });
    },
  });
}

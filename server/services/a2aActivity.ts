import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sanitizeString } from "../utils/sanitizer";

const MAX_ACTIVITY_LIMIT = 50;
const MAX_FILE_BYTES = 256 * 1024;
const CONTEXT_FILE_PATTERN = /^ctx-[a-z0-9]+\.jsonl$/i;

type AuditRow = {
  ts?: number;
  direction?: "inbound" | "outbound";
  peer?: string;
  task_id?: string;
  summary?: string;
};

type ConversationRow = {
  ts?: number;
  role?: "user" | "agent";
  text?: string;
  task_id?: string;
};

export type A2AActivityStatus = "completed" | "in_progress" | "connection_failed" | "timed_out" | "agent_offline" | "auth_failed" | "cancelled" | "failed";

type OrchestrationOutcome = {
  mode: "all" | "first" | "best";
  finishedAt: string;
  peerErrors: Map<string, string>;
};

type DirectCallOutcome = {
  peerId: string;
  message: string;
  finishedAt: string;
  status: Exclude<A2AActivityStatus, "in_progress" | "cancelled">;
  failureReason: string | null;
  result: string | null;
};

export type A2AActivity = {
  contextId: string;
  taskId: string;
  direction: "inbound" | "outbound";
  peerId: string | null;
  peerName: string;
  status: A2AActivityStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  summary: string;
  result: string | null;
  failureReason: string | null;
};

export type A2AOrchestration = {
  contextId: string;
  status: "completed" | "partial" | "failed" | "in_progress";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  nodes: A2AActivity[];
};

function boundedText(value: unknown, max = 320): string {
  return sanitizeString(String(value || ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function readJsonLines(file: string): any[] {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size <= 0) return [];
    const start = Math.max(0, stat.size - MAX_FILE_BYTES);
    const length = stat.size - start;
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, start);
      const text = buffer.toString("utf8");
      const lines = text.split(/\r?\n/);
      if (start > 0) lines.shift();
      return lines.filter(Boolean).flatMap((line) => {
        try {
          const value = JSON.parse(line);
          return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
        } catch {
          return [];
        }
      });
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return [];
  }
}

function toIso(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJsonObject(value: unknown): any | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function classifyA2AFailure(value: unknown): Exclude<A2AActivityStatus, "completed" | "in_progress" | "cancelled"> {
  const text = String(value || "").toLowerCase();
  if (/timed?\s*out|timeout|etimedout/.test(text)) return "timed_out";
  if (/name or service not known|temporary failure in name resolution|getaddrinfo|enotfound|no route to host|host unreachable/.test(text)) return "agent_offline";
  if (/401|403|unauthori[sz]ed|forbidden|invalid.*token|auth(?:entication)? failed/.test(text)) return "auth_failed";
  if (/connection refused|econnrefused|connection reset|econnreset|connection aborted/.test(text)) return "connection_failed";
  return "failed";
}

function parsePeerErrors(output: string): Map<string, string> {
  const errors = new Map<string, string>();
  const sectionPattern = /^--- ([A-Za-z0-9-]{1,128}) ---\r?\n([\s\S]*?)(?=\r?\n--- |$)/gm;
  for (const match of output.matchAll(sectionPattern)) {
    const result = boundedText(match[2], 1000);
    if (/^error:/i.test(result)) errors.set(match[1], result);
  }
  const allFailedPattern = /^\s{2}([A-Za-z0-9-]{1,128}):\s*(Error:[^\r\n]*)/gmi;
  for (const match of output.matchAll(allFailedPattern)) errors.set(match[1], boundedText(match[2], 1000));
  return errors;
}

function readOrchestrationOutcomes(instanceRoot: string): Map<string, OrchestrationOutcome> {
  const outcomes = new Map<string, OrchestrationOutcome>();
  const stateDbPath = path.join(instanceRoot, "state.db");
  try {
    if (!fs.lstatSync(stateDbPath).isFile()) return outcomes;
    const db = new DatabaseSync(stateDbPath, { readOnly: true });
    try {
      const rows = db.prepare(`
        SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp
        FROM messages
        WHERE tool_name = 'a2a_orchestrate' OR tool_calls LIKE '%a2a_orchestrate%'
        ORDER BY id DESC
        LIMIT 200
      `).all().reverse() as any[];
      const invocations = new Map<string, { contextId: string; mode: "all" | "first" | "best" }>();
      for (const row of rows) {
        if (row.role !== "assistant" || typeof row.tool_calls !== "string") continue;
        let calls: any[] = [];
        try { calls = JSON.parse(row.tool_calls); } catch { continue; }
        for (const call of Array.isArray(calls) ? calls : []) {
          const fn = call?.function || {};
          const rawArgs = parseJsonObject(fn.arguments) || {};
          const direct = fn.name === "a2a_orchestrate" ? rawArgs : null;
          const wrapped = fn.name === "tool_call" && rawArgs.name === "a2a_orchestrate" ? parseJsonObject(rawArgs.arguments) || rawArgs.arguments : null;
          const args = direct || wrapped;
          const contextId = boundedText(args?.context_id, 160);
          const callId = boundedText(call?.id || call?.call_id, 160);
          if (!contextId || !callId) continue;
          const requestedMode = String(args?.mode || "all").toLowerCase();
          const mode = requestedMode === "first" || requestedMode === "best" ? requestedMode : "all";
          invocations.set(callId, { contextId, mode });
        }
      }
      for (const row of rows) {
        if (row.role !== "tool" || row.tool_name !== "a2a_orchestrate") continue;
        const invocation = invocations.get(boundedText(row.tool_call_id, 160));
        const finishedAt = toIso(row.timestamp);
        if (!invocation || !finishedAt) continue;
        outcomes.set(invocation.contextId, {
          mode: invocation.mode,
          finishedAt,
          peerErrors: parsePeerErrors(String(row.content || "")),
        });
      }
    } finally {
      db.close();
    }
  } catch {
    // Older Hermes versions or a concurrently locked state database simply
    // fall back to the append-only A2A activity files.
  }
  return outcomes;
}

function readDirectCallOutcomes(instanceRoot: string): DirectCallOutcome[] {
  const outcomes: DirectCallOutcome[] = [];
  const stateDbPath = path.join(instanceRoot, "state.db");
  try {
    if (!fs.lstatSync(stateDbPath).isFile()) return outcomes;
    const db = new DatabaseSync(stateDbPath, { readOnly: true });
    try {
      const rows = db.prepare(`
        SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp
        FROM messages
        WHERE tool_name = 'a2a_call' OR tool_calls LIKE '%a2a_call%'
        ORDER BY id DESC
        LIMIT 200
      `).all().reverse() as any[];
      const invocations = new Map<string, { peerId: string; message: string }>();
      for (const row of rows) {
        if (row.role !== "assistant" || typeof row.tool_calls !== "string") continue;
        let calls: any[] = [];
        try { calls = JSON.parse(row.tool_calls); } catch { continue; }
        for (const call of Array.isArray(calls) ? calls : []) {
          const fn = call?.function || {};
          const rawArgs = parseJsonObject(fn.arguments) || {};
          const direct = fn.name === "a2a_call" ? rawArgs : null;
          const wrapped = fn.name === "tool_call" && rawArgs.name === "a2a_call" ? parseJsonObject(rawArgs.arguments) || rawArgs.arguments : null;
          const args = direct || wrapped;
          const callId = boundedText(call?.id || call?.call_id, 160);
          const peerId = boundedText(args?.agent || args?.agent_id, 160);
          const message = boundedText(args?.message);
          if (callId && peerId && message) invocations.set(callId, { peerId, message });
        }
      }
      for (const row of rows) {
        if (row.role !== "tool" || row.tool_name !== "a2a_call") continue;
        const invocation = invocations.get(boundedText(row.tool_call_id, 160));
        const finishedAt = toIso(row.timestamp);
        if (!invocation || !finishedAt) continue;
        const output = boundedText(row.content, 1000);
        const failed = /^error:/i.test(output);
        outcomes.push({
          ...invocation,
          finishedAt,
          status: failed ? classifyA2AFailure(output) : "completed",
          failureReason: failed ? output : null,
          result: failed ? null : boundedText(output.replace(/^\[[^\r\n]+\]\r?\n/, "")),
        });
      }
    } finally {
      db.close();
    }
  } catch {
    // Direct-call activity remains readable from append-only files when the
    // native Hermes state database is unavailable or from an older version.
  }
  return outcomes;
}

function matchDirectCallOutcome(
  outcomes: DirectCallOutcome[],
  peerId: string | null,
  summary: string,
  startedAt: string,
): DirectCallOutcome | null {
  if (!peerId) return null;
  const startedAtMs = new Date(startedAt).getTime();
  const candidates = outcomes
    .filter((outcome) => outcome.peerId === peerId && outcome.message === summary)
    .map((outcome) => ({ outcome, distance: Math.abs(new Date(outcome.finishedAt).getTime() - startedAtMs) }))
    .filter(({ distance }) => distance <= 5 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance);
  return candidates[0]?.outcome || null;
}

export function readA2AActivities(options: {
  instanceId: string;
  limit?: number;
  peerNames?: Map<string, string>;
  peerIpToId?: Map<string, string>;
  trustedPeerIds?: string[];
  dataRoot?: string;
}): A2AActivity[] {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(options.instanceId)) return [];
  const limit = Math.min(MAX_ACTIVITY_LIMIT, Math.max(1, Math.floor(Number(options.limit) || 12)));
  const instanceRoot = path.resolve(options.dataRoot || path.resolve("data", "instances"), options.instanceId);
  const orchestrationOutcomes = readOrchestrationOutcomes(instanceRoot);
  const directCallOutcomes = readDirectCallOutcomes(instanceRoot);
  const auditRows = readJsonLines(path.join(instanceRoot, "a2a_audit.jsonl")) as AuditRow[];
  const auditByTask = new Map<string, AuditRow[]>();
  for (const row of auditRows) {
    const taskId = boundedText(row.task_id, 128);
    if (!taskId) continue;
    auditByTask.set(taskId, [...(auditByTask.get(taskId) || []), row]);
  }

  let files: fs.Dirent[] = [];
  try {
    files = fs.readdirSync(path.join(instanceRoot, "a2a_conversations"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && CONTEXT_FILE_PATTERN.test(entry.name));
  } catch {
    return [];
  }

  return files.flatMap((entry): A2AActivity[] => {
    const rows = readJsonLines(path.join(instanceRoot, "a2a_conversations", entry.name)) as ConversationRow[];
    const taskRows = new Map<string, ConversationRow[]>();
    for (const row of rows) {
      const taskId = boundedText(row.task_id, 128);
      if (!taskId) continue;
      taskRows.set(taskId, [...(taskRows.get(taskId) || []), row]);
    }
    const sharedUser = rows.find((row) => row.role === "user" && boundedText(row.text));
    const tasksWithoutAudit = [...taskRows.keys()].filter((taskId) => !(auditByTask.get(taskId) || []).length);
    const auditedPeerIds = new Set([...taskRows.keys()].flatMap((taskId) => (auditByTask.get(taskId) || [])
      .filter((row) => row.direction === "outbound" && !String(row.peer || "").startsWith("ip:"))
      .map((row) => boundedText(row.peer, 160))
      .filter(Boolean)));
    const unusedTrustedPeers = (options.trustedPeerIds || []).filter((peerId) => !auditedPeerIds.has(peerId));
    const inferredPeerByTask = tasksWithoutAudit.length === 1 && unusedTrustedPeers.length === 1 && taskRows.size > 1
      ? new Map([[tasksWithoutAudit[0], unusedTrustedPeers[0]]])
      : new Map<string, string>();
    return [...taskRows.entries()].flatMap(([taskId, records]): A2AActivity[] => {
      const user = records.find((row) => row.role === "user" && boundedText(row.text)) || sharedUser;
      if (!user) return [];
      const agent = [...records].reverse().find((row) => row.role === "agent" && boundedText(row.text));
      const audits = auditByTask.get(taskId) || [];
      const audit = audits.find((row) => row.direction === "outbound" && !String(row.peer || "").startsWith("ip:"))
        || audits.find((row) => row.direction === "inbound")
        || audits[0];
      const inferredPeerId = inferredPeerByTask.get(taskId) || "";
      const direction = audit?.direction === "outbound" || inferredPeerId ? "outbound" : "inbound";
      const rawPeer = boundedText(audit?.peer, 160);
      const ip = rawPeer.startsWith("ip:") ? rawPeer.slice(3) : "";
      const peerId = inferredPeerId || (ip ? (options.peerIpToId?.get(ip) || null) : (rawPeer || null));
      const peerName = (peerId && options.peerNames?.get(peerId)) || peerId || rawPeer || "unknown";
      const startedAt = toIso(user.ts || audit?.ts);
      if (!startedAt) return [];
      const completedAt = toIso(agent?.ts);
      const contextId = entry.name.replace(/\.jsonl$/i, "");
      const outcome = orchestrationOutcomes.get(contextId);
      const summary = boundedText(audit?.summary || user.text);
      const directOutcome = agent ? null : matchDirectCallOutcome(directCallOutcomes, peerId, summary, startedAt);
      const explicitFailure = (peerId ? outcome?.peerErrors.get(peerId) : undefined) || directOutcome?.failureReason || undefined;
      const status: A2AActivityStatus = agent
        ? "completed"
        : explicitFailure
          ? classifyA2AFailure(explicitFailure)
          : directOutcome
            ? directOutcome.status
          : outcome?.mode === "first"
            ? "cancelled"
            : outcome
              ? "failed"
              : "in_progress";
      const terminalAt = status === "in_progress" ? null : (completedAt || directOutcome?.finishedAt || outcome?.finishedAt || null);
      const durationMs = terminalAt
        ? Math.max(0, new Date(terminalAt).getTime() - new Date(startedAt).getTime())
        : null;
      return [{
        contextId,
        taskId,
        direction,
        peerId,
        peerName,
        status,
        startedAt,
        completedAt: terminalAt,
        durationMs,
        summary,
        result: agent ? boundedText(agent.text) : directOutcome?.result || null,
        failureReason: explicitFailure ? boundedText(explicitFailure, 320) : null,
      }];
    });
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, limit);
}

export function groupA2AOrchestrations(activities: A2AActivity[]): A2AOrchestration[] {
  const contexts = new Map<string, A2AActivity[]>();
  for (const activity of activities) {
    if (activity.direction !== "outbound") continue;
    contexts.set(activity.contextId, [...(contexts.get(activity.contextId) || []), activity]);
  }
  return [...contexts.entries()].flatMap(([contextId, nodes]): A2AOrchestration[] => {
    if (nodes.length < 2) return [];
    const ordered = nodes.slice().sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    const completed = ordered.filter((node) => node.status === "completed").length;
    const failed = ordered.filter((node) => !["completed", "in_progress"].includes(node.status)).length;
    const inProgress = ordered.length - completed - failed;
    const completedTimes = ordered.map((node) => node.completedAt).filter((value): value is string => Boolean(value));
    const terminalTimes = ordered.map((node) => node.completedAt).filter((value): value is string => Boolean(value));
    const completedAt = inProgress === 0 ? terminalTimes.sort().at(-1) || null : null;
    const startedAt = ordered[0].startedAt;
    return [{
      contextId,
      status: completed === ordered.length ? "completed" : inProgress > 0 ? "in_progress" : completed > 0 ? "partial" : "failed",
      startedAt,
      completedAt,
      durationMs: completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null,
      total: ordered.length,
      completed,
      failed,
      inProgress,
      nodes: ordered,
    }];
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

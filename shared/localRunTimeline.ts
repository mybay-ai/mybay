import { classifyLocalFileOperation, safeLocalEvidencePath } from "./localRunFileEvidence";

export interface LocalTimelineEvent { id: number; event: "text" | "step" | "status" | "approval"; data: string }
export interface LocalRunTimeline {
  version: 1;
  runId: string;
  conversationId: string;
  status: "completed" | "failed" | "cancelled" | "expired";
  partial: boolean;
  events: LocalTimelineEvent[];
}
const MAX_EVENTS = 200;
const MAX_CHARACTERS = 64 * 1024;
const categories = new Set(["search", "browser", "file", "code", "data", "communication", "other"]);
const stepTypes = new Set(["web_search", "file_read", "tool_call", "model_reasoning", "final"]);
const statuses = new Set(["queued", "running", "waiting_for_approval", "stopping", "status_unknown"]);
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_:.\-]{1,120}$/.test(value) ? value : "";
const timestamp = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

// The archive is a display summary, never a store of tool arguments, outputs or approval commands.
function safeEvent(value: unknown): LocalTimelineEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) < 0 || typeof row.data !== "string") return null;
  if (row.event === "text") return { id: Number(row.id), event: "text", data: row.data };
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(row.data); } catch { return null; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (row.event === "step") {
    const id = identifier(payload.id);
    if (!id) return null;
    const tool = categories.has(String(payload.tool_name)) ? String(payload.tool_name) : "other";
    const status = payload.status === "completed" || payload.status === "failed" ? payload.status : "running";
    const metadata: Record<string, unknown> = {};
    const source = payload.metadata as Record<string, unknown> | undefined;
    const filePath = safeLocalEvidencePath(source?.file_path);
    if (filePath) metadata.file_path = filePath;
    const operation = classifyLocalFileOperation(source?.operation);
    if (operation) metadata.operation = operation;
    if (typeof source?.file_evidence_confirmed === "boolean") metadata.file_evidence_confirmed = source.file_evidence_confirmed;
    // Only translation keys survive. Arbitrary labels can contain raw commands or secrets.
    const title = typeof payload.title === "string" && /^chatWorkspace\.toolStep[A-Za-z]+$/.test(payload.title)
      ? payload.title : "chatWorkspace.timelineGenericStep";
    return { id: Number(row.id), event: "step", data: JSON.stringify({ id, tool_name: tool,
      stepType: stepTypes.has(String(payload.stepType)) ? payload.stepType : "tool_call", status, title,
      startedAt: timestamp(payload.startedAt), completedAt: timestamp(payload.completedAt), metadata }) };
  }
  if (row.event === "approval" && identifier(payload.id)) {
    return { id: Number(row.id), event: "approval", data: JSON.stringify({ id: payload.id,
      status: payload.status === "resolved" ? "resolved" : "expired" }) };
  }
  // Terminal state comes from the database transaction, never from cached status hints.
  if (row.event === "status" && statuses.has(String(payload.status))) {
    return { id: Number(row.id), event: "status", data: JSON.stringify({ status: payload.status }) };
  }
  return null;
}

export function readLocalRunTimeline(value: unknown, runId: string, conversationId: string): LocalRunTimeline | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as LocalRunTimeline;
  if (raw.version !== 1 || raw.runId !== runId || raw.conversationId !== conversationId
    || !["completed", "failed", "cancelled", "expired"].includes(raw.status) || !Array.isArray(raw.events)) return null;
  let partial = raw.partial === true || raw.events.length > MAX_EVENTS;
  const events: LocalTimelineEvent[] = [];
  let size = 0;
  let lastId = -1;
  for (const item of raw.events.slice(0, MAX_EVENTS)) {
    const event = safeEvent(item);
    if (!event || event.id <= lastId) { partial = true; continue; }
    const bytes = JSON.stringify(event).length;
    if (size + bytes > MAX_CHARACTERS) { partial = true; break; }
    events.push(event); size += bytes; lastId = event.id;
  }
  return { version: 1, runId, conversationId, status: raw.status, partial, events };
}

export function createLocalRunTimeline(input: Omit<LocalRunTimeline, "version" | "partial" | "events"> & {
  events: Array<{ id: number; event: string; data: string }>;
}): LocalRunTimeline {
  // A missing prefix (cache eviction or controller restart) is visible, not reconstructed.
  return readLocalRunTimeline({ ...input, version: 1, partial: input.events[0]?.id !== 1 }, input.runId, input.conversationId)!;
}

/** A bounded summary independent of the short SSE replay window. */
export function createLocalTimelineCollector() {
  const runs = new Map<string, { events: LocalTimelineEvent[]; lastId: number; partial: boolean }>();
  return {
    clear(runId: string) { runs.delete(runId); },
    add(runId: string, raw: { id: number; event: string; data: string }) {
      let state = runs.get(runId);
      if (!state) {
        // Cap total memory as well as each run. Evicted runs will be marked partial on resumption.
        if (runs.size >= 64) runs.delete(runs.keys().next().value!);
        state = { events: [], lastId: 0, partial: raw.id !== 1 };
        runs.set(runId, state);
      }
      if (raw.id <= state.lastId) return;
      if (raw.id !== state.lastId + 1) state.partial = true;
      state.lastId = raw.id;
      const event = safeEvent(raw);
      if (!event) return;
      const last = state.events[state.events.length - 1];
      const candidate = last?.event === "text" && event.event === "text"
        ? [...state.events.slice(0, -1), { ...last, data: last.data + event.data }]
        : [...state.events, event];
      if (candidate.length > MAX_EVENTS || JSON.stringify(candidate).length > MAX_CHARACTERS) {
        state.partial = true;
        return;
      }
      state.events = candidate;
    },
    snapshot(runId: string, conversationId: string, status: LocalRunTimeline["status"]): LocalRunTimeline {
      const state = runs.get(runId);
      return readLocalRunTimeline({ version: 1, runId, conversationId, status,
        events: state?.events || [], partial: !state || state.partial }, runId, conversationId)!;
    },
  };
}

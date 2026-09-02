type RuntimeEvent = Record<string, unknown>;

interface RunLatencyState {
  firstUpstreamByteAtMs?: number;
  firstRuntimeEventAtMs?: number;
  firstVisibleTextAtMs?: number;
  firstToolStartedAtMs?: number;
  lastToolCompletedAtMs?: number;
  upstreamTerminalAtMs?: number;
}

export interface RunLatencyWaterfall {
  version: 1;
  finalStatus: string;
  queueMs: number | null;
  dispatchToFirstUpstreamByteMs: number | null;
  dispatchToFirstRuntimeEventMs: number | null;
  dispatchToFirstVisibleTextMs: number | null;
  dispatchToFirstToolMs: number | null;
  toolSpanMs: number | null;
  upstreamTerminalToPersistedMs: number | null;
  runtimeMs: number | null;
  totalMs: number | null;
}

const TERMINAL_EVENTS = new Set([
  "run.completed", "run.complete", "run.failed", "run.error", "run.cancelled", "run.canceled",
]);

function finiteTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsed(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || to < from) return null;
  return Math.round(to - from);
}

/** Content-free, in-memory timing tracker for one interactive Run lifecycle. */
export function createRunLatencyObservability(now: () => number = () => Date.now()) {
  const states = new Map<string, RunLatencyState>();
  const stateFor = (runId: string): RunLatencyState => {
    const existing = states.get(runId);
    if (existing) return existing;
    const created: RunLatencyState = {};
    states.set(runId, created);
    return created;
  };

  return {
    clear(runId: string): void {
      states.delete(runId);
    },

    markFirstUpstreamByte(runId: string): void {
      const state = stateFor(runId);
      state.firstUpstreamByteAtMs ??= now();
    },

    observeRuntimeEvent(runId: string, rawEvent: unknown): void {
      if (!rawEvent || typeof rawEvent !== "object") return;
      const event = rawEvent as RuntimeEvent;
      const eventType = String(event.event || event.type || "");
      const observedAt = now();
      const state = stateFor(runId);
      state.firstRuntimeEventAtMs ??= observedAt;
      if (eventType === "message.delta" && typeof event.delta === "string" && event.delta) {
        state.firstVisibleTextAtMs ??= observedAt;
      }
      if (eventType === "tool.started" || eventType === "tool.start") {
        state.firstToolStartedAtMs ??= observedAt;
      }
      if (eventType === "tool.completed" || eventType === "tool.complete") {
        state.lastToolCompletedAtMs = observedAt;
      }
      if (TERMINAL_EVENTS.has(eventType)) state.upstreamTerminalAtMs ??= observedAt;
    },

    finish(runId: string, run: Record<string, unknown> | null | undefined, finalStatus: string): RunLatencyWaterfall {
      const finishedAt = now();
      const state = states.get(runId) || {};
      states.delete(runId);
      const createdAt = finiteTimestamp(run?.created_at);
      const startedAt = finiteTimestamp(run?.started_at);
      return {
        version: 1,
        finalStatus,
        queueMs: elapsed(createdAt, startedAt),
        dispatchToFirstUpstreamByteMs: elapsed(startedAt, state.firstUpstreamByteAtMs),
        dispatchToFirstRuntimeEventMs: elapsed(startedAt, state.firstRuntimeEventAtMs),
        dispatchToFirstVisibleTextMs: elapsed(startedAt, state.firstVisibleTextAtMs),
        dispatchToFirstToolMs: elapsed(startedAt, state.firstToolStartedAtMs),
        toolSpanMs: elapsed(state.firstToolStartedAtMs, state.lastToolCompletedAtMs),
        upstreamTerminalToPersistedMs: elapsed(state.upstreamTerminalAtMs, finishedAt),
        runtimeMs: elapsed(startedAt, finishedAt),
        totalMs: elapsed(createdAt, finishedAt),
      };
    },
  };
}

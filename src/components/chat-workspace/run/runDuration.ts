import type { ChatRunMetrics } from "../useChatRuns";

const MIN_REASONABLE_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function normalizeRunTimestampMs(value: unknown, nowMs = Date.now()): number | null {
  let parsed: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    parsed = value > 0 && value < 100_000_000_000 ? value * 1000 : value;
  } else if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    parsed = Number.isFinite(numeric)
      ? (numeric > 0 && numeric < 100_000_000_000 ? numeric * 1000 : numeric)
      : Date.parse(value);
  }
  if (parsed === null || !Number.isFinite(parsed)) return null;
  if (parsed < MIN_REASONABLE_EPOCH_MS || parsed > nowMs + MAX_FUTURE_SKEW_MS) return null;
  return parsed;
}

export function resolveRunDurationMs({
  metrics,
  startCandidates = [],
  completedCandidates = [],
  active,
  nowMs = Date.now()
}: {
  metrics?: ChatRunMetrics | null;
  startCandidates?: unknown[];
  completedCandidates?: unknown[];
  active: boolean;
  nowMs?: number;
}): number | null {
  const metricStart = normalizeRunTimestampMs(metrics?.startedAt, nowMs);
  const validStarts = startCandidates
    .map(value => normalizeRunTimestampMs(value, nowMs))
    .filter((value): value is number => value !== null);
  const startedAt = metricStart ?? (validStarts.length > 0 ? Math.min(...validStarts) : null);

  if (active) return startedAt === null ? null : Math.max(0, nowMs - startedAt);

  if (typeof metrics?.durationMs === "number" && Number.isFinite(metrics.durationMs)) {
    return Math.max(0, metrics.durationMs);
  }

  const metricCompleted = normalizeRunTimestampMs(metrics?.completedAt, nowMs);
  const validCompleted = completedCandidates
    .map(value => normalizeRunTimestampMs(value, nowMs))
    .filter((value): value is number => value !== null);
  const completedAt = metricCompleted ?? (validCompleted.length > 0 ? Math.max(...validCompleted) : null);
  return startedAt !== null && completedAt !== null && completedAt >= startedAt
    ? completedAt - startedAt
    : null;
}

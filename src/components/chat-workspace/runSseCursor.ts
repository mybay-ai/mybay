export type RunSseCursor = {
  currentEventId: number;
  lastCommittedEventId: number;
};

export function normalizeRunSseResumeCursor(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function observeRunSseEventId(cursor: RunSseCursor, eventId: number): RunSseCursor {
  if (!Number.isFinite(eventId) || eventId <= 0) return cursor;
  return { ...cursor, currentEventId: eventId };
}

export function commitRunSseFrame(cursor: RunSseCursor, consumed: boolean): RunSseCursor {
  return {
    currentEventId: 0,
    lastCommittedEventId: consumed && cursor.currentEventId > 0
      ? Math.max(cursor.lastCommittedEventId, cursor.currentEventId)
      : cursor.lastCommittedEventId
  };
}

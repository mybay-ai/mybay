export type RunSseCursor = {
  currentEventId: number;
  lastCommittedEventId: number;
};

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

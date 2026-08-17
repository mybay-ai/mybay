export interface CachedRunEvent {
  id: number;
  event: string;
  data: string;
}

export interface RunEventCachePolicy {
  singleEventMaxBytes: number;
  globalMaxBytes: number;
  perRunMaxBytes: number;
  perRunMaxEvents: number;
  terminalRetentionMs: number;
  inactiveRetentionMs: number;
}

export const DEFAULT_RUN_EVENT_CACHE_POLICY: RunEventCachePolicy = {
  singleEventMaxBytes: 32 * 1024,
  globalMaxBytes: 50 * 1024 * 1024,
  perRunMaxBytes: 2 * 1024 * 1024,
  perRunMaxEvents: 200,
  terminalRetentionMs: 10 * 60 * 1000,
  inactiveRetentionMs: 15 * 60 * 1000,
};

export interface RunEventCacheDependencies {
  persistSequence(runId: string, sequence: number, ownerId?: string): Promise<unknown>;
  emit(runId: string, event: CachedRunEvent): void;
  onClear(runId: string): void;
  warn(message: string): void;
  now(): number;
}

export interface RunEventCacheController {
  touch(runId: string): void;
  getLastActivity(runId: string): number | undefined;
  initSequence(runId: string, startSequence: number): void;
  setTerminalExpiry(runId: string): void;
  add(runId: string, event: string, data: string, ownerId?: string): { added: boolean; event?: CachedRunEvent };
  get(runId: string, lastEventId: number): { events: CachedRunEvent[]; recoveryOutOfBounds?: boolean };
  clear(runId: string): void;
  cleanupInactive(nowMs?: number): void;
}

export function createRunEventCacheController(
  dependencies: RunEventCacheDependencies,
  policy: RunEventCachePolicy = DEFAULT_RUN_EVENT_CACHE_POLICY,
): RunEventCacheController {
  const eventsByRun = new Map<string, CachedRunEvent[]>();
  const sequenceByRun = new Map<string, number>();
  const lastActivityByRun = new Map<string, number>();
  const terminalExpiryByRun = new Map<string, number>();
  let globalCacheBytes = 0;

  const eventBytes = (event: CachedRunEvent): number => Buffer.byteLength(JSON.stringify(event));

  const touch = (runId: string): void => {
    lastActivityByRun.set(runId, dependencies.now());
  };

  const clear = (runId: string): void => {
    dependencies.onClear(runId);
    const events = eventsByRun.get(runId);
    if (events) {
      for (const event of events) globalCacheBytes -= eventBytes(event);
      globalCacheBytes = Math.max(0, globalCacheBytes);
      eventsByRun.delete(runId);
    }
    sequenceByRun.delete(runId);
    lastActivityByRun.delete(runId);
    terminalExpiryByRun.delete(runId);
  };

  const add = (
    runId: string,
    eventName: string,
    rawData: string,
    ownerId?: string,
  ): { added: boolean; event?: CachedRunEvent } => {
    touch(runId);
    const data = Buffer.byteLength(rawData) > policy.singleEventMaxBytes
      ? JSON.stringify({
          truncated: true,
          message: "Event payload exceeded the allowed size.",
          summary: "Event payload exceeded the allowed size.",
        })
      : rawData;
    const nextSequence = (sequenceByRun.get(runId) || 0) + 1;
    const nextEvent: CachedRunEvent = { id: nextSequence, event: eventName, data };
    const nextEventBytes = eventBytes(nextEvent);

    if (nextEventBytes > policy.globalMaxBytes) {
      dependencies.warn(`[RunsReconciler] Event for run ${runId} exceeds global maximum byte size.`);
      return { added: false };
    }

    let events = eventsByRun.get(runId);
    if (!events) {
      events = [];
      eventsByRun.set(runId, events);
    }

    while (globalCacheBytes + nextEventBytes > policy.globalMaxBytes) {
      let oldestOtherRunId: string | null = null;
      let oldestTime = Infinity;
      for (const [candidateRunId, lastActive] of lastActivityByRun.entries()) {
        if (candidateRunId !== runId && lastActive < oldestTime) {
          oldestTime = lastActive;
          oldestOtherRunId = candidateRunId;
        }
      }
      if (!oldestOtherRunId) break;
      clear(oldestOtherRunId);
    }

    while (globalCacheBytes + nextEventBytes > policy.globalMaxBytes && events.length > 0) {
      const shifted = events.shift();
      if (!shifted) break;
      globalCacheBytes -= eventBytes(shifted);
    }
    globalCacheBytes = Math.max(0, globalCacheBytes);

    if (globalCacheBytes + nextEventBytes > policy.globalMaxBytes) {
      dependencies.warn(`[RunsReconciler] Unable to fit event for run ${runId} in cache even after clearing other runs.`);
      return { added: false };
    }

    events.push(nextEvent);
    globalCacheBytes += nextEventBytes;
    let runBytes = events.reduce((sum, event) => sum + eventBytes(event), 0);
    while ((events.length > policy.perRunMaxEvents || runBytes > policy.perRunMaxBytes) && events.length > 0) {
      const shifted = events.shift();
      if (!shifted) break;
      const shiftedBytes = eventBytes(shifted);
      globalCacheBytes -= shiftedBytes;
      runBytes -= shiftedBytes;
    }
    globalCacheBytes = Math.max(0, globalCacheBytes);

    sequenceByRun.set(runId, nextSequence);
    dependencies.persistSequence(runId, nextSequence, ownerId).catch(() => {});
    dependencies.emit(runId, nextEvent);
    return { added: true, event: nextEvent };
  };

  return {
    touch,
    getLastActivity: (runId) => lastActivityByRun.get(runId),
    initSequence: (runId, startSequence) => {
      if (!sequenceByRun.has(runId)) sequenceByRun.set(runId, startSequence);
    },
    setTerminalExpiry: (runId) => {
      terminalExpiryByRun.set(runId, dependencies.now() + policy.terminalRetentionMs);
    },
    add,
    get: (runId, lastEventId) => {
      touch(runId);
      const events = eventsByRun.get(runId) || [];
      if (events.length === 0) return { events: [] };
      if (lastEventId > 0 && events[0].id > lastEventId + 1) {
        return { events: [], recoveryOutOfBounds: true };
      }
      return { events: events.filter((event) => event.id > lastEventId) };
    },
    clear,
    cleanupInactive: (nowMs = dependencies.now()) => {
      for (const [runId, lastActive] of lastActivityByRun.entries()) {
        const terminalExpiry = terminalExpiryByRun.get(runId);
        if (terminalExpiry ? nowMs > terminalExpiry : nowMs - lastActive > policy.inactiveRetentionMs) {
          clear(runId);
        }
      }
    },
  };
}

export interface RunSseStreamController {
  ensure(
    runId: string,
    start: (signal: AbortSignal, onChunk: (chunk: string) => void) => Promise<void>,
    onEvent: (event: unknown) => void,
  ): boolean;
  clear(runId: string): void;
  clearAll(): void;
}

export function createRunSseStreamController(maxBufferCharacters = 1024 * 1024): RunSseStreamController {
  const activeStreams = new Map<string, AbortController>();
  const buffers = new Map<string, string>();

  const consume = (runId: string, chunk: string, onEvent: (event: unknown) => void): void => {
    let buffer = (buffers.get(runId) || "") + chunk;
    if (buffer.length > maxBufferCharacters) buffer = buffer.slice(-maxBufferCharacters);
    const frames = buffer.split(/\r?\n\r?\n/);
    buffers.set(runId, frames.pop() || "");
    for (const frame of frames) {
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data));
      } catch {}
    }
  };

  return {
    ensure: (runId, start, onEvent) => {
      if (activeStreams.has(runId)) return false;
      const controller = new AbortController();
      activeStreams.set(runId, controller);
      void start(controller.signal, (chunk) => consume(runId, chunk, onEvent))
        .catch(() => {})
        .finally(() => {
          if (activeStreams.get(runId) === controller) activeStreams.delete(runId);
        });
      return true;
    },
    clear: (runId) => {
      activeStreams.get(runId)?.abort();
      activeStreams.delete(runId);
      buffers.delete(runId);
    },
    clearAll: () => {
      for (const controller of activeStreams.values()) controller.abort();
      activeStreams.clear();
    },
  };
}

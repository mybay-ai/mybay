import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "../../repositories/chatRepo";
import {
  addEventToCache,
  clearEventsCache,
  getEventsFromCache,
  initRunSequence,
  runsEventsEmitter,
  setTerminalRunExpiry,
  startRunsReconciler,
  stopRunsReconciler,
} from "../runsReconciler";

const runId = "cache-run-1";

afterEach(() => {
  stopRunsReconciler();
  clearEventsCache(runId);
  vi.useRealTimers();
  vi.restoreAllMocks();
  runsEventsEmitter.removeAllListeners(`event:${runId}`);
});

describe("run event cache characterization", () => {
  it("commits increasing sequence only once initialized and broadcasts after insertion", () => {
    const update = vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
    const received: unknown[] = [];
    runsEventsEmitter.on(`event:${runId}`, (event) => received.push(event));
    initRunSequence(runId, 5);

    expect(addEventToCache(runId, "status", "one", "worker-1")).toEqual({
      added: true,
      event: { id: 6, event: "status", data: "one" },
    });
    initRunSequence(runId, 100);
    expect(addEventToCache(runId, "text", "two").event?.id).toBe(7);

    expect(update).toHaveBeenNthCalledWith(1, runId, { last_event_seq: 6 }, "worker-1");
    expect(update).toHaveBeenNthCalledWith(2, runId, { last_event_seq: 7 }, undefined);
    expect(received).toEqual([
      { id: 6, event: "status", data: "one" },
      { id: 7, event: "text", data: "two" },
    ]);
  });

  it("replaces payloads larger than 32KB with the fixed safe summary", () => {
    vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);

    const result = addEventToCache(runId, "text", "x".repeat(32 * 1024 + 1));

    expect(result.added).toBe(true);
    expect(JSON.parse(result.event?.data || "{}")).toEqual({
      truncated: true,
      message: "Event payload exceeded the allowed size.",
      summary: "Event payload exceeded the allowed size.",
    });
  });

  it("keeps only the latest 200 events and reports an out-of-bounds replay gap", () => {
    vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
    for (let index = 0; index < 202; index += 1) {
      addEventToCache(runId, "text", String(index));
    }

    expect(getEventsFromCache(runId, 0).events).toHaveLength(200);
    expect(getEventsFromCache(runId, 0).events[0].id).toBe(3);
    expect(getEventsFromCache(runId, 1)).toEqual({ events: [], recoveryOutOfBounds: true });
    expect(getEventsFromCache(runId, 2).events[0].id).toBe(3);
  });

  it("cleans terminal cache only after the strict ten-minute expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
    vi.spyOn(chatRepo, "claimRuns").mockResolvedValue([]);
    addEventToCache(runId, "status", "terminal");
    setTerminalRunExpiry(runId);
    startRunsReconciler(1_000_000, { allowInTest: true, cacheCleanupIntervalMs: 600_001 });

    await vi.advanceTimersByTimeAsync(600_000);
    expect(getEventsFromCache(runId, 0).events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getEventsFromCache(runId, 0).events).toEqual([]);
  });
});

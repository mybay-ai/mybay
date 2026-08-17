import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RUN_EVENT_CACHE_POLICY,
  createRunEventCacheController,
  createRunSseStreamController,
} from "./runEventLifecycle";

function cacheDependencies(now: { value: number }) {
  return {
    persistSequence: vi.fn(async () => undefined),
    emit: vi.fn(),
    onClear: vi.fn(),
    warn: vi.fn(),
    now: () => now.value,
  };
}

describe("run event lifecycle controllers", () => {
  it("evicts the least-recently-active other run before the current run", () => {
    const now = { value: 1 };
    const dependencies = cacheDependencies(now);
    const singleEventBytes = Buffer.byteLength(JSON.stringify({ id: 1, event: "text", data: "x" }));
    const cache = createRunEventCacheController(dependencies, {
      ...DEFAULT_RUN_EVENT_CACHE_POLICY,
      globalMaxBytes: singleEventBytes,
    });
    cache.add("run-a", "text", "x");
    now.value = 2;
    cache.add("run-b", "text", "x");

    expect(dependencies.onClear).toHaveBeenCalledWith("run-a");
    expect(cache.get("run-a", 0).events).toEqual([]);
    expect(cache.get("run-b", 0).events).toHaveLength(1);
  });

  it("enforces per-run count and preserves replay horizon detection", () => {
    const now = { value: 1 };
    const cache = createRunEventCacheController(cacheDependencies(now), {
      ...DEFAULT_RUN_EVENT_CACHE_POLICY,
      perRunMaxEvents: 2,
    });
    cache.add("run-a", "text", "one");
    cache.add("run-a", "text", "two");
    cache.add("run-a", "text", "three");

    expect(cache.get("run-a", 0).events.map((event) => event.id)).toEqual([2, 3]);
    expect(cache.get("run-a", 0).events.map((event) => event.data)).toEqual(["two", "three"]);
    expect(cache.get("run-a", 0).recoveryOutOfBounds).toBeUndefined();
    expect(cache.get("run-a", 0).events[0].id).toBe(2);
  });

  it("uses strict terminal and inactive cleanup boundaries", () => {
    const now = { value: 0 };
    const dependencies = cacheDependencies(now);
    const cache = createRunEventCacheController(dependencies, {
      ...DEFAULT_RUN_EVENT_CACHE_POLICY,
      terminalRetentionMs: 10,
      inactiveRetentionMs: 20,
    });
    cache.add("terminal", "status", "done");
    cache.setTerminalExpiry("terminal");
    cache.add("active", "status", "running");

    cache.cleanupInactive(10);
    expect(cache.get("terminal", 0).events).toHaveLength(1);
    cache.cleanupInactive(11);
    expect(cache.get("terminal", 0).events).toEqual([]);
    cache.cleanupInactive(20);
    expect(cache.get("active", 0).events).toHaveLength(1);
    cache.cleanupInactive(21);
    expect(cache.get("active", 0).events).toEqual([]);
  });

  it("does not fail event insertion when sequence persistence rejects", async () => {
    const now = { value: 1 };
    const dependencies = cacheDependencies(now);
    dependencies.persistSequence.mockRejectedValueOnce(new Error("db unavailable"));
    const cache = createRunEventCacheController(dependencies);

    expect(cache.add("run-a", "status", "running").added).toBe(true);
    await Promise.resolve();
    expect(cache.get("run-a", 0).events).toHaveLength(1);
  });

  it("deduplicates active streams and allows restart after settlement", async () => {
    const streams = createRunSseStreamController();
    const start = vi.fn(async () => undefined);
    const onEvent = vi.fn();

    expect(streams.ensure("run-a", start, onEvent)).toBe(true);
    expect(streams.ensure("run-a", start, onEvent)).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(streams.ensure("run-a", start, onEvent)).toBe(true);
  });

  it("aborts every active stream during clearAll", () => {
    const streams = createRunSseStreamController();
    const signals: AbortSignal[] = [];
    const start = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>(() => undefined);
    };
    streams.ensure("run-a", start, vi.fn());
    streams.ensure("run-b", start, vi.fn());

    streams.clearAll();

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

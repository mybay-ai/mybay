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
  it("discards half frames between connections and ignores late bytes from aborted streams", async () => {
    const streams = createRunSseStreamController();
    const received = vi.fn();
    let lateChunk!: (chunk: string) => void;
    streams.ensure("run-a", async (_signal, chunk) => {
      lateChunk = chunk;
      chunk('data: {"event":"message.delta","delta":"broken');
    }, received);
    await new Promise(resolve => setTimeout(resolve, 0));
    streams.ensure("run-a", async (_signal, chunk) => {
      chunk('data: {"delta":"NEW"}\n\n');
      lateChunk('data: {"delta":"OLD"}\n\n');
    }, received);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received.mock.calls).toEqual([[{ delta: "NEW" }]]);
  });

  it("splits large Unicode text without substituting a truncation message", () => {
    const deps = cacheDependencies({ value: 0 });
    const cache = createRunEventCacheController(deps);
    const text = "中文😀\n".repeat(12_000);
    cache.add("large", "text", text);
    expect(deps.emit.mock.calls.map(call => (call as unknown as [string, { data: string }])[1].data).join("")).toBe(text);
    expect(cache.get("large", 0).events.every(event => Buffer.byteLength(event.data) <= DEFAULT_RUN_EVENT_CACHE_POLICY.singleEventMaxBytes)).toBe(true);
  });
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

    expect(cache.get("run-a", 0)).toEqual({ events: [], recoveryOutOfBounds: true });
    expect(cache.get("run-a", 1).events.map(event => event.id)).toEqual([2, 3]);
    expect(cache.get("run-a", 99).recoveryOutOfBounds).toBe(true);
    cache.clear("run-a");
    expect(cache.get("run-a", 3).recoveryOutOfBounds).toBe(true);
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

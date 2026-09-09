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
  it("does not replay text or approvals when the same upstream stream reconnects", async () => {
    const streams = createRunSseStreamController();
    const received = vi.fn();
    const frame = (id: number, event: unknown) => `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
    const first = frame(1, { type: "message.delta", delta: "hello" })
      + frame(2, { type: "approval.request", approval_id: "approval-1" });
    streams.ensure("local", async (_signal, chunk) => { chunk(first); }, received, undefined, "instance:native");
    await new Promise(resolve => setTimeout(resolve, 0));
    streams.ensure("local", async (_signal, chunk) => {
      chunk(first + frame(3, { type: "approval.responded", approval_id: "approval-1" }));
    }, received, undefined, "instance:native");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received.mock.calls.map(([e]) => e.type)).toEqual(["message.delta", "approval.request", "approval.responded"]);
  });

  it("resets sequence for a replacement upstream and ignores the previous connection", async () => {
    const streams = createRunSseStreamController();
    const received = vi.fn();
    let oldChunk!: (chunk: string) => void;
    let oldSignal!: AbortSignal;
    streams.ensure("local", (signal, chunk) => {
      oldChunk = chunk; oldSignal = signal; chunk('id: 9\ndata: {"text":"old"}\n\n');
      return new Promise(() => {});
    }, received, undefined, "native-old");
    streams.ensure("local", async (_signal, chunk) => {
      oldChunk('id: 10\ndata: {"text":"late"}\n\n');
      chunk('id: 1\ndata: {"text":"new"}\n\n');
    }, received, undefined, "native-new");
    expect(oldSignal.aborted).toBe(true);
    expect(received.mock.calls.map(([e]) => e.text)).toEqual(["old", "new"]);
  });

  it("does not advance past a delivery failure and retries the undelivered event", async () => {
    const streams = createRunSseStreamController();
    const received = vi.fn().mockImplementationOnce(() => { throw Error("temporary failure"); });
    const data = 'id: 1\ndata: {"text":"first"}\n\nid: 2\ndata: {"text":"second"}\n\n';
    streams.ensure("local", async (_signal, chunk) => { chunk(data); }, received);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toHaveBeenCalledTimes(1);
    streams.ensure("local", async (_signal, chunk) => { chunk(data); }, received);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received.mock.calls.map(([e]) => e.text)).toEqual(["first", "first", "second"]);
    streams.clear("local");
    streams.ensure("local", async (_signal, chunk) => { chunk(data); }, received);
    expect(received).toHaveBeenCalledTimes(5);
  });

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

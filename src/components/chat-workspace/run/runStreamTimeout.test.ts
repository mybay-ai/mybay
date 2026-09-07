import { afterEach, expect, it, vi } from "vitest";
import { withRunStreamTimeout } from "./runStreamTimeout";
afterEach(() => vi.useRealTimers());
it("cancels a silent connection and releases its wait", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const result = expect(withRunStreamTimeout(new Promise(() => {}), 60_000, cancel)).rejects.toThrow("RUN_STREAM_TIMEOUT");
  await vi.advanceTimersByTimeAsync(60_000);
  await result;
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not cancel an operation that finished on time", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  expect(await withRunStreamTimeout(Promise.resolve("ok"), 15_000, cancel)).toBe("ok");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(cancel).not.toHaveBeenCalled();
});

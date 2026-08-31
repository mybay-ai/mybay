import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { createChatRunWithRetry } from "./chatRunTransport";

vi.mock("../../lib/api", () => ({ api: { post: vi.fn() } }));

const payload = { conversationId: "conversation-1", content: "synthetic retry", requestId: "stable-request-1", attachmentIds: [] };
describe("Agent creation retries", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.post).mockReset(); });
  afterEach(() => vi.useRealTimers());

  it("reuses the same request identity after a transient 503", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({ success: true, runId: "one-run" });
    const result = expect(createChatRunWithRetry("instance-1", payload, false)).resolves.toEqual({ success: true, runId: "one-run" });
    await vi.advanceTimersByTimeAsync(399);
    expect(api.post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(api.post).toHaveBeenCalledTimes(2);
    for (const [url, body] of vi.mocked(api.post).mock.calls) {
      expect(url).toBe("/api/instances/instance-1/runs");
      expect(body).toBe(payload);
    }
  });

  it("stops after one transient retry and surfaces the failure", async () => {
    const error = { status: 503 };
    vi.mocked(api.post).mockRejectedValue(error);
    const result = expect(createChatRunWithRetry("instance-1", payload, false)).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await result;
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("waits for a stopping run to release without changing the request identity", async () => {
    const busy = { status: 409, data: { error: "ACTIVE_RUN_EXISTS" } };
    vi.mocked(api.post).mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValueOnce({ success: true, runId: "next-run" });
    const result = expect(createChatRunWithRetry("instance-1", payload, true)).resolves.toEqual({ success: true, runId: "next-run" });
    await vi.runAllTimersAsync();
    await result;
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.post).mock.calls.every(([, body]) => body === payload)).toBe(true);
  });

  it("does not retry an authorization failure", async () => {
    const error = { status: 403, data: { error: "FORBIDDEN" } };
    vi.mocked(api.post).mockRejectedValue(error);
    await expect(createChatRunWithRetry("instance-1", payload, true)).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrency retries and returns the rejection instead of waiting forever", async () => {
    const busy = { status: 429, data: { error: "TOO_MANY_CONCURRENT_RUNS" } };
    vi.mocked(api.post).mockRejectedValue(busy);
    const result = expect(createChatRunWithRetry("instance-1", payload, true)).rejects.toBe(busy);
    await vi.runAllTimersAsync();
    await result;
    expect(api.post).toHaveBeenCalledTimes(6);
    expect(vi.mocked(api.post).mock.calls.every(([, body]) => body === payload)).toBe(true);
  });

  it("does not retry a generic rate limit as though it were cancellation convergence", async () => {
    const limited = { status: 429, data: { error: "RATE_LIMITED" } };
    vi.mocked(api.post).mockRejectedValue(limited);
    await expect(createChatRunWithRetry("instance-1", payload, true)).rejects.toBe(limited);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("stops delayed retries when the conversation request context is invalidated", async () => {
    let current = true;
    vi.mocked(api.post).mockRejectedValue({ status: 409, data: { error: "ACTIVE_RUN_EXISTS" } });
    const result = expect(createChatRunWithRetry("instance-1", payload, true, () => current)).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    expect(api.post).toHaveBeenCalledTimes(1);
    current = false;
    await vi.runAllTimersAsync();
    await result;
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch an already stale context", async () => {
    await expect(createChatRunWithRetry("instance-1", payload, true, () => false)).rejects.toMatchObject({ name: "AbortError" });
    expect(api.post).not.toHaveBeenCalled();
  });
});

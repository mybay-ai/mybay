import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { writeAndFlushSse } from "./runEvents.routes";

describe("Run SSE response flushing", () => {
  it("writes a complete frame before immediately flushing buffered middleware", () => {
    const write = vi.fn();
    const flush = vi.fn();
    const response = { write, flush } as unknown as Response;

    writeAndFlushSse(response, "event: status\ndata: {\"status\":\"running\"}\n\n");

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith("event: status\ndata: {\"status\":\"running\"}\n\n");
    expect(flush).toHaveBeenCalledOnce();
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0]);
  });

  it("still writes when the response has no compression flush hook", () => {
    const write = vi.fn();
    const response = { write } as unknown as Response;

    expect(() => writeAndFlushSse(response, ": ok\n\n")).not.toThrow();
    expect(write).toHaveBeenCalledWith(": ok\n\n");
  });
});

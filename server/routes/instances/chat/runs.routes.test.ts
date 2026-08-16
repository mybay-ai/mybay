import { afterEach, describe, expect, it, vi } from "vitest";
import { requireInteractiveRunsEnabled } from "./runs.routes";

describe("POST /runs Interactive Agent creation gate", () => {
  const originalValue = process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;
    else process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = originalValue;
  });

  it("returns FEATURE_DISABLED when Interactive Runs are disabled", () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "false";
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();

    requireInteractiveRunsEnabled({} as any, { status } as any, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: "FEATURE_DISABLED",
      reason: "INTERACTIVE_RUNS_DISABLED"
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it("allows POST /runs to continue when Interactive Runs are enabled", () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    const next = vi.fn();

    requireInteractiveRunsEnabled({} as any, {} as any, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

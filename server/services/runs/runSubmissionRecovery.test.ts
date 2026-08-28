import { describe, expect, it, vi } from "vitest";
import { submitRunWithIdempotentRecovery } from "./runSubmissionRecovery";

describe("idempotent run submission recovery", () => {
  it("returns a recovered upstream run without submitting twice", async () => {
    const submit = vi.fn(async () => ({ ok: false, statusCode: 504, error: "TIMEOUT" }));
    const result = await submitRunWithIdempotentRecovery({
      submit,
      recover: async () => ({ ok: true, statusCode: 200, json: { found: true, id: "upstream-1" } }),
      sleep: async () => undefined,
    });
    expect(result).toMatchObject({ ok: true, json: { id: "upstream-1", recovered: true } });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("retries only after recovery confirms the run is missing", async () => {
    const submit = vi.fn()
      .mockResolvedValueOnce({ ok: false, statusCode: 503, error: "UNAVAILABLE" })
      .mockResolvedValueOnce({ ok: true, statusCode: 202, json: { id: "upstream-2" } });
    const result = await submitRunWithIdempotentRecovery({
      submit,
      recover: async () => ({ ok: true, statusCode: 200, json: { found: false } }),
      sleep: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("does not retry when recovery authority is unavailable", async () => {
    const submit = vi.fn(async () => ({ ok: false, statusCode: 504, error: "TIMEOUT" }));
    await submitRunWithIdempotentRecovery({
      submit,
      recover: async () => ({ ok: false, statusCode: 503, error: "UNAVAILABLE" }),
      sleep: async () => undefined,
      maxRecoveryChecks: 1,
    });
    expect(submit).toHaveBeenCalledOnce();
  });
});

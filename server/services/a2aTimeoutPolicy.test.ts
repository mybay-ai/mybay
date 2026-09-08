import { describe, expect, it } from "vitest";
import { resolveA2ATaskWaitMs } from "./a2aTimeoutPolicy";

describe("A2A task wait policy", () => {
  it("allows concurrent Runtime work five minutes by default", () => {
    expect(resolveA2ATaskWaitMs({})).toBe(300_000);
  });

  it("bounds operator overrides", () => {
    expect(resolveA2ATaskWaitMs({ MYBAY_A2A_TASK_WAIT_MS: "1000" })).toBe(30_000);
    expect(resolveA2ATaskWaitMs({ MYBAY_A2A_TASK_WAIT_MS: "1200000" })).toBe(900_000);
    expect(resolveA2ATaskWaitMs({ MYBAY_A2A_TASK_WAIT_MS: "240000" })).toBe(240_000);
  });
});

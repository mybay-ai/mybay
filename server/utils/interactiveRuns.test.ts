import { afterEach, describe, expect, it } from "vitest";
import { isInteractiveRunsEnabled, resolveInteractiveRunsAvailability } from "./interactiveRuns";

describe("Interactive Agent Runs feature gate", () => {
  const originalValue = process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;
    else process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = originalValue;
  });

  it("fails closed when the environment variable is missing", () => {
    delete process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;
    expect(isInteractiveRunsEnabled()).toBe(false);
  });

  it("supports Interactive Agent when explicitly enabled and Hermes supports Runs", () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    expect(resolveInteractiveRunsAvailability("supported")).toEqual({
      upstreamState: "supported",
      creationEnabled: true,
      effectiveState: "supported",
      runsSupported: true,
      reason: null
    });
  });

  it("disables Interactive Agent when explicitly disabled even if Hermes supports Runs", () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "false";
    expect(resolveInteractiveRunsAvailability("supported")).toMatchObject({
      upstreamState: "supported",
      creationEnabled: false,
      runsSupported: false,
      reason: "INTERACTIVE_RUNS_DISABLED"
    });
  });

  it("reports an unsupported Hermes Runtime separately", () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    expect(resolveInteractiveRunsAvailability("explicitly_unsupported")).toMatchObject({
      creationEnabled: true,
      runsSupported: false,
      reason: "UPSTREAM_RUNS_UNSUPPORTED"
    });
  });

  it("reports a transient capability probe failure separately", () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    expect(resolveInteractiveRunsAvailability("unavailable")).toMatchObject({
      creationEnabled: true,
      effectiveState: "unavailable",
      runsSupported: false,
      reason: "CAPABILITY_PROBE_FAILED"
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { checkingRunCapabilities, normalizeRunCapabilities, scopedRunCapabilities, startRunCapabilityProbe } from "./runCapabilityProbe";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe("scoped run capability", () => {
  it.each([
    [null, "unavailable"],
    [{ success: false, state: "supported" }, "unavailable"],
    [{ success: true, state: "supported" }, "supported"],
    [{ success: true, state: "explicitly_unsupported" }, "explicitly_unsupported"],
    [{ success: true, state: "supported", creationEnabled: false }, "disabled"],
    [{ success: true, state: "supported", reason: "INTERACTIVE_RUNS_DISABLED" }, "disabled"],
    [{ success: true, state: "supported", reason: "UPSTREAM_RUNS_UNSUPPORTED" }, "explicitly_unsupported"],
    [{ success: true, state: "supported", reason: "CAPABILITY_PROBE_FAILED" }, "unavailable"],
  ])("preserves capability precedence %#", (response, expected) => {
    expect(normalizeRunCapabilities("a", response).state).toBe(expected);
  });

  it("does not apply one Agent's supported result to a different Agent even before effects run", () => {
    const snapshot = normalizeRunCapabilities("a", { success: true, state: "supported", features: { run_stop: true, run_events_sse: true } });
    expect(snapshot.details.runStop).toBe(true);
    expect(scopedRunCapabilities(snapshot, "a")).toBe(snapshot);
    expect(scopedRunCapabilities(snapshot, "b")).toEqual(checkingRunCapabilities("b"));
  });

  it("drops the first A result after A -> B -> A and aborts its request", async () => {
    const previous = deferred(), apply = vi.fn();
    let oldSignal: AbortSignal | undefined;
    const oldProbe = startRunCapabilityProbe({ instanceId: "a", isCurrent: () => true, apply,
      load: (_id, signal) => { oldSignal = signal; return previous.promise; } });
    oldProbe.cancel();
    const newProbe = startRunCapabilityProbe({ instanceId: "a", isCurrent: () => true, apply,
      load: async () => ({ success: true, creationEnabled: false }) });
    await newProbe.settled;
    previous.resolve({ success: true, state: "supported" });
    await oldProbe.settled;
    expect(oldSignal?.aborted).toBe(true);
    expect(apply.mock.calls.map(([snapshot]) => snapshot.state)).toEqual(["checking", "checking", "disabled"]);
  });

  it("ignores a late error immediately after selection changes, before effect cleanup", async () => {
    const response = deferred(), apply = vi.fn();
    let selected = "a";
    const probe = startRunCapabilityProbe({ instanceId: "a", isCurrent: () => selected === "a", apply, load: () => response.promise });
    selected = "b";
    response.reject(new Error("offline"));
    await probe.settled;
    expect(apply.mock.calls.map(([snapshot]) => snapshot.state)).toEqual(["checking"]);
  });

  it("exposes a current probe failure without changing any mode preference", async () => {
    const apply = vi.fn();
    const probe = startRunCapabilityProbe({ instanceId: "a", isCurrent: () => true, apply, load: async () => { throw new Error("offline"); } });
    await probe.settled;
    expect(apply).toHaveBeenLastCalledWith({ ...checkingRunCapabilities("a"), state: "unavailable" });
  });

  it("does not request capabilities when no Agent is selected", async () => {
    const load = vi.fn(), apply = vi.fn();
    await startRunCapabilityProbe({ instanceId: "", isCurrent: () => true, load, apply }).settled;
    expect(load).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith(checkingRunCapabilities(""));
  });
});

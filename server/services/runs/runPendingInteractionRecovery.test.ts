import { describe, expect, it, vi } from "vitest";
import { publishPendingRuntimeInteractions } from "./runPendingInteractionRecovery";
import type { RuntimeRunEventTracker } from "../../runtime/contracts";

function harness() {
  const tracker: RuntimeRunEventTracker = { lastPartialOutput: "", sentSteps: new Map(), activeToolIds: new Map() };
  return {
    tracker,
    consume: vi.fn(),
    log: vi.fn(),
    getTracker: vi.fn(() => tracker),
  };
}

describe("pending runtime interaction recovery", () => {
  it("publishes camel-case and snake-case pending approvals", () => {
    const first = harness();
    expect(publishPendingRuntimeInteractions({ id: "run-1" }, {
      pendingApprovals: [{ approval_id: "approval-1", title: "One" }],
    }, "status_probe", first)).toBe(1);
    expect(first.consume).toHaveBeenCalledWith(
      { id: "run-1" },
      expect.objectContaining({ event: "approval.request", approval_id: "approval-1" }),
    );

    const second = harness();
    expect(publishPendingRuntimeInteractions({ id: "run-2" }, {
      pending_approvals: [{ permission_id: "approval-2" }],
    }, "immediate_post_dispatch", second)).toBe(1);
  });

  it("deduplicates repeated probes for the same approval", () => {
    const dependencies = harness();
    const payload = { pendingApprovals: [{ id: "approval-1" }] };
    expect(publishPendingRuntimeInteractions({ id: "run-1" }, payload, "status_probe", dependencies)).toBe(1);
    expect(publishPendingRuntimeInteractions({ id: "run-1" }, payload, "status_probe", dependencies)).toBe(0);
    expect(dependencies.consume).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or unsafe identifiers", () => {
    const dependencies = harness();
    expect(publishPendingRuntimeInteractions({ id: "run-1" }, {
      pendingApprovals: [{ id: "" }, { id: "contains whitespace" }, { title: "missing" }],
    }, "status_probe", dependencies)).toBe(0);
    expect(dependencies.consume).not.toHaveBeenCalled();
  });
});

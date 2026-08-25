import { describe, expect, it, vi } from "vitest";
import {
  executeStopLifecycle,
  normalizeStopRunStatus,
  pollRunRelease,
} from "./runStopLifecycle";

describe("local run stop lifecycle", () => {
  it("normalizes local stop aliases without treating unknown states as terminal", () => {
    expect(normalizeStopRunStatus("stop_requested")).toBe("stopping");
    expect(normalizeStopRunStatus("canceled")).toBe("cancelled");
    expect(normalizeStopRunStatus("status_unknown")).toBeNull();
  });

  it("preserves the authoritative terminal status instead of forcing stopped", async () => {
    const statuses = ["stopping", "completed"];
    const result = await pollRunRelease({
      delay: async () => {},
      readStatus: async () => statuses.shift(),
    });

    expect(result).toEqual({ released: true, status: "completed" });
  });

  it("reports unavailable and timeout polling as unresolved", async () => {
    await expect(pollRunRelease({
      delay: async () => {},
      readStatus: async () => { throw new Error("offline"); },
    })).resolves.toMatchObject({ released: false, reason: "unavailable" });

    await expect(pollRunRelease({
      attempts: 2,
      delay: async () => {},
      readStatus: async () => "stopping",
    })).resolves.toEqual({ released: false, status: "stopping", reason: "timeout" });
  });

  it("drops stale callbacks and finalizes only the current run with its real status", async () => {
    const onTerminal = vi.fn();
    await expect(executeStopLifecycle({
      requestStop: async () => ({ ok: true, status: "stopping" }),
      waitForRelease: async () => ({ released: true, status: "failed" }),
      isCurrentTarget: () => true,
      onTerminal,
    })).resolves.toBe("failed");
    expect(onTerminal).toHaveBeenCalledWith("failed");

    onTerminal.mockClear();
    await expect(executeStopLifecycle({
      requestStop: async () => ({ ok: true, status: "stopping" }),
      waitForRelease: async () => ({ released: true, status: "stopped" }),
      isCurrentTarget: () => false,
      onTerminal,
    })).resolves.toBe("stale");
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it("keeps an accepted but unresolved stop non-terminal", async () => {
    await expect(executeStopLifecycle({
      requestStop: async () => ({ ok: true, status: "stopping" }),
      waitForRelease: async () => ({ released: false, status: "stopping", reason: "timeout" }),
      isCurrentTarget: () => true,
      onTerminal: vi.fn(),
    })).resolves.toBe("status_unknown");
  });
});

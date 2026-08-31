import { describe, expect, it, vi } from "vitest";
import { terminalizeRun, type RunTerminalizationDependencies } from "./runTerminalization";

describe("optional usage never owns terminal state", () => {
  function deps(): RunTerminalizationDependencies {
    return { ownerId: "owner", finishRun: vi.fn().mockResolvedValue({ status: "success" }), getRun: vi.fn().mockResolvedValue(null),
      addEvent: vi.fn(), emitConversationUpdated: vi.fn(), setTerminalExpiry: vi.fn(), warn: vi.fn() };
  }
  it("publishes and returns even if the observer never completes", async () => {
    const dependencies = deps();
    dependencies.observeUsage = vi.fn(() => new Promise<void>(() => {}));
    await expect(terminalizeRun({ runId: "run", finalStatus: "completed", usage: { total_tokens: 0 } }, dependencies)).resolves.toBe(true);
    expect(dependencies.addEvent).toHaveBeenCalledTimes(2);
    expect(dependencies.finishRun).toHaveBeenCalledWith(expect.objectContaining({ usageTotalTokens: 0, usageEvidence: expect.objectContaining({ totalTokens: 0 }) }));
  });
  it("contains observer exceptions and never observes duplicate terminal or rejected commits", async () => {
    const dependencies = deps();
    dependencies.observeUsage = vi.fn().mockRejectedValue(new Error("PRIVATE"));
    await terminalizeRun({ runId: "run", finalStatus: "failed", usage: { total_tokens: 5 } }, dependencies);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dependencies.warn).toHaveBeenCalledWith("Optional run usage observation failed");
    for (const status of ["already_terminal", "lease_lost"]) {
      vi.mocked(dependencies.finishRun).mockResolvedValue({ status, assistant_message_id: null, assistant_sequence_no: null });
      await terminalizeRun({ runId: "run", finalStatus: "completed", usage: { total_tokens: 10 } }, dependencies);
    }
    expect(dependencies.observeUsage).toHaveBeenCalledTimes(1);
  });
});

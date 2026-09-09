import { describe, expect, it, vi } from "vitest";
import { terminalizeRun } from "./runTerminalization";

describe("interrupted run output retention", () => {
  it.each(["failed", "cancelled", "expired"] as const)("preserves observed output on %s without treating it as success", async (status) => {
    const finishRun = vi.fn().mockResolvedValue({ status: "success", assistant_message_id: null, assistant_sequence_no: null });
    await terminalizeRun({ runId: "interrupted", finalStatus: status, assistantContent: "", errorCode: "UPSTREAM_RUN_NOT_FOUND" }, {
      ownerId: "owner", finishRun,
      getRun: vi.fn().mockResolvedValue({ partial_output: "Already observed text" }),
      addEvent: vi.fn(), emitConversationUpdated: vi.fn(), setTerminalExpiry: vi.fn(), warn: vi.fn(),
    });
    expect(finishRun).toHaveBeenCalledWith(expect.objectContaining({ status, assistantContent: "Already observed text" }));
  });

  it("does not restore tool protocol from interrupted output", async () => {
    const finishRun = vi.fn().mockResolvedValue({ status: "success", assistant_message_id: null, assistant_sequence_no: null });
    await terminalizeRun({ runId: "interrupted", finalStatus: "failed", assistantContent: "" }, {
      ownerId: "owner", finishRun,
      getRun: vi.fn().mockResolvedValue({ partial_output: '<｜DSML｜function_calls><｜DSML｜invoke name="exec">' }),
      addEvent: vi.fn(), emitConversationUpdated: vi.fn(), setTerminalExpiry: vi.fn(), warn: vi.fn(),
    });
    expect(finishRun).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", assistantContent: "" }));
  });
});

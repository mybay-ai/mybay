import type { RunExecutionState } from "./runTypes";
import type { TerminalRunStatus } from "../runUiLifecycle";

export function finalizeRunExecution(
  state: RunExecutionState,
  status: TerminalRunStatus,
  finishedAt = Date.now()
): RunExecutionState {
  return {
    ...state,
    status,
    blocks: state.blocks.map((block) => {
      if (block.type === "approval" && block.status === "pending") {
        return { ...block, status: "expired" as const };
      }
      if (block.type !== "tool" || block.status !== "running") return block;
      const completedAt = Math.max(finishedAt, block.startedAt || finishedAt);
      return {
        ...block,
        status: status === "completed" ? "completed" : "failed",
        completedAt,
        durationMs: block.startedAt ? Math.max(0, completedAt - block.startedAt) : block.durationMs
      };
    })
  };
}

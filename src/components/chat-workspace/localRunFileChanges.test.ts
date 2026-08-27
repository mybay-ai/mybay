import { describe, expect, it } from "vitest";
import { collectLocalRunFileChanges } from "./localRunFileChanges";

describe("local run file changes", () => {
  it("combines generated artifacts with local tool metadata", () => {
    const result = collectLocalRunFileChanges({
      runId: "run-1", status: "completed", assistantText: "", blocks: [
        { id: "tool-1", type: "tool", firstSeq: 1, lastSeq: 2, toolCallId: "call-1", tool: "edit_file", status: "completed", metadata: { file_path: "/opt/data/outputs/web/app.tsx", operation: "modify" } },
        { id: "tool-2", type: "tool", firstSeq: 3, lastSeq: 4, toolCallId: "call-2", tool: "delete_file", status: "completed", metadata: { path: "outputs/old.txt", action: "delete" } },
      ], lastProcessedSeq: 4,
    }, [{ path: "outputs/new.html", name: "new.html", messageId: "m1", runId: "run-1", requestId: null, status: "ready" }]);
    expect(result).toEqual([
      { path: "outputs/new.html", kind: "added" },
      { path: "outputs/web/app.tsx", kind: "modified" },
      { path: "outputs/old.txt", kind: "deleted" },
    ]);
  });
});

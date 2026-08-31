import { describe, expect, it } from "vitest";
import { collectLocalRunFileChanges } from "./localRunFileChanges";
import { createRunExecutionState, runReducer } from "./run/runReducer";

describe("local run file changes", () => {
  it("combines generated artifacts with local tool metadata", () => {
    const result = collectLocalRunFileChanges({
      runId: "run-1", status: "completed", assistantText: "", blocks: [
        { id: "tool-1", type: "tool", firstSeq: 1, lastSeq: 2, toolCallId: "call-1", tool: "edit_file", status: "completed", metadata: { file_path: "/opt/data/outputs/web/app.tsx", operation: "modify" } },
        { id: "tool-2", type: "tool", firstSeq: 3, lastSeq: 4, toolCallId: "call-2", tool: "delete_file", status: "completed", metadata: { path: "outputs/old.txt", action: "delete" } },
      ], lastProcessedSeq: 4,
    }, [{ path: "outputs/new.html", name: "new.html", messageId: "m1", runId: "run-1", requestId: null, status: "ready" }]);
    expect(result).toEqual([
      { path: "outputs/new.html", kind: "referenced" },
      { path: "outputs/web/app.tsx", kind: "modified" },
      { path: "outputs/old.txt", kind: "deleted" },
    ]);
  });

  const artifact = { path: "report.html", name: "report.html", messageId: "m1", runId: "run-1", requestId: null, status: "ready" as const };
  const execution = (blocks: any[], runId = "run-1") => ({ runId, status: "completed" as const, blocks, lastProcessedSeq: 9 });
  const tool = (operation: string, status = "completed", path = "/opt/data/report.html") => ({ id: operation, type: "tool", status, tool: "terminal", metadata: { operation, path } });

  it("does not turn an existing file reference into a mutation after reload", () => {
    expect(collectLocalRunFileChanges(null, [artifact])).toEqual([{ path: "report.html", kind: "referenced" }]);
    expect(collectLocalRunFileChanges(execution([tool("read")]), [artifact])).toEqual([{ path: "report.html", kind: "referenced" }]);
  });

  it.each(["running", "failed"])("does not count a %s mutation attempt", status => {
    expect(collectLocalRunFileChanges(execution([tool("create", status)]), [artifact])[0].kind).toBe("referenced");
  });

  it.each([["create", "added"], ["modify", "modified"], ["delete", "deleted"], ["write", "unknown"]])("uses completed %s evidence as %s", (operation, kind) => {
    expect(collectLocalRunFileChanges(execution([tool(operation)]), [artifact])).toEqual([{ path: "report.html", kind }]);
  });

  it("does not borrow file changes from another run or an unbound legacy message", () => {
    expect(collectLocalRunFileChanges(execution([tool("delete")], "other-run"), [artifact])[0].kind).toBe("referenced");
    expect(collectLocalRunFileChanges(execution([tool("delete")]), [{ ...artifact, runId: null }])[0].kind).toBe("referenced");
  });

  it("does not guess operations from labels or substrings", () => {
    expect(collectLocalRunFileChanges(execution([{ ...tool(""), label: "create report", tool: "address_lookup" }]), [artifact])[0].kind).toBe("referenced");
  });

  it.each(["/etc/passwd", "../secret.txt", "C:/secret.txt", "outputs/../secret.txt"])("rejects an unsafe event path %s", path => {
    expect(collectLocalRunFileChanges(execution([tool("create", "completed", path)]), [])).toEqual([]);
  });

  it("retains creation evidence through later edits and reads", () => {
    expect(collectLocalRunFileChanges(execution([tool("create"), tool("modify"), tool("read")]), [artifact])[0].kind).toBe("added");
  });

  it("does not treat run-level completion as successful tool evidence", () => {
    const initial = createRunExecutionState({ runId: "run-1" });
    const started = runReducer(initial, { runId: "run-1", seq: 1, type: "tool.started", payload: { id: "create-1", tool: "create_file", metadata: { path: "/opt/data/report.html" } } });
    const finished = runReducer(started, { runId: "run-1", seq: 2, type: "status.changed", payload: { status: "completed" } });
    expect(collectLocalRunFileChanges(finished, [artifact])[0].kind).toBe("referenced");
    const confirmed = runReducer(started, { runId: "run-1", seq: 2, type: "tool.completed", payload: { id: "create-1", tool: "create_file" } });
    expect(collectLocalRunFileChanges(confirmed, [artifact])[0].kind).toBe("added");
  });
});

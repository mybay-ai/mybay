import { describe, expect, it } from "vitest";
import type { LocalRunFileDiffs } from "../../../shared/localRunFileDiff";
import { confirmFileChangesWithSnapshots } from "./runFileEvidence";

function diffs(files: LocalRunFileDiffs["files"]): LocalRunFileDiffs {
  return {
    version: 1,
    runId: "run-1",
    conversationId: "conversation-1",
    capturedBefore: "2026-09-05T08:00:00.000Z",
    capturedAfter: "2026-09-05T08:00:01.000Z",
    files,
  };
}

describe("run file evidence snapshot confirmation", () => {
  it("confirms added, modified and deleted operations from before/after snapshots", () => {
    expect(confirmFileChangesWithSnapshots([
      { path: "new.txt", kind: "unknown" },
      { path: "changed.txt", kind: "unknown" },
      { path: "removed.txt", kind: "unknown" },
    ], diffs([
      { path: "new.txt", before: null, after: "new" },
      { path: "changed.txt", before: "old", after: "new" },
      { path: "removed.txt", before: "old", after: null },
    ]))).toEqual([
      { path: "new.txt", kind: "added" },
      { path: "changed.txt", kind: "modified" },
      { path: "removed.txt", kind: "deleted" },
    ]);
  });

  it("keeps conservative Runtime evidence when a snapshot is unavailable or unchanged", () => {
    const changes = [
      { path: "binary.pdf", kind: "unknown" as const },
      { path: "same.txt", kind: "unknown" as const },
    ];
    expect(confirmFileChangesWithSnapshots(changes, undefined)).toEqual(changes);
    expect(confirmFileChangesWithSnapshots(changes, diffs([
      { path: "same.txt", before: "same", after: "same" },
    ]))).toEqual(changes);
  });
});

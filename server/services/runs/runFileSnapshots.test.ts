import { describe, expect, it } from "vitest";
import { getStoredFileDiff, isSnapshotPath, pruneRunFileDiffs, validateRunFileDiffs } from "./runFileSnapshots";

const snapshot = { version: 1, runId: "r", conversationId: "c", capturedBefore: "2026-08-31T00:00:00Z", capturedAfter: "2026-08-31T00:00:01Z", files: [{ path: "src/a.ts", before: "old", after: "new" }] };
describe("file snapshot boundaries", () => {
  it.each(["../a.ts", "/etc/a.txt", ".env", "src/.hidden/a.ts", "node_modules/a.js", "src/settings.json", "private/a.txt", "a.db", "a.zip", "a.png", "a%2f.ts", "a\\b.ts", "a..env", "auth.json", "sessions/a.json", "home/a.txt", "skills/a.md", "mybay.system.md", "state.json"]) ("excludes %s", name => {
    expect(isSnapshotPath(name)).toBe(false);
  });
  it("binds snapshots to both the task and conversation", () => {
    expect(validateRunFileDiffs(snapshot, "other", "c")).toBeUndefined();
    expect(validateRunFileDiffs(snapshot, "r", "other")).toBeUndefined();
    expect(getStoredFileDiff({ id: "r", conversation_id: "c", file_diffs: snapshot }, "src/a.ts")).toMatchObject({ available: true, file: snapshot.files[0] });
    expect(getStoredFileDiff({ id: "r", conversation_id: "c" }, "src/a.ts")).toEqual({ available: false });
  });
  it("never retains a safe after image if the before image was sensitive", () => {
    const files = [
      { path: "a.ts", before: "sk-" + "a".repeat(24), after: "safe" },
      { path: "b.ts", before: "safe", after: "password = abcdefghijklmnop" },
      { path: "c.ts", before: "x".repeat(32769), after: "small" },
      { path: "d.ts", before: "\0binary", after: "text" },
      { path: "e.ts", before: "\n".repeat(1001), after: "text" },
      { path: "empty.ts", before: null, after: "" },
    ];
    expect(validateRunFileDiffs({ ...snapshot, files }, "r", "c")?.files).toEqual([files[5]]);
  });
  it("only expires snapshot fields, keeping all historical messages and provenance", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i, completed_at: new Date(i * 1000).toISOString(), file_diffs: snapshot, file_evidence: { marker: i } }));
    pruneRunFileDiffs(rows);
    expect(rows.filter(r => r.file_diffs)).toHaveLength(20);
    expect(rows[0].file_diffs).toBeUndefined();
    expect(rows[24].file_diffs).toEqual(snapshot);
    expect(rows.map(r => r.file_evidence.marker)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });
});

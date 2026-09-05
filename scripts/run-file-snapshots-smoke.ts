/** Run after the application build on Linux; all fixture data stays under a temporary directory. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRunFileSnapshots, readSnapshotFile } from "../server/services/runs/runFileSnapshots";

assert.equal(process.platform, "linux");
const workerPath = path.resolve("dist/run-file-snapshot-worker.cjs");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "mybay-file-diff-"));
process.chdir(scratch);
const root = path.join(scratch, "data/instances/test-instance");
await fs.mkdir(root, { recursive: true });
const write = (name: string, text: string) => fs.writeFile(path.join(root, name), text);
await write("edit.txt", "BEFORE\n");
await write("delete.txt", "DELETE\n");
await write("same.txt", "SAME\n");
await write("big.txt", "x".repeat(32769));
await write("binary.txt", "\0BINARY");
await write("protected.ts", "sk-" + "a".repeat(24));
const snapshots = createRunFileSnapshots(undefined, workerPath);
await snapshots.before("r", "test-instance", true);
await write("edit.txt", "AFTER\n");
await write("new.txt", "");
await fs.unlink(path.join(root, "delete.txt"));
await write("big.txt", "small");
await write("binary.txt", "text");
await write("protected.ts", "safe");
await snapshots.before("r", "test-instance", false);
const changes = ["edit.txt", "new.txt", "delete.txt", "same.txt", "big.txt", "binary.txt", "protected.ts"].map(p => ({ path: p, kind: "unknown" as const }));
const result = await snapshots.after("r", "c", changes);
assert.deepEqual(result?.files, [
  { path: "edit.txt", before: "BEFORE\n", after: "AFTER\n" },
  { path: "new.txt", before: null, after: "" },
  { path: "delete.txt", before: "DELETE\n", after: null },
  { path: "same.txt", before: "SAME\n", after: "SAME\n" },
]);
await write("edit.txt", "LATER");
assert.deepEqual(await snapshots.after("r", "c", changes), result);
snapshots.clear("r");
await snapshots.before("r", "test-instance", false);
assert.equal(await snapshots.after("r", "c", changes), undefined);
const outside = path.join(scratch, "outside");
await fs.mkdir(outside);
await fs.writeFile(path.join(outside, "a.txt"), "OUTSIDE");
await fs.symlink(path.join(outside, "a.txt"), path.join(root, "link.txt"));
await fs.symlink(outside, path.join(root, "linked"));
await fs.symlink(path.join(outside, "absent"), path.join(root, "broken"));
await fs.link(path.join(outside, "a.txt"), path.join(root, "hard.txt"));
for (const name of ["link.txt", "linked/a.txt", "linked/missing.txt", "broken/a.txt", "hard.txt"]) assert.equal(await readSnapshotFile(root, name), undefined, name);
await write("late.ts", "safe");
await snapshots.before("sensitive-after", "test-instance", true);
await write("late.ts", "password = abcdefghijklmnop");
assert.deepEqual((await snapshots.after("sensitive-after", "c", [{ path: "late.ts", kind: "modified" }]))?.files, []);
await snapshots.before("limited", "test-instance", true);
await write("not-scanned.txt", "NEW");
assert.deepEqual((await snapshots.after("limited", "c", [{ path: "not-scanned.txt", kind: "added" }]))?.files, [{ path: "not-scanned.txt", before: null, after: "NEW" }]);
await snapshots.before("replaced-link", "test-instance", true);
await fs.unlink(path.join(root, "linked"));
await fs.mkdir(path.join(root, "linked"));
await fs.writeFile(path.join(root, "linked/a.txt"), "now-local");
assert.deepEqual((await snapshots.after("replaced-link", "c", [{ path: "linked/a.txt", kind: "modified" }]))?.files, []);
// A huge internal runtime directory must not exhaust the user-file scan.
await fs.mkdir(path.join(root, "home"));
for (let i = 0; i < 550; i++) await write(`home/${i}.txt`, "internal");
await snapshots.before("runtime-noise", "test-instance", true);
await write("fresh.txt", "user-file");
assert.deepEqual((await snapshots.after("runtime-noise", "c", [{ path: "fresh.txt", kind: "added" }]))?.files, [{ path: "fresh.txt", before: null, after: "user-file" }]);
await fs.mkdir(path.join(root, "huge"));
for (let i = 0; i < 550; i++) await write(`huge/${i}.txt`, "user");
await snapshots.before("incomplete", "test-instance", true);
await write("huge/new.txt", "new");
assert.deepEqual((await snapshots.after("incomplete", "c", [{ path: "huge/new.txt", kind: "added" }]))?.files, []);
// Occupy every default fs worker in the parent. The snapshot subprocess must still finish.
const pipes = Array.from({ length: 4 }, (_, i) => path.join(scratch, `pipe-${i}`));
execFileSync("mkfifo", pipes);
const blocked = pipes.map(p => fs.open(p, "r"));
try {
  await snapshots.before("busy-parent", "test-instance", true);
  const observed = await snapshots.after("busy-parent", "c", [{ path: "edit.txt", kind: "modified" }]);
  assert.equal(observed?.files[0]?.before, "LATER");
  assert.equal(observed?.files[0]?.after, "LATER");
} finally {
  execFileSync(process.execPath, ["-e", "const fs=require('fs');for(const p of process.argv.slice(1))fs.closeSync(fs.openSync(p,'w'));", ...pipes]);
  for (const handle of await Promise.all(blocked)) await handle.close();
}
const unavailableWorker = createRunFileSnapshots(undefined, "/missing-worker.cjs");
await unavailableWorker.before("unavailable", "test-instance", true);
assert.equal(await unavailableWorker.after("unavailable", "c", changes), undefined);
console.log(JSON.stringify({ passed: true, checks: ["real-before-after", "added-empty", "deleted", "unchanged", "size", "binary", "secret-before-after", "symlink", "parent-symlink", "broken-symlink", "hardlink", "retry-baseline", "terminal-retry", "missing-baseline", "per-directory-absence", "runtime-noise", "incomplete-directory", "saturated-parent-fs-pool", "worker-unavailable"] }));

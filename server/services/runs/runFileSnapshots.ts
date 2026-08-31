import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { safeLocalEvidencePath, type LocalFileChange } from "../../../shared/localRunFileEvidence";
import type { FileDiffResponse, LocalRunFileDiffs } from "../../../shared/localRunFileDiff";
import { containsSecretContent, isBlockedExportFileName } from "../instances/instanceFileLeakGuard";

export const SNAPSHOT_FILE_BYTES = 32 * 1024;
const MAX_FILES = 64, MAX_BYTES = 512 * 1024, MAX_ENTRIES = 500, MAX_DEPTH = 4;
const textExtensions = /\.(?:txt|md|markdown|html?|css|scss|js|jsx|ts|tsx|json|csv|xml|svg|py|sh|sql)$/i;
const runtimeDirectories = new Set(["audio_cache", "backups", "bin", "cache", "cron", "home", "hooks", "image_cache", "kanban", "lazy-packages", "logs", "memories", "pairing", "pending_messages", "platforms", "sandboxes", "sessions", "skills", "skins", "state"]);
function isSnapshotScope(value: string): boolean {
  const safe = safeLocalEvidencePath(value);
  if (!safe || safe !== value) return false;
  const parts = safe.split("/");
  if (runtimeDirectories.has(parts[0]) || /^(?:auth(?:\.|$)|channel_directory\.|gateway[._-]|models_dev_cache\.|mybay\.|main_mybay_run\.|spawn-ledger\.|response_store\.|state\.|kanban\.)/i.test(parts[0])) return false;
  return parts.every(part => !part.startsWith(".") && !["node_modules", "__pycache__", "vendor"].includes(part) && !isBlockedExportFileName(part));
}
function safeSnapshotText(text: string): boolean {
  return text.split("\n").length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) && !containsSecretContent(text);
}
export function isSnapshotPath(value: unknown): value is string {
  return typeof value === "string" && isSnapshotScope(value) && textExtensions.test(value);
}
type Observation = { text: string | null } | undefined;
type Baseline = { root: string; time: string; files: Map<string, Observation>; directories: Map<string, Set<string>> };

/** Linux FD anchoring rejects parent-link races, final symlinks, hardlinks and special files.
 * Unsupported hosts fail closed; the managed Docker control plane runs on Linux. */
export async function readSnapshotFile(root: string, relative: string): Promise<Observation> {
  if (process.platform !== "linux" || !isSnapshotPath(relative)) return undefined;
  const target = path.join(root, relative);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const canonical = await fs.realpath(`/proc/self/fd/${handle.fd}`);
    if (canonical !== target || !canonical.startsWith(root + path.sep)) return undefined;
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > SNAPSHOT_FILE_BYTES) return undefined;
    const buffer = Buffer.alloc(SNAPSHOT_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const end = await handle.stat();
    if (bytesRead !== stat.size || bytesRead > SNAPSHOT_FILE_BYTES || end.size !== stat.size || end.mtimeMs !== stat.mtimeMs || end.ctimeMs !== stat.ctimeMs) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    if (!safeSnapshotText(text)) return undefined;
    return { text };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
    // Missing is evidence only when every existing ancestor is a real directory.
    let parent = path.dirname(target);
    while (parent.startsWith(root + path.sep) || parent === root) {
      try {
        if (!(await fs.lstat(parent)).isDirectory() || await fs.realpath(parent) !== parent) return undefined;
        return { text: null };
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") return undefined; }
      parent = path.dirname(parent);
    }
    return undefined;
  } finally { await handle?.close().catch(() => undefined); }
}

export async function captureRunFileBaseline(root: string): Promise<Baseline> {
  const result: Baseline = { root, time: new Date().toISOString(), files: new Map(), directories: new Map() };
  let entries = 0, bytes = 0, files = 0;
  const deadline = Date.now() + 1500;
  const queue = [{ relative: "", depth: 0 }];
  async function scan(relative: string, depth: number): Promise<void> {
    const directory = path.join(root, relative);
    if (await fs.realpath(directory) !== directory) return;
    const dir = await fs.opendir(directory);
    const names = new Set<string>();
    const candidates: string[] = [];
    let complete = true;
    for await (const entry of dir) {
      if (++entries > MAX_ENTRIES || Date.now() > deadline) { complete = false; break; }
      names.add(entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!isSnapshotScope(name) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { queue.push({ relative: name, depth: depth + 1 }); continue; }
      if (!isSnapshotPath(name)) continue;
      // Track rejected existing files too: lack of content must never imply a new file.
      result.files.set(name, undefined);
      if (entry.isFile()) candidates.push(name);
    }
    if (complete) result.directories.set(relative, names);
    // Read this directory's files before descending into any child directory.
    for (const name of candidates) {
      if (++files > MAX_FILES || bytes >= MAX_BYTES || Date.now() > deadline) break;
      const value = await readSnapshotFile(root, name);
      if (value?.text == null) continue; // A file disappeared during the scan: no baseline.
      bytes += Buffer.byteLength(value.text);
      if (bytes <= MAX_BYTES) result.files.set(name, value);
    }
  }
  while (queue.length && entries < MAX_ENTRIES && Date.now() <= deadline) {
    const next = queue.shift()!;
    if (next.depth <= MAX_DEPTH) await scan(next.relative, next.depth).catch(() => undefined);
  }
  return result;
}

function wasMissing(baseline: Baseline, relative: string): boolean {
  let directory = "";
  for (const part of relative.split("/")) {
    const names = baseline.directories.get(directory);
    if (!names) return false;
    if (!names.has(part)) return true;
    directory = directory ? `${directory}/${part}` : part;
  }
  return false;
}

export type RunFileSnapshotObservation = { runId: string; phase: "before" | "after" | "clear"; available: boolean; files: number; directories?: number };
/** Separate process: control-plane storage scans can saturate Node's shared fs thread pool.
 * Its pipe is private, bounded, never logged; a timeout discards the optional snapshot. */
async function snapshotWorker(mode: "before" | "after", root: string, paths: string[], workerPath?: string): Promise<unknown> {
  const args = workerPath ? [workerPath] : process.env.NODE_ENV === "production"
    ? [path.resolve("dist/run-file-snapshot-worker.cjs")]
    : ["--import", "tsx", path.resolve("server/services/runs/runFileSnapshotWorker.ts")];
  return new Promise(resolve => execFile(process.execPath, [...args, mode, root, JSON.stringify(paths)],
    { timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { resolve(undefined); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(undefined); }
    }));
}

export function createRunFileSnapshots(observe?: (event: RunFileSnapshotObservation) => void, workerPath?: string) {
  const report = (event: RunFileSnapshotObservation) => { try { observe?.(event); } catch { /* Diagnostics never change run execution. */ } };
  const baselines = new Map<string, Promise<Baseline | undefined>>();
  const finished = new Map<string, Promise<LocalRunFileDiffs | undefined>>();
  return {
    async before(runId: string, instanceId: string, firstAttempt: boolean) {
      if (baselines.has(runId)) { await baselines.get(runId); return; }
      if (!firstAttempt) return;
      while (baselines.size >= 32) { const id = baselines.keys().next().value!; baselines.delete(id); finished.delete(id); }
      const pending = (async () => {
        if (process.platform !== "linux" || !/^[a-zA-Z0-9-]{1,100}$/.test(instanceId)) return undefined;
        const value = await snapshotWorker("before", path.resolve("data/instances", instanceId), [], workerPath) as {
          root: string; time: string; files: Array<[string, Observation]>; directories: Array<[string, string[]]>;
        } | undefined;
        return value ? { root: value.root, time: value.time, files: new Map(value.files), directories: new Map(value.directories.map(([name, names]) => [name, new Set(names)])) } : undefined;
      })().catch(() => undefined);
      baselines.set(runId, pending);
      const captured = await pending;
      report({ runId, phase: "before", available: !!captured, files: captured ? [...captured.files.values()].filter(Boolean).length : 0, directories: captured?.directories.size ?? 0 });
    },
    async after(runId: string, conversationId: string, changes: LocalFileChange[]): Promise<LocalRunFileDiffs | undefined> {
      if (finished.has(runId)) return finished.get(runId);
      const pending = (async () => {
        const baseline = await baselines.get(runId);
        if (!baseline) { report({ runId, phase: "after", available: false, files: 0 }); return undefined; }
        const files: LocalRunFileDiffs["files"] = [];
        const candidates = changes.filter(c => c.kind !== "referenced" && isSnapshotPath(c.path)).slice(0, 8);
        const observations = candidates.length ? await snapshotWorker("after", baseline.root, candidates.map(c => c.path), workerPath) as Observation[] | undefined : [];
        for (const [index, change] of candidates.entries()) {
          if (!isSnapshotPath(change.path)) continue;
          const before = baseline.files.has(change.path) ? baseline.files.get(change.path) : wasMissing(baseline, change.path) ? { text: null } : undefined;
          if (!before) continue;
          const after = observations?.[index];
          if (!after || before.text === null && after.text === null) continue;
          files.push({ path: change.path, before: before.text, after: after.text });
        }
        report({ runId, phase: "after", available: true, files: files.length });
        return { version: 1 as const, runId, conversationId, capturedBefore: baseline.time, capturedAfter: new Date().toISOString(), files };
      })().catch(() => undefined);
      // Keep the first terminal observation even if the database write is retried.
      if (baselines.has(runId)) finished.set(runId, pending);
      return pending;
    },
    clear(runId: string) { if (baselines.has(runId)) report({ runId, phase: "clear", available: false, files: 0 }); baselines.delete(runId); finished.delete(runId); },
  };
}

/** Revalidate at persistence and read boundaries, including secret content in either version. */
export function validateRunFileDiffs(value: unknown, runId: string, conversationId: string): LocalRunFileDiffs | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as LocalRunFileDiffs;
  if (v.version !== 1 || v.runId !== runId || v.conversationId !== conversationId || !Array.isArray(v.files)
    || typeof v.capturedBefore !== "string" || typeof v.capturedAfter !== "string"
    || !Number.isFinite(Date.parse(v.capturedBefore)) || !Number.isFinite(Date.parse(v.capturedAfter))) return undefined;
  const safeText = (text: unknown) => text === null || typeof text === "string" && Buffer.byteLength(text) <= SNAPSHOT_FILE_BYTES
    && safeSnapshotText(text);
  return { version: 1, runId, conversationId, capturedBefore: v.capturedBefore, capturedAfter: v.capturedAfter,
    files: v.files.slice(0, 8).filter(f => f && isSnapshotPath(f.path) && safeText(f.before) && safeText(f.after)
      && !(f.before === null && f.after === null)).map(f => ({ path: f.path, before: f.before, after: f.after })) };
}

export function getStoredFileDiff(run: { id: string; conversation_id: string; file_diffs?: unknown }, requestedPath: string): FileDiffResponse {
  const diffs = validateRunFileDiffs(run.file_diffs, run.id, run.conversation_id);
  const file = diffs?.files.find(f => f.path === requestedPath);
  return file && diffs ? { available: true, file, capturedBefore: diffs.capturedBefore, capturedAfter: diffs.capturedAfter } : { available: false };
}

export function pruneRunFileDiffs(runs: Array<{ file_diffs?: unknown; completed_at?: string }>): void {
  // Only our optional snapshots expire; messages, run history and file provenance stay intact.
  const retained = runs.filter(r => r.file_diffs).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  for (const run of retained.slice(20)) delete run.file_diffs;
}

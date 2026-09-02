import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { captureRunFileBaseline, readSnapshotFile } from "./runFileSnapshots";

type SnapshotWorkerRequest = { id?: unknown; mode?: unknown; root?: unknown; paths?: unknown };

async function executeSnapshotRequest(mode: unknown, requestedRoot: unknown, requestedPaths: unknown): Promise<unknown> {
  if (process.platform !== "linux" || typeof requestedRoot !== "string" || !path.isAbsolute(requestedRoot)) return;
  const root = await fs.realpath(requestedRoot);
  if (root !== requestedRoot) return;
  if (mode === "before") {
    const baseline = await captureRunFileBaseline(root);
    return { ...baseline, files: [...baseline.files], directories: [...baseline.directories].map(([name, names]) => [name, [...names]]) };
  } else if (mode === "after") {
    const paths: unknown = requestedPaths;
    if (!Array.isArray(paths) || paths.length > 8 || paths.some(p => typeof p !== "string")) return;
    const values = [];
    for (const relative of paths) values.push(await readSnapshotFile(root, relative));
    return values;
  }
}

async function runOneShot() {
  const [mode, requestedRoot, rawPaths] = process.argv.slice(2);
  let paths: unknown;
  try { paths = JSON.parse(rawPaths); } catch { return; }
  const value = await executeSnapshotRequest(mode, requestedRoot, paths);
  if (value !== undefined) process.stdout.write(JSON.stringify(value));
}

async function runServer() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || Buffer.byteLength(line) > 64 * 1024) continue;
    let request: SnapshotWorkerRequest;
    try { request = JSON.parse(line); } catch { continue; }
    const id = String(request.id || "");
    if (!/^snapshot-\d+$/.test(id)) continue;
    void executeSnapshotRequest(request.mode, request.root, request.paths)
      .then(value => process.stdout.write(`${JSON.stringify({ id, ok: value !== undefined, value: value ?? null })}\n`))
      .catch(() => process.stdout.write(`${JSON.stringify({ id, ok: false })}\n`));
  }
}

if (process.argv[2] === "--server") void runServer().catch(() => { process.exitCode = 1; });
else void runOneShot().catch(() => { process.exitCode = 1; });

import fs from "node:fs/promises";
import path from "node:path";
import { captureRunFileBaseline, readSnapshotFile } from "./runFileSnapshots";

async function main() {
  const [mode, requestedRoot, rawPaths] = process.argv.slice(2);
  if (process.platform !== "linux" || !requestedRoot || !path.isAbsolute(requestedRoot)) return;
  const root = await fs.realpath(requestedRoot);
  if (root !== requestedRoot) return;
  if (mode === "before") {
    const baseline = await captureRunFileBaseline(root);
    process.stdout.write(JSON.stringify({ ...baseline, files: [...baseline.files], directories: [...baseline.directories].map(([name, names]) => [name, [...names]]) }));
  } else if (mode === "after") {
    const paths: unknown = JSON.parse(rawPaths);
    if (!Array.isArray(paths) || paths.length > 8 || paths.some(p => typeof p !== "string")) return;
    const values = [];
    for (const relative of paths) values.push(await readSnapshotFile(root, relative));
    process.stdout.write(JSON.stringify(values));
  }
}

void main().catch(() => { process.exitCode = 1; });

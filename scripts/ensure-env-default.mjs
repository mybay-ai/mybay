import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function ensureEnvDefault(filePath, key, value) {
  const absolutePath = path.resolve(filePath);
  const existing = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${escapedKey}=`, "m").test(existing)) return false;

  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(absolutePath, `${separator}\n${key}=${value}\n`, "utf8");
  return true;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const [, , filePath, key, value] = process.argv;
  if (!filePath || !key || value === undefined) {
    console.error("Usage: node scripts/ensure-env-default.mjs <env-file> <key> <value>");
    process.exitCode = 2;
  } else {
    ensureEnvDefault(filePath, key, value);
  }
}

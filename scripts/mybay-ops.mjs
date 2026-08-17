import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Docker from "dockerode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const schemaVersion = require("../shared/schema-version.json");
const BACKUP_FORMAT_VERSION = 1;
export const MAX_SUPPORTED_SCHEMA_VERSION = schemaVersion.current;
const OWNER_DIRECTORY_MODE = 0o700;
const OWNER_FILE_MODE = 0o600;

function parseArgs(argv) {
  const args = { command: argv[0] || "doctor", json: false, database: "", output: "", backup: "" };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") args.json = true;
    else if (value === "--database") args.database = argv[++index] || "";
    else if (value === "--output") args.output = argv[++index] || "";
    else if (value === "--backup") args.backup = argv[++index] || "";
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function databasePath(value = "") {
  return path.resolve(ROOT, value || process.env.MYBAY_SQLITE_PATH || "data/mybay.sqlite");
}

function readSchemaVersion(db) {
  const row = db.prepare("SELECT value FROM localMetadata WHERE key = ?").get("schema_version");
  const version = Number(row?.value);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("SQLite schema version is missing or invalid.");
  return version;
}

function checkSqlite(file) {
  if (!fs.existsSync(file)) throw new Error(`SQLite database does not exist: ${file}`);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get();
    if (row?.integrity_check !== "ok") throw new Error(`SQLite integrity_check failed: ${String(row?.integrity_check || "unknown")}`);
    return { integrity: "ok", schemaVersion: readSchemaVersion(db) };
  } finally {
    db.close();
  }
}

function secretCheck(name, value, validator) {
  if (!value) return { name, status: "fail", detail: "not configured" };
  return validator(value)
    ? { name, status: "pass", detail: "configured" }
    : { name, status: "fail", detail: "configured but invalid" };
}

export async function runDoctor(options = {}) {
  const checks = [];
  const dbFile = databasePath(options.database);
  try {
    const sqlite = checkSqlite(dbFile);
    checks.push({ name: "sqlite", status: "pass", detail: `integrity ok; schema ${sqlite.schemaVersion}` });
  } catch (error) {
    checks.push({ name: "sqlite", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }

  checks.push(secretCheck("ENCRYPTION_KEY", process.env.ENCRYPTION_KEY, (value) => /^[a-f0-9]{64}$/i.test(value)));
  checks.push(secretCheck("JWT_SECRET", process.env.JWT_SECRET, (value) => Buffer.byteLength(value) >= 32));
  checks.push(secretCheck("MYBAY_INTERNAL_ROUTING_SECRET", process.env.MYBAY_INTERNAL_ROUTING_SECRET, (value) => /^[a-f0-9]{64}$/i.test(value)));

  try {
    const docker = new Docker(process.platform === "win32" ? { socketPath: "//./pipe/docker_engine" } : { socketPath: "/var/run/docker.sock" });
    await docker.ping();
    checks.push({ name: "docker-daemon", status: "pass", detail: "reachable" });
  } catch {
    checks.push({ name: "docker-daemon", status: "fail", detail: "not reachable with current socket permissions" });
  }

  try {
    const disk = fs.statfsSync(path.dirname(dbFile));
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    checks.push({
      name: "disk",
      status: freeBytes >= 1024 * 1024 * 1024 ? "pass" : "warn",
      detail: `${Math.floor(freeBytes / 1024 / 1024)} MiB available`,
    });
  } catch (error) {
    checks.push({ name: "disk", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    deploymentMode: String(process.env.DEPLOYMENT_MODE || "desktop"),
    checks,
  };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(directory, relative = "") {
  const current = path.join(directory, relative);
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) return listFiles(directory, child);
    if (!entry.isFile()) throw new Error(`Backup contains an unsupported filesystem entry: ${child}`);
    return [child.replaceAll("\\", "/")];
  });
}

function restrictBackupPermissions(target, mode) {
  if (process.platform === "win32") return;
  fs.chmodSync(target, mode);
}

function restrictBackupTree(target) {
  if (process.platform === "win32") return;
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) {
    restrictBackupPermissions(target, OWNER_DIRECTORY_MODE);
    for (const entry of fs.readdirSync(target)) restrictBackupTree(path.join(target, entry));
    return;
  }
  if (!stat.isFile()) throw new Error(`Backup contains an unsupported filesystem entry: ${target}`);
  restrictBackupPermissions(target, OWNER_FILE_MODE);
}

function copyOptionalDataDirectory(name, destination, sourceDataRoot) {
  const source = path.join(sourceDataRoot, name);
  if (!fs.existsSync(source)) return;
  const target = path.join(destination, "data", name);
  fs.cpSync(source, target, { recursive: true, errorOnExist: true });
  restrictBackupTree(target);
}

export async function createBackup(options = {}) {
  const dbFile = databasePath(options.database);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.resolve(ROOT, options.output || path.join("backups", `mybay-backup-${stamp}`));
  if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  fs.mkdirSync(destination, { recursive: true, mode: OWNER_DIRECTORY_MODE });
  restrictBackupPermissions(destination, OWNER_DIRECTORY_MODE);
  const dataDirectory = path.join(destination, "data");
  fs.mkdirSync(dataDirectory, { mode: OWNER_DIRECTORY_MODE });
  restrictBackupPermissions(dataDirectory, OWNER_DIRECTORY_MODE);

  const snapshot = path.join(destination, "data", "mybay.sqlite");
  const source = new DatabaseSync(dbFile);
  try {
    await sqliteBackup(source, snapshot);
  } finally {
    source.close();
  }
  const sqlite = checkSqlite(snapshot);
  copyOptionalDataDirectory("instances", destination, path.dirname(dbFile));
  restrictBackupPermissions(snapshot, OWNER_FILE_MODE);
  copyOptionalDataDirectory("uploads", destination, path.dirname(dbFile));

  const files = listFiles(destination).map((relativePath) => ({
    path: relativePath,
    sha256: sha256(path.join(destination, relativePath)),
  }));
  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    mybayVersion: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version,
    schemaVersion: sqlite.schemaVersion,
    includes: ["data/mybay.sqlite", "data/instances (when present)", "data/uploads (when present)"],
    excludes: ["logs", "cache", "runtime images", ".env"],
    files,
  };
  const manifestPath = path.join(destination, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: OWNER_FILE_MODE });
  restrictBackupPermissions(manifestPath, OWNER_FILE_MODE);
  return { destination, manifest };
}

export function verifyBackup(options = {}) {
  const backupRoot = path.resolve(ROOT, options.backup || options.output || "");

function validateManifest(manifest, backupRoot) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Backup manifest must be an object.");
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) throw new Error(`Unsupported backup format: ${manifest.formatVersion}`);
  if (!Number.isSafeInteger(manifest.schemaVersion)) throw new Error("Backup schema version must be a safe integer.");
  if (manifest.schemaVersion <= 0) throw new Error("Backup schema version must be greater than zero.");
  if (manifest.schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`Backup schema ${manifest.schemaVersion} is newer than supported schema ${MAX_SUPPORTED_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(manifest.files)) throw new Error("Backup manifest files must be an array.");
  if (manifest.files.length === 0) throw new Error("Backup manifest files must not be empty.");

  const entries = manifest.files.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.path !== "string" || entry.path.length === 0) {
      throw new Error("Backup manifest contains an invalid file entry.");
    }
    return { entry, normalizedPath: path.posix.normalize(entry.path.replaceAll("\\", "/")) };
  });
  if (!entries.some(({ normalizedPath }) => normalizedPath === "data/mybay.sqlite")) {
    throw new Error("Backup manifest must include data/mybay.sqlite.");
  }

  const uniquePaths = new Set();
  for (const { normalizedPath } of entries) {
    const duplicateKey = normalizedPath.toLowerCase();
    if (uniquePaths.has(duplicateKey)) throw new Error(`Backup manifest contains a duplicate path: ${normalizedPath}`);
    uniquePaths.add(duplicateKey);
  }

  for (const { entry, normalizedPath } of entries) {
    const canonicalInput = entry.path.replaceAll("\\", "/");
    const target = path.resolve(backupRoot, ...normalizedPath.split("/"));
    if (
      normalizedPath === "." ||
      normalizedPath === ".." ||
      normalizedPath.startsWith("../") ||
      normalizedPath.startsWith("/") ||
      normalizedPath !== canonicalInput ||
      target === backupRoot ||
      !target.startsWith(backupRoot + path.sep)
    ) {
      throw new Error(`Backup manifest contains an unsafe path: ${entry.path}`);
    }
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
      throw new Error(`Backup manifest contains an invalid checksum: ${entry.path}`);
    }
    if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) throw new Error(`Backup file is missing: ${entry.path}`);
    if (sha256(target) !== entry.sha256.toLowerCase()) throw new Error(`Backup checksum mismatch: ${entry.path}`);
  }
}
  if (!options.backup && !options.output) throw new Error("--backup is required.");
  const manifestPath = path.join(backupRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(manifest, backupRoot);
  const sqlite = checkSqlite(path.join(backupRoot, "data", "mybay.sqlite"));
  if (sqlite.schemaVersion !== manifest.schemaVersion) throw new Error("Backup schema version does not match its manifest.");
  return { ok: true, schemaVersion: sqlite.schemaVersion, files: manifest.files.length };
}

function printDoctor(result, asJson) {
  if (asJson) return console.log(JSON.stringify(result, null, 2));
  for (const check of result.checks) console.log(`${check.status.toUpperCase().padEnd(4)} ${check.name}: ${check.detail}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "doctor") {
    const result = await runDoctor(args);
    printDoctor(result, args.json);
    if (!result.ok) process.exitCode = 1;
  } else if (args.command === "backup") {
    const result = await createBackup(args);
    console.log(args.json ? JSON.stringify(result, null, 2) : `Backup created: ${result.destination}`);
  } else if (args.command === "verify-backup") {
    const result = verifyBackup(args);
    console.log(args.json ? JSON.stringify(result, null, 2) : `Backup verified: schema ${result.schemaVersion}; ${result.files} files`);
  } else {
    throw new Error("Usage: npm run doctor -- [--json] | npm run backup -- [--output DIR] | npm run backup:verify -- --backup DIR");
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

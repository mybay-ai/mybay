import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import schemaVersion from "../shared/schema-version.json";
import { createBackup, MAX_SUPPORTED_SCHEMA_VERSION, verifyBackup } from "./mybay-ops.mjs";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

function createDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-ops-"));
  temporaryPaths.push(root);
  const data = path.join(root, "data");
  fs.mkdirSync(data);
  const file = path.join(data, "mybay.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE localMetadata(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('durable');");
  db.prepare("INSERT INTO localMetadata VALUES ('schema_version', ?)").run(String(schemaVersion.current));
  db.close();
  return { root, file };
}

function readManifest(output: string) {
  return JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
}

function writeManifest(output: string, manifest: Record<string, unknown>) {
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest));
}

function sha256(file: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function refreshDatabaseChecksum(output: string, manifest: any) {
  const databaseEntry = manifest.files.find((entry: any) => entry.path === "data/mybay.sqlite");
  databaseEntry.sha256 = sha256(path.join(output, "data", "mybay.sqlite"));
  writeManifest(output, manifest);
}

describe("self-host backup operations", () => {
  it("creates and verifies a consistent SQLite snapshot with a manifest", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    const result = await createBackup({ database: source.file, output });
    expect(result.manifest.schemaVersion).toBe(schemaVersion.current);
    expect(verifyBackup({ backup: output })).toMatchObject({ ok: true, schemaVersion: schemaVersion.current });
  });

  it("rejects a backup whose database checksum no longer matches", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    fs.appendFileSync(path.join(output, "data", "mybay.sqlite"), "tampered");
    expect(() => verifyBackup({ backup: output })).toThrow(/checksum mismatch/i);
  });

  it("rejects a backup from a newer schema version", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const manifestPath = path.join(output, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.schemaVersion = 999;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyBackup({ backup: output })).toThrow(/newer than supported/i);
  });
});

  it("rejects a future schema before validating an empty files array", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const manifest = readManifest(output);
    manifest.schemaVersion = 999;
    manifest.files = [];
    writeManifest(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/newer than supported/i);
  });

  it("rejects a missing or empty files array", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const manifest = readManifest(output);
    delete manifest.files;
    writeManifest(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/files must be an array/i);
    manifest.files = [];
    writeManifest(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/must not be empty/i);
  });

  it("rejects a manifest without the SQLite snapshot entry", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const manifest = readManifest(output);
    manifest.files = [{ path: "data/metadata.json", sha256: "0".repeat(64) }];
    writeManifest(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/must include data\/mybay\.sqlite/i);
  });

  it("rejects duplicate manifest paths", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const manifest = readManifest(output);
    manifest.files.push({ ...manifest.files[0] });
    writeManifest(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/duplicate path/i);
  });

  it("rejects malformed checksums", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const manifest = readManifest(output);
    manifest.files[0].sha256 = "not-a-sha256";
    writeManifest(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/invalid checksum/i);
  });

  it("rejects a SQLite schema that differs from the manifest", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const manifest = readManifest(output);
    manifest.schemaVersion = schemaVersion.current - 1;
    writeManifest(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/does not match/i);
  });

  it("runs SQLite integrity validation after checksums pass", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const databasePath = path.join(output, "data", "mybay.sqlite");
    fs.writeFileSync(databasePath, "not a sqlite database");
    const manifest = readManifest(output);
    refreshDatabaseChecksum(output, manifest);
    expect(() => verifyBackup({ backup: output })).toThrow(/sqlite|database|integrity/i);
  });

  it("rejects invalid schema version values", async () => {
    const source = createDatabase();
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    for (const value of [0, -1, 1.5, "5"]) {
      const manifest = readManifest(output);
      manifest.schemaVersion = value;
      writeManifest(output, manifest);
      expect(() => verifyBackup({ backup: output })).toThrow(/schema version/i);
    }
  });

  it.skipIf(process.platform === "win32")("restricts backup directories and sensitive files to the owner", async () => {
    const source = createDatabase();
    const instances = path.join(path.dirname(source.file), "instances", "instance-1");
    fs.mkdirSync(instances, { recursive: true });
    fs.writeFileSync(path.join(instances, "metadata.json"), "{}");
    const output = path.join(source.root, "backup");
    await createBackup({ database: source.file, output });
    const mode = (target: string) => fs.statSync(target).mode & 0o777;
    expect(mode(output)).toBe(0o700);
    expect(mode(path.join(output, "data"))).toBe(0o700);
    expect(mode(path.join(output, "data", "instances", "instance-1"))).toBe(0o700);
    expect(mode(path.join(output, "manifest.json"))).toBe(0o600);
    expect(mode(path.join(output, "data", "mybay.sqlite"))).toBe(0o600);
    expect(mode(path.join(output, "data", "instances", "instance-1", "metadata.json"))).toBe(0o600);
  });

  it("uses the application schema version as the ops support boundary", () => {
    expect(MAX_SUPPORTED_SCHEMA_VERSION).toBe(schemaVersion.current);
  });

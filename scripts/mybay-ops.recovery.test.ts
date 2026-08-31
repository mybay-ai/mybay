import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import schemaVersion from "../shared/schema-version.json";
import { closeLocalDatabase, mutateStore, readStore } from "../server/localStore";
import { hashPassword, verifyPassword } from "../server/utils/crypto";
import { createBackup, restoreBackup, verifyBackup } from "./mybay-ops.mjs";

const roots: string[] = [];
afterEach(() => {
  closeLocalDatabase();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-recovery-"));
  roots.push(root);
  const data = path.join(root, "source");
  fs.mkdirSync(data);
  const database = path.join(data, "mybay.sqlite");
  const db = new DatabaseSync(database);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE localMetadata(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE sample(value TEXT);");
  db.prepare("INSERT INTO localMetadata VALUES ('schema_version', ?)").run(String(schemaVersion.current));
  db.prepare("INSERT INTO sample VALUES (?)").run("preserved-history");
  db.close();
  const write = (relative: string, value: string) => {
    const file = path.join(data, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  return { root, data, database, write, backup: path.join(root, "backup"), restored: path.join(root, "restored") };
}

describe("backup exclusions and isolated restore", () => {
  it("reopens a restored application store with usable login hash, encrypted credentials, history and configuration", async () => {
    const f = fixture();
    const appDatabase = path.join(f.data, "application.sqlite");
    vi.stubEnv("MYBAY_SQLITE_PATH", appDatabase);
    vi.stubEnv("LOCAL_STORE_PATH", path.join(f.root, "no-legacy-store.json"));
    vi.stubEnv("ENCRYPTION_KEY", crypto.randomBytes(32).toString("hex"));
    const { encrypt, decrypt } = await import("../server/crypto");
    const password = crypto.randomBytes(18).toString("base64url");
    mutateStore((store) => {
      store.users.push({ id: "recovery-admin", username: "recovery-admin", password_hash: hashPassword(password) });
      store.credentials.push({ id: "test-credential", encrypted_value: encrypt("synthetic-provider-secret") });
      store.conversations.push({ id: "test-conversation", title: "Recovery rehearsal" });
      store.chatMessages.push({ id: "test-message", conversation_id: "test-conversation", content: "history survives" });
      store.instances.push({ id: "fixture-agent", config_json: { model: "synthetic-model" } });
      store.systemSettings.recovery_marker = "preserved";
    });
    const before = readStore();
    closeLocalDatabase();
    f.write("instances/fixture-agent/report.html", "application-recovery-artifact");
    await createBackup({ database: appDatabase, output: f.backup });
    restoreBackup({ backup: f.backup, output: f.restored });
    vi.stubEnv("MYBAY_SQLITE_PATH", path.join(f.restored, "data/mybay.sqlite"));
    const recovered = readStore();
    expect(recovered).toEqual(before);
    expect(verifyPassword(password, recovered.users[0].password_hash).match).toBe(true);
    expect(decrypt(recovered.credentials[0].encrypted_value)).toBe("synthetic-provider-secret");
    expect(fs.readFileSync(path.join(f.restored, "data/instances/fixture-agent/report.html"), "utf8")).toBe("application-recovery-artifact");
    closeLocalDatabase();
    expect(readStore()).toEqual(before);
  });

  it("excludes regenerable runtime directories but preserves workspace files and instance configuration", async () => {
    const f = fixture();
    for (const directory of [".cache", "cache", "logs", "__pycache__", ".venv", "node_modules"]) {
      f.write(`instances/agent/.hermes/${directory}/ignored.txt`, "transient");
    }
    f.write("instances/agent/.env", "SYNTHETIC_PROVIDER_KEY=test-only");
    f.write("instances/agent/report.html", "artifact");
    f.write("uploads/document.txt", "upload");
    await createBackup({ database: f.database, output: f.backup });
    const manifest = JSON.parse(fs.readFileSync(path.join(f.backup, "manifest.json"), "utf8"));
    expect(manifest.files.map((f: any) => f.path).sort()).toEqual([
      "data/instances/agent/.env", "data/instances/agent/report.html", "data/mybay.sqlite", "data/uploads/document.txt",
    ]);
    expect(manifest.skippedPaths).toContain("data/instances/agent/.hermes/.venv");
    expect(verifyBackup({ backup: f.backup }).ok).toBe(true);
  });

  it("refuses a destination within the source data tree before creating it", async () => {
    const f = fixture();
    const destination = path.join(f.data, "instances", "recursive-backup");
    await expect(createBackup({ database: f.database, output: destination })).rejects.toThrow(/source data/i);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("does not create a missing source database", async () => {
    const f = fixture();
    const missing = path.join(f.root, "missing.sqlite");
    await expect(createBackup({ database: missing, output: f.backup })).rejects.toThrow(/does not exist/i);
    expect(fs.existsSync(missing)).toBe(false);
    expect(fs.existsSync(f.backup)).toBe(false);
  });

  it("keeps repeated verification stable without SQLite sidecars and retains a regular file named cache", async () => {
    const f = fixture();
    f.write("instances/agent/cache", "a user file, not a cache directory");
    await createBackup({ database: f.database, output: f.backup });
    const snapshot = path.join(f.backup, "data/mybay.sqlite");
    const before = fs.readFileSync(snapshot);
    expect(verifyBackup({ backup: f.backup }).ok).toBe(true);
    expect(verifyBackup({ backup: f.backup }).ok).toBe(true);
    expect(fs.readFileSync(snapshot)).toEqual(before);
    expect(fs.existsSync(snapshot + "-wal")).toBe(false);
    expect(fs.existsSync(snapshot + "-shm")).toBe(false);
    expect(fs.readFileSync(path.join(f.backup, "data/instances/agent/cache"), "utf8")).toContain("a user file");
  });

  it("restores verified database, credentials, history and files into a new directory only", async () => {
    const f = fixture();
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update("synthetic-test-credential"), cipher.final()]);
    const payload = [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
    const db = new DatabaseSync(f.database);
    db.prepare("INSERT INTO sample VALUES (?)").run(payload);
    db.close();
    f.write("instances/agent/report.html", "RESTORE-OK");
    f.write("uploads/input.txt", "input");
    await createBackup({ database: f.database, output: f.backup });
    const result = restoreBackup({ backup: f.backup, output: f.restored });
    expect(result.ok).toBe(true);
    const restored = new DatabaseSync(path.join(f.restored, "data/mybay.sqlite"), { readOnly: true });
    const values = restored.prepare("SELECT value FROM sample").all().map((row) => String(row.value));
    expect(values[0]).toBe("preserved-history");
    const [restoredIv, tag, ciphertext] = values[1].split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(restoredIv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    expect(Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString()).toBe("synthetic-test-credential");
    restored.close();
    expect(fs.readFileSync(path.join(f.restored, "data/instances/agent/report.html"), "utf8")).toBe("RESTORE-OK");
    expect(fs.readFileSync(path.join(f.restored, "data/uploads/input.txt"), "utf8")).toBe("input");
    expect(fs.existsSync(path.join(f.restored, ".env"))).toBe(false);
  });

  it("refuses to overwrite an existing target or restore inside its backup", async () => {
    const f = fixture();
    await createBackup({ database: f.database, output: f.backup });
    fs.mkdirSync(f.restored);
    fs.writeFileSync(path.join(f.restored, "keep.txt"), "original");
    expect(() => restoreBackup({ backup: f.backup, output: f.restored })).toThrow(/already exists/i);
    expect(fs.readFileSync(path.join(f.restored, "keep.txt"), "utf8")).toBe("original");
    expect(() => restoreBackup({ backup: f.backup, output: path.join(f.backup, "restore") })).toThrow(/backup/i);
    expect(() => restoreBackup({ backup: f.backup })).toThrow(/output/i);
  });

  it("rejects tampered contents before writing a restore target", async () => {
    const f = fixture();
    f.write("uploads/input.txt", "original");
    await createBackup({ database: f.database, output: f.backup });
    fs.writeFileSync(path.join(f.backup, "data/uploads/input.txt"), "tampered");
    expect(() => restoreBackup({ backup: f.backup, output: f.restored })).toThrow(/checksum/i);
    expect(fs.existsSync(f.restored)).toBe(false);
  });

  it("rejects manifest paths outside the data directory and Windows alternate streams", async () => {
    const f = fixture();
    await createBackup({ database: f.database, output: f.backup });
    const manifestPath = path.join(f.backup, "manifest.json");
    const original = fs.readFileSync(manifestPath, "utf8");
    for (const bad of ["../escape", "data/../escape", "extra.txt", "data/secret:stream", "C:/escape"]) {
      const manifest = JSON.parse(original);
      manifest.files.push({ path: bad, sha256: "0".repeat(64) });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      expect(() => verifyBackup({ backup: f.backup })).toThrow(/unsafe path/i);
    }
  });

  it.skipIf(process.platform === "win32")("skips excluded symlinks but rejects unexcluded links rather than following them", async () => {
    const f = fixture();
    const instance = path.join(f.data, "instances/agent");
    fs.mkdirSync(instance, { recursive: true });
    fs.symlinkSync("/missing/runtime", path.join(instance, ".venv"));
    await createBackup({ database: f.database, output: f.backup });
    expect(verifyBackup({ backup: f.backup }).ok).toBe(true);
    fs.symlinkSync("/etc/passwd", path.join(instance, "secret-link"));
    await expect(createBackup({ database: f.database, output: path.join(f.root, "bad-backup") })).rejects.toThrow(/symbolic link/i);
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked parent directory inside a backup", async () => {
    const f = fixture();
    f.write("uploads/input.txt", "original");
    await createBackup({ database: f.database, output: f.backup });
    fs.renameSync(path.join(f.backup, "data/uploads"), path.join(f.root, "external"));
    fs.symlinkSync(path.join(f.root, "external"), path.join(f.backup, "data/uploads"));
    expect(() => restoreBackup({ backup: f.backup, output: f.restored })).toThrow(/symbolic link|unsafe path/i);
    expect(fs.existsSync(f.restored)).toBe(false);
  });
});

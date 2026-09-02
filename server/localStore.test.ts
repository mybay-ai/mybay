import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeLocalDatabase,
  getLocalDatabasePath,
  mutateStore,
  mutateStoreCollections,
  readStore,
  readStoreCollections,
} from "./localStore";

const testDir = path.resolve(process.cwd(), "data", "test-sqlite");
const sqlitePath = path.join(testDir, "mybay-test.sqlite");
const legacyPath = path.join(testDir, "local-store.json");

function removeTestFiles() {
  closeLocalDatabase();
  if (!fs.existsSync(testDir)) return;
  for (const name of fs.readdirSync(testDir)) fs.unlinkSync(path.join(testDir, name));
  fs.rmdirSync(testDir);
}

describe("local SQLite store", () => {
  beforeEach(() => {
    removeTestFiles();
    process.env.MYBAY_SQLITE_PATH = path.relative(process.cwd(), sqlitePath);
    process.env.LOCAL_STORE_PATH = path.relative(process.cwd(), legacyPath);
  });

  afterEach(() => {
    removeTestFiles();
    delete process.env.MYBAY_SQLITE_PATH;
    delete process.env.LOCAL_STORE_PATH;
  });

  it("persists data after the database is closed and reopened", () => {
    mutateStore((store) => { store.systemSettings.test_key = "test_val"; });
    expect(getLocalDatabasePath()).toBe(sqlitePath);
    closeLocalDatabase();
    expect(readStore().systemSettings.test_key).toBe("test_val");
  });

  it("refuses a future schema before initializing or writing the database", () => {
    mutateStore((store) => { store.systemSettings.recovery_marker = "keep"; });
    closeLocalDatabase();
    const future = new DatabaseSync(sqlitePath);
    future.prepare("UPDATE localMetadata SET value = '999' WHERE key = 'schema_version'").run();
    // A future edition may replace tables. Older initialization must not recreate them.
    future.exec("DROP TABLE chatMessageFeedback; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    future.close();
    const before = fs.readFileSync(sqlitePath);
    expect(() => readStore()).toThrow(/schema.*999.*newer|newer.*schema/i);
    expect(fs.readFileSync(sqlitePath)).toEqual(before);
    const preserved = new DatabaseSync(sqlitePath, { readOnly: true });
    expect(preserved.prepare("SELECT name FROM sqlite_master WHERE name = 'chatMessageFeedback'").get()).toBeUndefined();
    expect(preserved.prepare("SELECT value FROM systemSettings WHERE key = 'recovery_marker'").get()?.value).toBe("keep");
    preserved.close();
  });

  it("rolls back a failed transaction", () => {
    expect(() => mutateStore((store) => {
      store.users.push({ id: "rolled-back", username: "unsafe" });
      throw new Error("stop transaction");
    })).toThrow("stop transaction");
    expect(readStore().users).toHaveLength(0);
  });

  it("does not lose updates across concurrent callers", async () => {
    await Promise.all(Array.from({ length: 30 }, (_, index) => Promise.resolve().then(() => {
      mutateStore((store) => { store.tasks.push({ id: `task-${index}`, title: `Task ${index}` }); });
    })));
    expect(readStore().tasks).toHaveLength(30);
  });

  it("mutates only the selected collections in one transaction", () => {
    mutateStore((store) => {
      store.users.push({ id: "user-1", username: "preserved" });
      store.chatRuns.push({ id: "run-1", status: "queued" });
    });

    mutateStoreCollections(["chatRuns"] as const, (store) => {
      store.chatRuns[0].status = "running";
    });

    expect(readStoreCollections(["chatRuns"] as const).chatRuns[0].status).toBe("running");
    expect(readStoreCollections(["users"] as const).users).toEqual([
      { id: "user-1", username: "preserved" },
    ]);
  });

  it("does not rewrite untouched rows during a scoped collection update", () => {
    mutateStore((store) => {
      store.chatRuns.push(
        { id: "run-protected", status: "queued" },
        { id: "run-changing", status: "queued" },
      );
    });
    const observer = new DatabaseSync(sqlitePath);
    observer.exec(`CREATE TRIGGER reject_protected_run_delete
      BEFORE DELETE ON chatRuns WHEN OLD.id = 'run-protected'
      BEGIN SELECT RAISE(ABORT, 'untouched row was rewritten'); END;`);
    observer.exec(`CREATE TRIGGER reject_protected_run_update
      BEFORE UPDATE ON chatRuns WHEN OLD.id = 'run-protected'
      BEGIN SELECT RAISE(ABORT, 'untouched row was rewritten'); END;`);
    observer.close();

    mutateStoreCollections(["chatRuns"] as const, (store) => {
      store.chatRuns.find((run) => run.id === "run-changing").status = "running";
    });

    expect(readStoreCollections(["chatRuns"] as const).chatRuns).toEqual([
      { id: "run-protected", status: "queued" },
      { id: "run-changing", status: "running" },
    ]);
  });

  it("preserves explicit row reordering through the scoped fallback", () => {
    mutateStore((store) => {
      store.chatRuns.push(
        { id: "run-a", status: "queued" },
        { id: "run-b", status: "queued" },
        { id: "run-c", status: "queued" },
      );
    });

    mutateStoreCollections(["chatRuns"] as const, (store) => {
      store.chatRuns = [store.chatRuns[2], store.chatRuns[0], store.chatRuns[1]];
    });
    closeLocalDatabase();

    expect(readStoreCollections(["chatRuns"] as const).chatRuns.map((run) => run.id)).toEqual([
      "run-c",
      "run-a",
      "run-b",
    ]);
  });

  it("rolls back a failed selected-collection transaction", () => {
    mutateStore((store) => {
      store.chatRuns.push({ id: "run-rollback", status: "queued" });
    });

    expect(() => mutateStoreCollections(["chatRuns"] as const, (store) => {
      store.chatRuns[0].status = "running";
      throw new Error("stop scoped transaction");
    })).toThrow("stop scoped transaction");

    expect(readStoreCollections(["chatRuns"] as const).chatRuns[0].status).toBe("queued");
  });

  it("migrates legacy JSON once and keeps a recoverable backup", () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify({
      users: [{ id: "legacy-user", username: "legacy" }],
      instances: [{ id: "legacy-instance", name: "Legacy Agent" }],
      systemSettings: { migrated: "yes" }
    }), "utf8");

    expect(readStore().users[0].id).toBe("legacy-user");
    expect(readStore().instances[0].id).toBe("legacy-instance");
    expect(fs.existsSync(`${legacyPath}.migrated-backup.json`)).toBe(true);
    expect(fs.existsSync(`${sqlitePath}.migration-complete`)).toBe(true);

    closeLocalDatabase();
    fs.writeFileSync(legacyPath, JSON.stringify({ users: [{ id: "must-not-import" }] }), "utf8");
    expect(readStore().users.map((user) => user.id)).toEqual(["legacy-user"]);
  });

  it("migrates chatRuns node_id to schema v2 without changing other fields", () => {
    mutateStore((store) => {
      store.chatRuns.push({ id: "run-old", status: "completed", node_id: "local-node", preserved: "yes" });
    });
    closeLocalDatabase();

    const before = new DatabaseSync(sqlitePath);
    before.prepare("UPDATE localMetadata SET value = ? WHERE key = ?").run("1", "schema_version");
    before.close();

    const migrated = readStore().chatRuns[0];
    expect(migrated).toMatchObject({
      id: "run-old",
      status: "completed",
      preserved: "yes",
      runtime_type: "hermes",
      runtime_provider_key: "hermes-core",
      runtime_contract_version: 1,
    });
    expect(Object.prototype.hasOwnProperty.call(migrated, "node_id")).toBe(false);
    closeLocalDatabase();

    const verified = new DatabaseSync(sqlitePath);
    expect((verified.prepare("SELECT value FROM localMetadata WHERE key = ?").get("schema_version") as { value: string }).value).toBe("6");
    expect(JSON.parse((verified.prepare("SELECT data FROM chatRuns WHERE id = ?").get("run-old") as { data: string }).data)).toEqual(migrated);
    verified.close();

    expect(readStore().chatRuns[0]).toEqual(migrated);
  });

  it("rolls back the schema migration when a chat run row is invalid", () => {
    mutateStore((store) => {
      store.chatRuns.push({ id: "run-invalid", node_id: null, preserved: true });
    });
    closeLocalDatabase();

    const before = new DatabaseSync(sqlitePath);
    before.prepare("UPDATE localMetadata SET value = ? WHERE key = ?").run("1", "schema_version");
    before.prepare("UPDATE chatRuns SET data = ? WHERE id = ?").run("{invalid", "run-invalid");
    before.close();

    expect(() => readStore()).toThrow();
    closeLocalDatabase();

    const verified = new DatabaseSync(sqlitePath);
    expect((verified.prepare("SELECT value FROM localMetadata WHERE key = ?").get("schema_version") as { value: string }).value).toBe("1");
    expect((verified.prepare("SELECT data FROM chatRuns WHERE id = ?").get("run-invalid") as { data: string }).data).toBe("{invalid");
    verified.close();
  });
});


describe("test database safety", () => {
  afterEach(() => { closeLocalDatabase(); delete process.env.MYBAY_SQLITE_PATH; delete process.env.LOCAL_STORE_PATH; });
  it("uses a temporary default even after fixture environment cleanup", () => {
    delete process.env.MYBAY_SQLITE_PATH;
    delete process.env.LOCAL_STORE_PATH;
    expect(getLocalDatabasePath()).not.toBe(path.resolve("data/mybay.sqlite"));
    expect(getLocalDatabasePath()).toContain("mybay-test-store-");
    mutateStore(data => { data.systemSettings.isolated = "yes"; });
    closeLocalDatabase();
    expect(readStore().systemSettings.isolated).toBe("yes");
  });
  it.each(["MYBAY_SQLITE_PATH", "LOCAL_STORE_PATH"])("refuses an explicit live database in %s", key => {
    process.env[key] = key === "LOCAL_STORE_PATH" ? "data/mybay.json" : "data/mybay.sqlite";
    expect(() => getLocalDatabasePath()).toThrow("Tests must use an isolated database");
  });
});

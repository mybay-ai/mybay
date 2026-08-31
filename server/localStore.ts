import fs from "fs";
import path from "path";
import os from "node:os";
import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import schemaVersion from "../shared/schema-version.json";

export type LocalStoreData = {
  users: any[];
  instances: any[];
  credentials: any[];
  auditLogs: any[];
  versions: any[];
  userResourcePolicies: any[];
  channelAuthEvents: any[];
  deploymentTasks: any[];
  deploymentEvents: any[];
  files: any[];
  tasks: any[];
  scheduledJobs: any[];
  templates: any[];
  scheduledFires: any[];
  blueprints: any[];
  chatProjects: any[];
  conversations: any[];
  chatMessages: any[];
  chatRuns: any[];
  chatMessageFeedback: any[];
  systemSettings: Record<string, string>;
};

type CollectionName = Exclude<keyof LocalStoreData, "systemSettings">;

const COLLECTIONS: CollectionName[] = [
  "users", "instances", "credentials", "auditLogs", "versions",
  "userResourcePolicies", "channelAuthEvents", "deploymentTasks",
  "deploymentEvents", "files", "tasks", "scheduledJobs", "scheduledFires", "templates", "blueprints",
  "chatProjects", "conversations", "chatMessages", "chatRuns", "chatMessageFeedback"
];

const defaultData = (): LocalStoreData => ({
  users: [],
  instances: [],
  credentials: [],
  auditLogs: [],
  versions: [{
    id: "local-latest",
    version: "latest",
    image: process.env.MY_BAY_IMAGE || "nousresearch/hermes-agent",
    image_tag: "latest",
    source: "local",
    is_latest: true,
    status: "available",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }],
  userResourcePolicies: [],
  channelAuthEvents: [],
  deploymentTasks: [],
  deploymentEvents: [],
  files: [],
  tasks: [],
  scheduledJobs: [],
  scheduledFires: [],
  templates: [],
  blueprints: [],
  chatProjects: [],
  conversations: [],
  chatMessages: [],
  chatRuns: [],
  chatMessageFeedback: [],
  systemSettings: {}
});

let activeDb: DatabaseSync | null = null;
let activeDbPath = "";
const CURRENT_SCHEMA_VERSION = schemaVersion.current;
let testStoreDirectory: string | undefined;

function defaultStoreDirectory() {
  // Unmocked repository calls in unit tests must never open the running app's
  // Windows/Docker shared SQLite file (their locking domains are different).
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    testStoreDirectory ||= fs.mkdtempSync(path.join(os.tmpdir(), "mybay-test-store-"));
    return testStoreDirectory;
  }
  return path.resolve(process.cwd(), "data");
}

function guardTestDatabasePath(databasePath: string) {
  if ((process.env.VITEST === "true" || process.env.NODE_ENV === "test")
    && path.resolve(databasePath).toLowerCase() === path.resolve(process.cwd(), "data", "mybay.sqlite").toLowerCase()) {
    throw new Error("Tests must use an isolated database, not data/mybay.sqlite");
  }
  return databasePath;
}

export function getLocalDatabasePath() {
  if (process.env.MYBAY_SQLITE_PATH) return guardTestDatabasePath(path.resolve(process.cwd(), process.env.MYBAY_SQLITE_PATH));
  if (process.env.LOCAL_STORE_PATH) {
    const legacyConfigured = path.resolve(process.cwd(), process.env.LOCAL_STORE_PATH);
    return guardTestDatabasePath(legacyConfigured.replace(/\.json$/i, "") + ".sqlite");
  }
  return path.join(defaultStoreDirectory(), "mybay.sqlite");
}

function legacyStorePath() {
  return path.resolve(process.cwd(), process.env.LOCAL_STORE_PATH || path.join(defaultStoreDirectory(), "local-store.json"));
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalize(data: Partial<LocalStoreData>): LocalStoreData {
  const base = defaultData();
  const normalized = { ...base, ...data, systemSettings: data.systemSettings || {} } as LocalStoreData;
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(normalized[collection])) normalized[collection] = [];
  }
  return normalized;
}

function validateLegacyData(value: unknown): LocalStoreData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Legacy local data must be a JSON object.");
  const candidate = value as Partial<LocalStoreData>;
  for (const collection of COLLECTIONS) {
    if (candidate[collection] !== undefined && !Array.isArray(candidate[collection])) {
      throw new Error(`Legacy local data collection is invalid: ${collection}`);
    }
  }
  if (candidate.systemSettings !== undefined && (!candidate.systemSettings || typeof candidate.systemSettings !== "object" || Array.isArray(candidate.systemSettings))) {
    throw new Error("Legacy local data system settings are invalid.");
  }
  return normalize(candidate);
}

function initializeSchema(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  for (const collection of COLLECTIONS) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(collection)} (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`);
  }
  db.exec("CREATE TABLE IF NOT EXISTS systemSettings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS localMetadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS instanceIdentities (
      instance_id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deploymentTasksCore (
      id TEXT PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL,
      status TEXT NOT NULL,
      worker_id TEXT,
      locked_at TEXT,
      lease_until TEXT,
      heartbeat_at TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      current_step TEXT NOT NULL DEFAULT 'queued',
      next_retry_at TEXT,
      error_code TEXT,
      error_message TEXT,
      error_detail TEXT,
      failed_at TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_deployment_claim
      ON deploymentTasksCore(status, next_retry_at, lease_until, created_at);
    CREATE INDEX IF NOT EXISTS idx_deployment_instance
      ON deploymentTasksCore(instance_id, status);
    CREATE TABLE IF NOT EXISTS instancePortReservations (
      port INTEGER PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE IF NOT EXISTS idempotencyRecords (
      idempotency_key TEXT PRIMARY KEY NOT NULL,
      request_hash TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      deployment_task_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cleanupTasks (
      id TEXT PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL,
      status TEXT NOT NULL,
      cleanup_mode TEXT NOT NULL DEFAULT 'delete',
      worker_id TEXT,
      lease_until TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      error_detail TEXT,
      failed_at TEXT,
      current_step TEXT NOT NULL DEFAULT 'queued',
      next_retry_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cleanup_claim ON cleanupTasks(status, lease_until, created_at);
  `);
}

function readRows(db: DatabaseSync, collection: CollectionName): any[] {
  const rows = db.prepare(`SELECT data FROM ${quoteIdentifier(collection)} ORDER BY rowid`).all() as Array<{ data: string }>;
  return rows.map((row) => JSON.parse(row.data));
}

function readStoreFromDb(db: DatabaseSync): LocalStoreData {
  const data = defaultData();
  for (const collection of COLLECTIONS) data[collection] = readRows(db, collection);
  data.systemSettings = Object.fromEntries(
    (db.prepare("SELECT key, value FROM systemSettings").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value])
  );
  return normalize(data);
}

function writeStoreToDb(db: DatabaseSync, input: LocalStoreData) {
  const data = normalize(input);
  for (const collection of COLLECTIONS) {
    db.exec(`DELETE FROM ${quoteIdentifier(collection)}`);
    const insert = db.prepare(`INSERT INTO ${quoteIdentifier(collection)} (id, data) VALUES (?, ?)`);
    data[collection].forEach((row: any, index: number) => {
      const id = String(row?.id || row?.key || `_row_${index}_${randomUUID()}`);
      insert.run(id, JSON.stringify(row));
    });
  }
  db.exec("DELETE FROM systemSettings");
  const insertSetting = db.prepare("INSERT INTO systemSettings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(data.systemSettings)) insertSetting.run(key, String(value));
}

function writeCollectionToDb(db: DatabaseSync, collection: CollectionName, rows: any[]) {
  db.exec(`DELETE FROM ${quoteIdentifier(collection)}`);
  const insert = db.prepare(`INSERT INTO ${quoteIdentifier(collection)} (id, data) VALUES (?, ?)`);
  rows.forEach((row: any, index: number) => {
    const id = String(row?.id || row?.key || `_row_${index}_${randomUUID()}`);
    insert.run(id, JSON.stringify(row));
  });
}

function applySchemaMigrations(db: DatabaseSync) {
  const row = db.prepare("SELECT value FROM localMetadata WHERE key = ?").get("schema_version") as { value?: string } | undefined;
  let version = Number(row?.value || 0);
  if (!Number.isFinite(version) || version < 0) version = 0;
  if (version >= CURRENT_SCHEMA_VERSION) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (version < 2) {
      const rows = db.prepare("SELECT id, data FROM chatRuns").all() as Array<{ id: string; data: string }>;
      const update = db.prepare("UPDATE chatRuns SET data = ? WHERE id = ?");
      for (const runRow of rows) {
        const data = JSON.parse(runRow.data);
        if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "node_id")) {
          delete data.node_id;
          update.run(JSON.stringify(data), runRow.id);
        }
      }
      version = 2;
    }
    if (version < 3) {
      const now = new Date().toISOString();
      const identityInsert = db.prepare("INSERT OR IGNORE INTO instanceIdentities(instance_id, path, created_at) VALUES (?, ?, ?)");
      for (const row of db.prepare("SELECT id, data FROM instances").all() as Array<{ id: string; data: string }>) {
        const instance = JSON.parse(row.data || "{}");
        const instancePath = String(instance.path || instance.instance_path || "").trim();
        if (instancePath) identityInsert.run(row.id, instancePath, instance.created_at || instance.createdAt || now);
      }
      const taskInsert = db.prepare(`INSERT OR IGNORE INTO deploymentTasksCore(
        id, instance_id, status, worker_id, locked_at, lease_until, heartbeat_at, attempt,
        max_attempts, current_step, next_retry_at, error_code, error_message, cancel_requested,
        payload_json, created_by, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of db.prepare("SELECT id, data FROM deploymentTasks").all() as Array<{ id: string; data: string }>) {
        const task = JSON.parse(row.data || "{}");
        const legacyStatus = task.status === "pending" ? "queued" : task.status === "retrying" ? "retry_wait" : task.status;
        taskInsert.run(row.id, task.instance_id, legacyStatus || "queued", task.worker_id || null, task.locked_at || null,
          task.lease_until || null, task.heartbeat_at || null, Number(task.attempt ?? task.retry_count ?? 0),
          Number(task.max_attempts || 3), task.current_step || (legacyStatus === "queued" ? "queued" : "preparing"),
          task.next_retry_at || null, task.error_code || null, task.error_message || null, task.cancel_requested ? 1 : 0,
          JSON.stringify(task.payload_json ?? null), task.created_by || null, task.created_at || now, task.updated_at || now,
          task.completed_at || null);
      }
      version = 3;
    }
    db.prepare("INSERT OR REPLACE INTO localMetadata (key, value) VALUES (?, ?)").run("schema_version", String(version));
    if (version < 4) {
      const deploymentColumns = db.prepare("PRAGMA table_info(deploymentTasksCore)").all() as Array<{ name: string }>;
      const cleanupColumns = db.prepare("PRAGMA table_info(cleanupTasks)").all() as Array<{ name: string }>;
      const hasDeployment = (name: string) => deploymentColumns.some((column) => column.name === name);
      const hasCleanup = (name: string) => cleanupColumns.some((column) => column.name === name);
      if (!hasDeployment("error_detail")) db.exec("ALTER TABLE deploymentTasksCore ADD COLUMN error_detail TEXT");
      if (!hasDeployment("failed_at")) db.exec("ALTER TABLE deploymentTasksCore ADD COLUMN failed_at TEXT");
      if (!hasCleanup("error_detail")) db.exec("ALTER TABLE cleanupTasks ADD COLUMN error_detail TEXT");
      if (!hasCleanup("failed_at")) db.exec("ALTER TABLE cleanupTasks ADD COLUMN failed_at TEXT");
      if (!hasCleanup("current_step")) db.exec("ALTER TABLE cleanupTasks ADD COLUMN current_step TEXT NOT NULL DEFAULT 'queued'");
      if (!hasCleanup("next_retry_at")) db.exec("ALTER TABLE cleanupTasks ADD COLUMN next_retry_at TEXT");
      version = 4;
    }
    if (version < 5) {
      const cleanupColumns = db.prepare("PRAGMA table_info(cleanupTasks)").all() as Array<{ name: string }>;
      if (!cleanupColumns.some((column) => column.name === "cleanup_mode")) {
        db.exec("ALTER TABLE cleanupTasks ADD COLUMN cleanup_mode TEXT NOT NULL DEFAULT 'delete'");
      }
      version = 5;
    }
    if (version < 6) {
      const rows = db.prepare("SELECT id, data FROM chatRuns").all() as Array<{ id: string; data: string }>;
      const update = db.prepare("UPDATE chatRuns SET data = ? WHERE id = ?");
      for (const runRow of rows) {
        const data = JSON.parse(runRow.data);
        if (!data || typeof data !== "object") continue;
        const bindingFields = ["runtime_type", "runtime_provider_key", "runtime_contract_version"];
        const isLegacyUnboundRun = bindingFields.every((field) => !Object.prototype.hasOwnProperty.call(data, field));
        if (!isLegacyUnboundRun) continue;
        Object.assign(data, {
          runtime_type: "hermes",
          runtime_provider_key: "hermes-core",
          runtime_contract_version: 1,
        });
        update.run(JSON.stringify(data), runRow.id);
      }
      version = 6;
    }
    db.prepare("INSERT OR REPLACE INTO localMetadata (key, value) VALUES (?, ?)").run("schema_version", String(version));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function seedFreshDatabase(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    writeStoreToDb(db, defaultData());
    db.prepare("INSERT OR REPLACE INTO localMetadata (key, value) VALUES (?, ?)").run("schema_version", "1");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateLegacyStore(db: DatabaseSync, legacyPath: string, sqlitePath: string) {
  const raw = fs.readFileSync(legacyPath, "utf8");
  const legacy = validateLegacyData(JSON.parse(raw || "{}"));
  db.exec("BEGIN IMMEDIATE");
  try {
    writeStoreToDb(db, legacy);
    for (const collection of COLLECTIONS) {
      const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(collection)}`).get() as { count: number }).count);
      if (count !== legacy[collection].length) throw new Error(`Migration verification failed for ${collection}.`);
    }
    db.prepare("INSERT OR REPLACE INTO localMetadata (key, value) VALUES (?, ?)").run("schema_version", "1");
    db.prepare("INSERT OR REPLACE INTO localMetadata (key, value) VALUES (?, ?)").run("legacy_migrated_at", new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const backupPath = `${legacyPath}.migrated-backup.json`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(legacyPath, backupPath);
  fs.writeFileSync(`${sqlitePath}.migration-complete`, new Date().toISOString(), { encoding: "utf8", flag: "wx" });
  console.info("[LocalDatabase] Existing local data migrated to SQLite successfully.");
}

function openDatabase(): DatabaseSync {
  const sqlitePath = getLocalDatabasePath();
  if (activeDb && activeDbPath === sqlitePath) return activeDb;
  closeLocalDatabase();

  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const existed = fs.existsSync(sqlitePath);
  const db = new DatabaseSync(sqlitePath);
  try {
    // Reject newer databases before any DDL, WAL setup or migration can mutate
    // them. Roll back with the preserved image/data pair, never by downgrading.
    if (existed && db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'localMetadata'").get()) {
      const metadata = db.prepare("SELECT value FROM localMetadata WHERE key = 'schema_version'").get();
      const existingVersion = Number(metadata?.value);
      if (existingVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(`Database schema ${existingVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}. Use a compatible version or restore the matching older backup; do not downgrade this database in place.`);
      }
    }
    initializeSchema(db);
    const legacyPath = legacyStorePath();
    if (!existed && fs.existsSync(legacyPath)) migrateLegacyStore(db, legacyPath, sqlitePath);
    else if (!existed) seedFreshDatabase(db);
    applySchemaMigrations(db);
    activeDb = db;
    activeDbPath = sqlitePath;
    return db;
  } catch (error) {
    db.close();
    if (!existed) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const target = `${sqlitePath}${suffix}`;
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
    }
    throw error;
  }
}

export function initializeLocalDatabase(): void {
  openDatabase();
}

export function readStore(): LocalStoreData {
  return readStoreFromDb(openDatabase());
}

export function writeStore(data: LocalStoreData) {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    writeStoreToDb(db, data);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function mutateStore<T>(fn: (data: LocalStoreData) => T): T {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const data = readStoreFromDb(db);
    const result = fn(data);
    writeStoreToDb(db, data);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Transactionally mutate only the named JSON collections.
 *
 * The broad mutateStore helper rewrites every collection. Interactive Run
 * operations use this scoped variant so unrelated control-plane data is not
 * read and rewritten for every lifecycle update.
 */
export function mutateStoreCollections<K extends CollectionName, T>(
  collections: readonly K[],
  fn: (data: Pick<LocalStoreData, K>) => T,
): T {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const data = {} as Pick<LocalStoreData, K>;
    for (const collection of collections) {
      data[collection] = readRows(db, collection) as Pick<LocalStoreData, K>[K];
    }
    const result = fn(data);
    for (const collection of collections) {
      writeCollectionToDb(db, collection, data[collection] as any[]);
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function readStoreCollections<K extends CollectionName>(
  collections: readonly K[],
): Pick<LocalStoreData, K> {
  const db = openDatabase();
  const data = {} as Pick<LocalStoreData, K>;
  for (const collection of collections) {
    data[collection] = readRows(db, collection) as Pick<LocalStoreData, K>[K];
  }
  return data;
}

function parseJsonColumn(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function mapDeploymentTask(row: any) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJsonColumn(row.payload_json),
    cancel_requested: Boolean(row.cancel_requested),
    retry_count: Number(row.attempt || 0),
    attempt: Number(row.attempt || 0),
    max_attempts: Number(row.max_attempts || 3),
  };
}

export type ProvisioningBundleInput = {
  instance: any;
  deploymentTask: any;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  candidatePorts: number[];
  maxActiveInstances?: number | null;
};

export function createProvisioningBundle(input: ProvisioningBundleInput):
  | { kind: "created"; instance: any; task: any; port: number }
  | { kind: "replay"; instanceId: string; deploymentTaskId: string }
  | { kind: "conflict"; code: "IDEMPOTENCY_CONFLICT" | "PATH_CONFLICT" | "QUOTA_EXCEEDED" | "PORT_UNAVAILABLE" } {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const key = String(input.idempotencyKey || "").trim();
    if (key) {
      const existing = db.prepare("SELECT * FROM idempotencyRecords WHERE idempotency_key = ?").get(key) as any;
      if (existing) {
        db.exec("COMMIT");
        return existing.request_hash === input.requestHash
          ? { kind: "replay", instanceId: existing.instance_id, deploymentTaskId: existing.deployment_task_id }
          : { kind: "conflict", code: "IDEMPOTENCY_CONFLICT" };
      }
    }
    if (input.maxActiveInstances !== undefined && input.maxActiveInstances !== null) {
      const rows = db.prepare("SELECT data FROM instances").all() as Array<{ data: string }>;
      const active = rows.map((row) => parseJsonColumn(row.data)).filter((instance: any) =>
        instance && (instance.user_id === input.instance.user_id || instance.owner_id === input.instance.user_id) &&
        !["deleted", "archived"].includes(String(instance.status || ""))
      ).length;
      if (active >= input.maxActiveInstances) {
        db.exec("ROLLBACK");
        return { kind: "conflict", code: "QUOTA_EXCEEDED" };
      }
    }
    const instancePath = String(input.instance.path || input.instance.instance_path || "").trim();
    try {
      db.prepare("INSERT INTO instanceIdentities(instance_id, path, created_at) VALUES (?, ?, ?)")
        .run(input.instance.id, instancePath, input.instance.created_at || input.instance.createdAt || nowIso());
    } catch (error: any) {
      if (String(error?.message || error).includes("UNIQUE")) {
        db.exec("ROLLBACK");
        return { kind: "conflict", code: "PATH_CONFLICT" };
      }
      throw error;
    }
    let reservedPort: number | null = null;
    const reserve = db.prepare("INSERT INTO instancePortReservations(port, instance_id, status, created_at, released_at) VALUES (?, ?, 'reserved', ?, NULL)");
    for (const port of input.candidatePorts) {
      try {
        reserve.run(port, input.instance.id, nowIso());
        reservedPort = port;
        break;
      } catch (error: any) {
        if (!String(error?.message || error).includes("UNIQUE")) throw error;
      }
    }
    if (reservedPort === null) {
      db.exec("ROLLBACK");
      return { kind: "conflict", code: "PORT_UNAVAILABLE" };
    }
    const instance = { ...input.instance };
    const config = typeof instance.config_json === "string" ? (parseJsonColumn(instance.config_json) || {}) : {};
    config.host_port = reservedPort;
    config.port = String(reservedPort);
    instance.config_json = JSON.stringify(config);
    instance.host_port = reservedPort;
    db.prepare("INSERT INTO instances(id, data) VALUES (?, ?)").run(instance.id, JSON.stringify(instance));
    const task = {
      ...input.deploymentTask,
      id: input.deploymentTask.id || randomUUID(),
      instance_id: instance.id,
      status: "queued",
      attempt: Number(input.deploymentTask.attempt || 0),
      max_attempts: Number(input.deploymentTask.max_attempts || 3),
      current_step: input.deploymentTask.current_step || "queued",
      created_at: input.deploymentTask.created_at || nowIso(),
      updated_at: nowIso(),
    };
    if (task.payload_json?.secureData) {
      task.payload_json.secureData.host_port = reservedPort;
      task.payload_json.secureData.port = String(reservedPort);
    }
    if (task.payload_json?.instance) {
      task.payload_json.instance = instance;
    }
    db.prepare(`INSERT INTO deploymentTasksCore(
      id, instance_id, status, attempt, max_attempts, current_step, next_retry_at,
      error_code, error_message, cancel_requested, payload_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?)`)
      .run(task.id, task.instance_id, task.status, task.attempt, task.max_attempts, task.current_step,
        task.next_retry_at || null, JSON.stringify(task.payload_json ?? null), task.created_by || null,
        task.created_at, task.updated_at);
    if (key) {
      db.prepare("INSERT INTO idempotencyRecords(idempotency_key, request_hash, instance_id, deployment_task_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(key, input.requestHash || "", instance.id, task.id, nowIso());
    }
    db.exec("COMMIT");
    return { kind: "created", instance, task: mapDeploymentTask({ ...task, payload_json: JSON.stringify(task.payload_json ?? null) }), port: reservedPort };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function listDeploymentTasksCore() {
  return (openDatabase().prepare("SELECT * FROM deploymentTasksCore ORDER BY created_at DESC").all() as any[]).map(mapDeploymentTask);
}

export function getDeploymentTaskCore(id: string) {
  return mapDeploymentTask(openDatabase().prepare("SELECT * FROM deploymentTasksCore WHERE id = ?").get(id));
}

export function getIdempotencyRecord(key: string) {
  return openDatabase().prepare("SELECT * FROM idempotencyRecords WHERE idempotency_key=?").get(key) as any || null;
}

export function createDeploymentTaskCore(input: any) {
  const id = input.id || randomUUID();
  const now = nowIso();
  openDatabase().prepare(`INSERT INTO deploymentTasksCore(
    id,instance_id,status,attempt,max_attempts,current_step,next_retry_at,error_code,error_message,
    cancel_requested,payload_json,created_by,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)`).run(
    id, input.instance_id, input.status === "pending" ? "queued" : (input.status || "queued"),
    Number(input.attempt ?? input.retry_count ?? 0), Number(input.max_attempts || 3), input.current_step || "queued",
    input.next_retry_at || null, input.error_code || null, input.error_message || null,
    JSON.stringify(input.payload_json ?? null), input.created_by || null, input.created_at || now, now
  );
  return getDeploymentTaskCore(id);
}

export function claimNextDeploymentTask(workerId: string, leaseSeconds: number) {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = nowIso();
    const row = db.prepare(`SELECT id FROM deploymentTasksCore
      WHERE cancel_requested = 0 AND attempt < max_attempts AND (
        status = 'queued' OR
        (status = 'retry_wait' AND (next_retry_at IS NULL OR next_retry_at <= ?)) OR
        (status = 'deploying' AND lease_until IS NOT NULL AND lease_until < ?)
      ) ORDER BY created_at LIMIT 1`).get(now, now) as { id: string } | undefined;
    if (!row) { db.exec("COMMIT"); return null; }
    const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    db.prepare(`UPDATE deploymentTasksCore SET status='deploying', worker_id=?, locked_at=?,
      heartbeat_at=?, lease_until=?, attempt=attempt+1,
      current_step=CASE WHEN current_step='queued' THEN 'preparing' ELSE current_step END,
      updated_at=? WHERE id=?`).run(workerId, now, now, leaseUntil, now, row.id);
    const claimed = mapDeploymentTask(db.prepare("SELECT * FROM deploymentTasksCore WHERE id=?").get(row.id));
    db.exec("COMMIT");
    return claimed;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function failExhaustedDeploymentTasks() {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = nowIso();
    const rows = db.prepare(`SELECT * FROM deploymentTasksCore
      WHERE status='deploying' AND cancel_requested=0
        AND attempt >= max_attempts
        AND lease_until IS NOT NULL AND lease_until < ?`).all(now) as any[];
    if (rows.length) {
      const update = db.prepare(`UPDATE deploymentTasksCore SET
        status='failed', worker_id=NULL, locked_at=NULL, lease_until=NULL,
        error_code='DEPLOYMENT_RETRY_EXHAUSTED',
        error_message='Deployment worker recovery attempts were exhausted.',
        error_detail=COALESCE(error_detail, 'Deployment lease expired after the maximum number of recovery attempts.'), failed_at=?,
        completed_at=?, updated_at=? WHERE id=? AND status='deploying'`);
      for (const row of rows) update.run(now, now, now, row.id);
    }
    const finalized = rows.map((row) => mapDeploymentTask(db.prepare("SELECT * FROM deploymentTasksCore WHERE id=?").get(row.id)));
    db.exec("COMMIT");
    return finalized;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateDeploymentTaskCore(id: string, updates: Record<string, any>, workerId?: string) {
  const allowed = new Set(["status", "worker_id", "locked_at", "lease_until", "heartbeat_at", "attempt", "max_attempts", "current_step", "next_retry_at", "error_code", "error_message", "error_detail", "failed_at", "cancel_requested", "completed_at", "payload_json"]);
  const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
  if (!entries.length) return getDeploymentTaskCore(id);
  const values = entries.map(([key, value]) => key === "payload_json" ? JSON.stringify(value) : key === "cancel_requested" ? (value ? 1 : 0) : value);
  const assignments = entries.map(([key]) => `${quoteIdentifier(key)} = ?`).join(", ");
  const workerGuard = workerId ? " AND worker_id = ?" : "";
  openDatabase().prepare(`UPDATE deploymentTasksCore SET ${assignments}, updated_at=? WHERE id=?${workerGuard}`)
    .run(...values, nowIso(), id, ...(workerId ? [workerId] : []));
  return getDeploymentTaskCore(id);
}

export function renewDeploymentLease(id: string, workerId: string, leaseSeconds: number) {
  const now = nowIso();
  const result = openDatabase().prepare(`UPDATE deploymentTasksCore SET heartbeat_at=?, lease_until=?, updated_at=?
    WHERE id=? AND worker_id=? AND status='deploying' AND cancel_requested=0`)
    .run(now, new Date(Date.now() + leaseSeconds * 1000).toISOString(), now, id, workerId);
  return Number(result.changes) === 1;
}

export function cancelDeploymentTasksForInstance(instanceId: string) {
  const now = nowIso();
  openDatabase().prepare(`UPDATE deploymentTasksCore SET cancel_requested=1,
    status=CASE WHEN status IN ('queued','retry_wait') THEN 'cancelled' ELSE status END,
    error_code='DEPLOYMENT_CANCELLED', error_message='Deployment was cancelled because the instance is being deleted.',
    completed_at=CASE WHEN status IN ('queued','retry_wait') THEN ? ELSE completed_at END, updated_at=?
    WHERE instance_id=? AND status IN ('queued','deploying','retry_wait')`).run(now, now, instanceId);
}

export function releasePortReservation(instanceId: string) {
  return openDatabase().prepare("DELETE FROM instancePortReservations WHERE instance_id=?").run(instanceId);
}

export function reservePortForInstance(instanceId: string, candidatePorts: number[]) {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM instancePortReservations WHERE instance_id=?").run(instanceId);
    const insert = db.prepare("INSERT INTO instancePortReservations(port,instance_id,status,created_at,released_at) VALUES (?,?,'reserved',?,NULL)");
    for (const port of candidatePorts) {
      try {
        insert.run(port, instanceId, nowIso());
        db.exec("COMMIT");
        return port;
      } catch (error: any) {
        if (!String(error?.message || error).includes("UNIQUE")) throw error;
      }
    }
    db.exec("ROLLBACK");
    return null;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function getPortReservation(instanceId: string) {
  return openDatabase().prepare("SELECT * FROM instancePortReservations WHERE instance_id=? AND status!='released'").get(instanceId) as any || null;
}

export type CleanupMode = "delete" | "archive";

export function createCleanupTaskCore(instanceId: string, cleanupMode: CleanupMode = "delete") {
  const db = openDatabase();
  const existing = db.prepare("SELECT * FROM cleanupTasks WHERE instance_id=? AND cleanup_mode=? AND status IN ('queued','cleaning','retry_wait') ORDER BY created_at DESC LIMIT 1").get(instanceId, cleanupMode) as any;
  if (existing) return existing;
  const id = randomUUID();
  const now = nowIso();
  db.prepare("INSERT INTO cleanupTasks(id,instance_id,cleanup_mode,status,attempt,current_step,created_at,updated_at) VALUES (?,?,?,'queued',0,'queued',?,?)").run(id, instanceId, cleanupMode, now, now);
  return db.prepare("SELECT * FROM cleanupTasks WHERE id=?").get(id) as any;
}

export function getLatestCleanupTaskForInstance(instanceId: string) {
  return openDatabase().prepare("SELECT * FROM cleanupTasks WHERE instance_id=? ORDER BY created_at DESC LIMIT 1").get(instanceId) as any || null;
}

export function claimNextCleanupTask(workerId: string, leaseSeconds: number) {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = nowIso();
    const row = db.prepare("SELECT id FROM cleanupTasks WHERE status='queued' OR (status='retry_wait' AND (next_retry_at IS NULL OR next_retry_at <= ?)) OR (status='cleaning' AND lease_until < ?) ORDER BY created_at LIMIT 1").get(now, now) as any;
    if (!row) { db.exec("COMMIT"); return null; }
    db.prepare("UPDATE cleanupTasks SET status='cleaning',current_step='cleanup_started',worker_id=?,lease_until=?,attempt=attempt+1,updated_at=? WHERE id=?")
      .run(workerId, new Date(Date.now()+leaseSeconds*1000).toISOString(), now, row.id);
    const task = db.prepare("SELECT * FROM cleanupTasks WHERE id=?").get(row.id) as any;
    db.exec("COMMIT");
    return task;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function updateCleanupTaskCore(id: string, status: string, errorCode?: string | null, errorMessage?: string | null, updates: Record<string, any> = {}) {
  const terminal = status === "success" || status === "failed";
  const now = nowIso();
  openDatabase().prepare(`UPDATE cleanupTasks SET status=?,error_code=?,error_message=?,error_detail=?,
    failed_at=?,current_step=?,next_retry_at=?,worker_id=?,lease_until=?,completed_at=?,updated_at=? WHERE id=?`)
    .run(status, errorCode || null, errorMessage || null, updates.error_detail || null,
      status === "failed" ? now : null, updates.current_step || status, updates.next_retry_at || null,
      terminal || status === "retry_wait" ? null : updates.worker_id ?? null,
      terminal || status === "retry_wait" ? null : updates.lease_until ?? null,
      terminal ? now : null, now, id);
}

export function deleteProvisioningRecords(instanceId: string) {
  const db = openDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM instanceIdentities WHERE instance_id=?").run(instanceId);
    db.prepare("DELETE FROM instancePortReservations WHERE instance_id=?").run(instanceId);
    db.prepare("DELETE FROM deploymentTasksCore WHERE instance_id=?").run(instanceId);
    db.prepare("DELETE FROM idempotencyRecords WHERE instance_id=?").run(instanceId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function closeLocalDatabase() {
  if (!activeDb) return;
  activeDb.close();
  activeDb = null;
  activeDbPath = "";
}

export function nowIso() {
  return new Date().toISOString();
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = Math.max(0, (page - 1) * pageSize);
  return items.slice(start, start + pageSize);
}

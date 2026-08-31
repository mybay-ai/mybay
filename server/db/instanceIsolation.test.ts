import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeLocalDatabase, mutateStore, readStoreCollections } from "../localStore";
import { dbAdapter } from "./index";

let directory: string;
let inspection: DatabaseSync;

describe("instance reconciliation database isolation", () => {
  beforeEach(() => {
    closeLocalDatabase();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-instance-isolation-"));
    const sqlitePath = path.join(directory, "test.sqlite");
    vi.stubEnv("MYBAY_SQLITE_PATH", sqlitePath);
    vi.stubEnv("LOCAL_STORE_PATH", path.join(directory, "absent.json"));
    mutateStore(data => {
      data.users = [{ id: "owner", username: "Admin" }];
      data.instances = [
        { id: "active", user_id: "owner", path: "first", config_json: "{}", status: "running" },
        { id: "other", owner_id: "other-owner", instance_path: "second", status: "stopped" },
        { id: "archived", archived_at: "2026-01-01" },
      ];
      data.chatMessages = [{ id: "keep", content: "unrelated history" }];
    });
    inspection = new DatabaseSync(sqlitePath);
  });

  afterEach(() => {
    inspection?.close();
    closeLocalDatabase();
    vi.unstubAllEnvs();
    // Delete only this test's newly allocated directory and its direct files.
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("mybay-instance-isolation-")) throw new Error("Unexpected test directory");
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  });

  it("updates physical state without rewriting unrelated history", async () => {
    inspection.exec("CREATE TRIGGER forbid_history_delete BEFORE DELETE ON chatMessages BEGIN SELECT RAISE(ABORT, 'unrelated history rewritten'); END");
    const before = inspection.prepare("SELECT data FROM chatMessages WHERE id='keep'").get();
    const result = await dbAdapter.updateInstancePhysicalState("active", { physical_status: "running", last_reconciled_at: "test-time" });
    expect(result).toMatchObject({ id: "active", config_json: "{}", physical_status: "running", last_reconciled_at: "test-time" });
    expect(result.updated_at).toEqual(expect.any(String));
    expect(inspection.prepare("SELECT data FROM chatMessages WHERE id='keep'").get()).toEqual(before);
    expect(readStoreCollections(["instances"]).instances.find(i => i.id === "other")?.status).toBe("stopped");
    expect(await dbAdapter.updateInstanceRecord("missing", { status: "running" })).toBeNull();
  });

  it("does not parse unrelated collections for authentication or instance queries", async () => {
    inspection.prepare("UPDATE chatMessages SET data=? WHERE id='keep'").run("deliberately-invalid-json");
    expect(await dbAdapter.getUserByUsername(" ADMIN ")).toMatchObject({ id: "owner" });
    expect(await dbAdapter.getUserById("missing")).toBeNull();
    expect(await dbAdapter.getInstanceById("active")).toMatchObject({ id: "active" });
    expect(await dbAdapter.getInstanceByPath("second")).toMatchObject({ id: "other" });
    expect((await dbAdapter.getAllInstances()).map(i => i.id)).toEqual(["active", "other"]);
    expect((await dbAdapter.getInstances("owner", "user")).map(i => i.id)).toEqual(["active"]);
  });
});

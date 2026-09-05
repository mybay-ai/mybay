import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbAdapter } from "./index";
import { closeLocalDatabase, mutateStore, mutateStoreCollections } from "../localStore";

let directory: string;
let observer: DatabaseSync;
let previousPath: string | undefined;

describe("background store isolation", () => {
  beforeEach(() => {
    closeLocalDatabase();
    previousPath = process.env.MYBAY_SQLITE_PATH;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-background-store-"));
    process.env.MYBAY_SQLITE_PATH = path.join(directory, "test.sqlite");
    mutateStore((store) => {
      store.chatMessages.push({ id: "preserved-message", content: "unchanged" });
      store.files.push({ id: "deleted-file", deleted_at: "2026-01-01" });
      store.systemSettings.protected = "keep";
    });
    observer = new DatabaseSync(process.env.MYBAY_SQLITE_PATH);
    // A broad read would parse this unrelated row and fail. This fixture must
    // remain confined to the isolated test database.
    observer.prepare("UPDATE chatMessages SET data = ?").run("not-json");
    observer.exec(`CREATE TRIGGER protect_message_delete BEFORE DELETE ON chatMessages
      BEGIN SELECT RAISE(ABORT, 'unrelated message write'); END;
      CREATE TRIGGER protect_message_update BEFORE UPDATE ON chatMessages
      BEGIN SELECT RAISE(ABORT, 'unrelated message write'); END;`);
  });

  afterEach(() => {
    observer?.close();
    closeLocalDatabase();
    if (previousPath === undefined) delete process.env.MYBAY_SQLITE_PATH;
    else process.env.MYBAY_SQLITE_PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("reads and updates channel events without touching chat history", async () => {
    await dbAdapter.upsertChannelAuthEvent({ id: "a", instance_id: "one", status: "pending" });
    await dbAdapter.upsertChannelAuthEvent({ id: "b", instance_id: "two", status: "pending" });
    await dbAdapter.upsertChannelAuthEvent({ id: "a", instance_id: "one", display_name: "updated" });
    expect(await dbAdapter.getChannelAuthEventsByInstance("one")).toEqual([
      expect.objectContaining({ id: "a", display_name: "updated", status: "pending" }),
    ]);
    expect(await dbAdapter.updateChannelAuthEventStatus("a", "approved", "admin"))
      .toEqual(expect.objectContaining({ approved_by: "admin", status: "approved", approved_at: expect.any(String) }));
    expect(await dbAdapter.getChannelAuthEventById("b")).toEqual(expect.objectContaining({ status: "pending" }));
    expect(await dbAdapter.deleteChannelAuthEventsByIds(["a", "missing"])).toEqual({ changes: 1 });
    await dbAdapter.deleteChannelAuthEventsForInstance("one");
    expect(await dbAdapter.getChannelAuthEventById("b")).not.toBeNull();
    await dbAdapter.deleteChannelAuthEventsForInstance("two");
    expect(await dbAdapter.getChannelAuthEventById("b")).toBeNull();
    expect(await dbAdapter.listPendingDeletedFileRecords()).toHaveLength(1);
    expect(observer.prepare("SELECT data FROM chatMessages").get()?.data).toBe("not-json");
  });

  it("persists a single setting and skips updates when its value is unchanged", async () => {
    expect(await dbAdapter.getSystemSetting("missing")).toBeNull();
    expect(await dbAdapter.getSystemSettingBoolean("missing", true)).toBe(true);
    await dbAdapter.setSystemSetting("enabled", "YES");
    expect(await dbAdapter.getSystemSettingBoolean("enabled")).toBe(true);
    await dbAdapter.setSystemSettingBoolean("enabled", false);
    expect(await dbAdapter.getSystemSettingBoolean("enabled", true)).toBe(false);
    observer.exec(`CREATE TRIGGER protect_unchanged_setting BEFORE UPDATE ON systemSettings
      WHEN OLD.value = NEW.value BEGIN SELECT RAISE(ABORT, 'unchanged setting written'); END;`);
    await dbAdapter.setSystemSettingBoolean("enabled", false);
    await dbAdapter.setSystemSetting("quoted'key", "");
    expect(await dbAdapter.getSystemSetting("quoted'key")).toBe("");
    closeLocalDatabase();
    expect(await dbAdapter.getSystemSetting("enabled")).toBe("false");
    expect(await dbAdapter.getSystemSetting("protected")).toBe("keep");
  });

  it("isolates file reads while retaining conversation, deletion and owner filters", async () => {
    mutateStoreCollections(["files"], (store) => {
      store.files = [
        { id: "old", owner_id: "owner", instance_id: "one", conversation_id: "chat", filename: "old.txt", created_at: "2026-01-01" },
        { id: "new", owner_id: "owner", instance_id: "one", conversation_id: "chat", filename: "new.txt", created_at: "2026-01-02" },
        { id: "deleted", instance_id: "one", conversation_id: "chat", filename: "gone.txt", deleted_at: "2026-01-03" },
        { id: "other-instance", instance_id: "two", conversation_id: "chat", filename: "foreign.txt" },
        { id: "other-chat", instance_id: "one", conversation_id: "elsewhere", filename: "foreign.txt" },
        { id: "unbound", owner_id: "owner", instance_id: null },
        { id: "other-owner", owner_id: "other", instance_id: null },
      ];
    });
    expect((await dbAdapter.listFilesByConversation("one", "chat")).map((file) => file.id)).toEqual(["new", "old"]);
    expect(await dbAdapter.listFilesByConversation("missing", "chat")).toEqual([]);
    expect(await dbAdapter.getFileRecordById("new")).toEqual(expect.objectContaining({ filename: "new.txt" }));
    expect(await dbAdapter.getFileRecordById("missing")).toBeNull();
    // Direct lookup retains soft-deleted records for cleanup and retry checks.
    expect(await dbAdapter.getFileRecordById("deleted")).toEqual(expect.objectContaining({ deleted_at: "2026-01-03" }));
    expect(await dbAdapter.hasActiveFileRecord("one", "chat", "new.txt")).toBe(true);
    expect(await dbAdapter.hasActiveFileRecord("one", "chat", "gone.txt")).toBe(false);
    expect(await dbAdapter.hasActiveFileRecord("one", "chat", "foreign.txt")).toBe(false);
    expect((await dbAdapter.listUnboundFilesByOwner("owner")).map((file) => file.id)).toEqual(["unbound"]);
    expect(observer.prepare("SELECT data FROM chatMessages").get()?.data).toBe("not-json");
  });
});

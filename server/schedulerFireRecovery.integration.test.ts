import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAdapter } from "./db";
import { closeLocalDatabase, readStore } from "./localStore";
import { runSchedulerTick, stopSchedulerRunner } from "./schedulerRunner";

const executeTaskInBackground = vi.hoisted(() => vi.fn());
vi.mock("./workers/taskRunner", () => ({ executeTaskInBackground }));

const sqlitePath = path.resolve(process.cwd(), "data", "test-scheduler-fire-recovery.sqlite");
const legacyPath = path.resolve(process.cwd(), "data", "test-scheduler-fire-recovery-legacy.json");

function cleanup() {
  stopSchedulerRunner();
  closeLocalDatabase();
  for (const target of [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`, `${sqlitePath}.migration-complete`, legacyPath]) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

describe("scheduled fire recovery on local SQLite", () => {
  beforeEach(async () => {
    cleanup();
    executeTaskInBackground.mockReset();
    executeTaskInBackground.mockResolvedValue(undefined);
    process.env.MYBAY_SQLITE_PATH = path.relative(process.cwd(), sqlitePath);
    process.env.LOCAL_STORE_PATH = path.relative(process.cwd(), legacyPath);
    await dbAdapter.createInstance({ id: "instance-recovery", user_id: "user-1", name: "Recovery Agent", status: "running", config_json: "{}" });
  });

  afterEach(() => {
    cleanup();
    delete process.env.MYBAY_SQLITE_PATH;
    delete process.env.LOCAL_STORE_PATH;
  });

  it("rebuilds a task after a claimed-fire crash without creating duplicates", async () => {
    const fireAt = new Date(Date.now() - 60_000).toISOString();
    const task = {
      owner_id: "user-1",
      instance_id: "instance-recovery",
      template_id: "daily-news-briefing",
      title: "Recovered scheduled task",
      trigger_type: "schedule",
      status: "queued",
      input_payload: { template_slug: "daily-news-briefing", template_inputs: { industry: "AI" } }
    };
    const firstClaim = await dbAdapter.claimScheduledFire("job-recovery", fireAt, {
      instance_id: "instance-recovery",
      owner_id: "user-1",
      template_id: "daily-news-briefing",
      task
    });
    const duplicateClaim = await dbAdapter.claimScheduledFire("job-recovery", fireAt, {
      instance_id: "instance-recovery",
      owner_id: "user-1",
      template_id: "daily-news-briefing",
      task
    });
    expect(firstClaim.claimed).toBe(true);
    expect(duplicateClaim.claimed).toBe(false);
    expect(readStore().tasks).toHaveLength(0);

    await runSchedulerTick({ executeTasks: false });
    closeLocalDatabase();
    await runSchedulerTick({ executeTasks: false });

    const store = readStore();
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].scheduled_fire_id).toBe(firstClaim.fire.id);
    expect(store.tasks[0].idempotency_key).toBe(`job-recovery:${fireAt}`);
    expect(store.scheduledFires).toHaveLength(1);
    expect(store.scheduledFires[0].status).toBe("dispatched");
    expect(store.scheduledFires[0].task_id).toBe(store.tasks[0].id);
    expect(executeTaskInBackground).not.toHaveBeenCalled();
  });
});

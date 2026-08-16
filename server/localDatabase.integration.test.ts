import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbAdapter } from "./db";
import { closeLocalDatabase } from "./localStore";
import { chatRepo } from "./repositories/chatRepo";
import { tasksRepo } from "./repositories/tasksRepo";
import { scheduledJobsRepo } from "./repositories/scheduledJobsRepo";
import { templatesRepo } from "./repositories/templatesRepo";

const sqlitePath = path.resolve(process.cwd(), "data", "test-core-repositories.sqlite");
const legacyPath = path.resolve(process.cwd(), "data", "test-core-legacy.json");
function cleanup() {
  closeLocalDatabase();
  for (const suffix of ["", "-wal", "-shm", ".migration-complete"]) {
    const target = `${sqlitePath}${suffix}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

describe("core repositories on local SQLite", () => {
  beforeEach(() => {
    cleanup();
    process.env.MYBAY_SQLITE_PATH = path.relative(process.cwd(), sqlitePath);
    process.env.LOCAL_STORE_PATH = path.relative(process.cwd(), legacyPath);
  });
  afterEach(() => {
    cleanup();
    delete process.env.MYBAY_SQLITE_PATH;
    delete process.env.LOCAL_STORE_PATH;
  });

  it("supports user, instance, chat, task, schedule, credential and template CRUD", async () => {
    await dbAdapter.createUser({ id: "user-1", username: "admin", role: "admin" });
    expect((await dbAdapter.getUserById("user-1"))?.username).toBe("admin");
    await dbAdapter.updateUserProfile("user-1", { display_name: "Local Admin" });
    expect((await dbAdapter.getUserById("user-1"))?.display_name).toBe("Local Admin");

    await dbAdapter.createInstance({ id: "instance-1", user_id: "user-1", name: "Agent", status: "running" });
    await dbAdapter.updateInstanceName("instance-1", "Local Agent");
    expect((await dbAdapter.getInstanceById("instance-1"))?.name).toBe("Local Agent");

    const conversation = await chatRepo.createConversation("user-1", "instance-1", "SQLite Chat");
    const turn = await chatRepo.beginChatTurn({ conversationId: conversation.id, userId: "user-1", instanceId: "instance-1", content: "hello", requestId: "request-1" });
    await chatRepo.finishChatTurn({ conversationId: conversation.id, userMessageId: turn.message_id!, status: "completed", assistantContent: "world" });
    expect((await chatRepo.listMessages(conversation.id, 20)).length).toBeGreaterThanOrEqual(2);

    const task = await tasksRepo.create({ owner_id: "user-1", instance_id: "instance-1", title: "Local task" });
    await tasksRepo.update(task.id, { status: "completed" });
    expect((await tasksRepo.findById(task.id))?.status).toBe("completed");

    const job = await scheduledJobsRepo.create({ owner_id: "user-1", instance_id: "instance-1", title: "Local schedule", cron_expression: "*/5 * * * *", is_active: true });
    await scheduledJobsRepo.update(job.id, { is_active: false });
    expect((await scheduledJobsRepo.findById(job.id))?.is_active).toBe(false);

    await dbAdapter.createCredential({ id: "credential-1", owner_id: "user-1", user_id: "user-1", name: "Provider", encrypted_value: "encrypted", key_encrypted: "encrypted" });
    await dbAdapter.updateCredential("credential-1", "user-1", { name: "Provider Updated" });
    expect((await dbAdapter.getCredentialById("credential-1", "user-1"))?.name).toBe("Provider Updated");

    const template = await templatesRepo.create({ id: "local-template", slug: "local-template", name: "Local Template", description: "test", is_active: true });
    await templatesRepo.update(template.id, { description: "updated" });
    expect((await templatesRepo.findById(template.id))?.description).toBe("updated");

    closeLocalDatabase();
    expect((await dbAdapter.getInstanceById("instance-1"))?.name).toBe("Local Agent");
    expect((await tasksRepo.findById(task.id))?.status).toBe("completed");

    await dbAdapter.deleteCredential("credential-1", "user-1");
    await dbAdapter.deleteInstance("instance-1");
    expect(await dbAdapter.getCredentialById("credential-1", "user-1")).toBeNull();
    expect(await dbAdapter.getInstanceById("instance-1")).toBeNull();
  }, 15_000);
});

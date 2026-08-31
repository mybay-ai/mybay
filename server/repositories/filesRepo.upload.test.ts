import { beforeEach, describe, expect, it } from "vitest";
import { closeLocalDatabase, mutateStoreCollections } from "../localStore";
import { filesRepo } from "./filesRepo";

const file = { owner_id: "owner", instance_id: "instance", conversation_id: "conversation", upload_request_id: "request", filename: "one.txt", size: 3, storage_path: "/one.txt", mime_type: "text/plain" };
beforeEach(() => { mutateStoreCollections(["files"], data => { data.files = []; }); });
describe("persistent upload deduplication", () => {
  it("commits only once for competing requests and survives database reopen", async () => {
    const results = await Promise.all([filesRepo.createUploadOnce(file), filesRepo.createUploadOnce({ ...file, storage_path: "/retry.txt" })]);
    expect(results.map(r => r.created)).toEqual([true, false]);
    expect(results[0].file.id).toBe(results[1].file.id);
    closeLocalDatabase();
    expect(await filesRepo.findUpload("owner", "instance", "conversation", "request")).toMatchObject({ id: results[0].file.id, storage_path: "/one.txt" });
    expect(await filesRepo.listByConversation("instance", "conversation")).toHaveLength(1);
  });
  it("scopes upload identities to owner, instance and conversation", async () => {
    await filesRepo.createUploadOnce(file);
    expect(await filesRepo.findUpload("other", "instance", "conversation", "request")).toBeNull();
    expect(await filesRepo.findUpload("owner", "other", "conversation", "request")).toBeNull();
    expect(await filesRepo.findUpload("owner", "instance", "other", "request")).toBeNull();
    expect((await filesRepo.createUploadOnce({ ...file, conversation_id: "other" })).created).toBe(true);
  });
  it("never recreates a deleted upload when its response is retried", async () => {
    const first = await filesRepo.createUploadOnce(file);
    await filesRepo.softDelete(first.file.id);
    const retry = await filesRepo.createUploadOnce(file);
    expect(retry.created).toBe(false);
    expect(retry.file.deleted_at).toBeTruthy();
    expect(await filesRepo.listByConversation("instance", "conversation")).toEqual([]);
  });
});

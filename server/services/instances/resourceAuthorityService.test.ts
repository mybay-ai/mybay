import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstanceById: vi.fn(),
  getConversationForOwnerAndInstance: vi.fn(),
  getChatRun: vi.fn(),
  getMessage: vi.fn(),
  findFileById: vi.fn(),
}));

vi.mock("../../db", () => ({ dbAdapter: { getInstanceById: mocks.getInstanceById } }));
vi.mock("../../repositories/chatRepo", () => ({
  chatRepo: {
    getConversationForOwnerAndInstance: mocks.getConversationForOwnerAndInstance,
    getChatRun: mocks.getChatRun,
    getMessage: mocks.getMessage,
  },
}));
vi.mock("../../repositories/filesRepo", () => ({
  filesRepo: { findById: mocks.findFileById },
}));

import {
  resolveConversationAuthority,
  resolveConversationFileAuthority,
  resolveConversationMessageAuthority,
  resolveConversationRunAuthority,
  resolveInstanceAuthority,
  resolveInstanceOwnerId,
  resolveInstanceRunAuthority,
  resolveRunDispatchAuthority,
} from "./resourceAuthorityService";

const instance = { id: "instance-a", owner_id: "owner-a", user_id: "owner-a" };
const conversation = { id: "conversation-a", user_id: "owner-a", instance_id: "instance-a" };

async function ownerContext() {
  mocks.getInstanceById.mockResolvedValue(instance);
  const result = await resolveInstanceAuthority({ actor: { kind: "user", id: "owner-a" }, instanceId: "instance-a" });
  if (result.ok === false) throw new Error(result.code);
  return result;
}

async function conversationContext() {
  const owner = await ownerContext();
  mocks.getConversationForOwnerAndInstance.mockResolvedValue(conversation);
  const result = await resolveConversationAuthority({ instance: owner, conversationId: "conversation-a" });
  if (result.ok === false) throw new Error(result.code);
  return result;
}

describe("resource authority service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails closed for missing or conflicting instance ownership", () => {
    expect(resolveInstanceOwnerId({})).toEqual({ ok: false, status: 404, code: "INSTANCE_NOT_FOUND" });
    expect(resolveInstanceOwnerId({ owner_id: "owner-a", user_id: "owner-b" })).toEqual({
      ok: false,
      status: 409,
      code: "INSTANCE_OWNERSHIP_INCONSISTENT",
    });
  });

  it("allows only the effective owner", async () => {
    mocks.getInstanceById.mockResolvedValue(instance);
    await expect(resolveInstanceAuthority({ actor: null, instanceId: "instance-a" }))
      .resolves.toEqual({ ok: false, status: 401, code: "UNAUTHENTICATED" });
    await expect(resolveInstanceAuthority({ actor: { kind: "user", id: "other" }, instanceId: "instance-a" }))
      .resolves.toEqual({ ok: false, status: 403, code: "FORBIDDEN" });
    await expect(resolveInstanceAuthority({ actor: { kind: "user", id: "owner-a" }, instanceId: "instance-a" }))
      .resolves.toMatchObject({ ok: true, ownerId: "owner-a", instance });
  });

  it("resolves conversations through owner and instance together", async () => {
    const owner = await ownerContext();
    mocks.getConversationForOwnerAndInstance.mockResolvedValue(null);
    await expect(resolveConversationAuthority({ instance: owner, conversationId: "foreign-conversation" }))
      .resolves.toEqual({ ok: false, status: 404, code: "CONVERSATION_NOT_FOUND" });
    expect(mocks.getConversationForOwnerAndInstance).toHaveBeenCalledWith("owner-a", "instance-a", "foreign-conversation");
  });

  it.each([
    ["owner", { owner_id: "other", instance_id: "instance-a", conversation_id: "conversation-a" }],
    ["instance", { owner_id: "owner-a", instance_id: "instance-b", conversation_id: "conversation-a" }],
    ["conversation", { owner_id: "owner-a", instance_id: "instance-a", conversation_id: "conversation-b" }],
    ["deleted", { owner_id: "owner-a", instance_id: "instance-a", conversation_id: "conversation-a", deleted_at: "2026-08-28" }],
  ])("hides files with a mismatched %s relationship", async (_label, file) => {
    const authority = await conversationContext();
    mocks.findFileById.mockResolvedValue({ id: "file-a", ...file });
    await expect(resolveConversationFileAuthority({ conversation: authority, fileId: "file-a" }))
      .resolves.toEqual({ ok: false, status: 404, code: "FILE_NOT_FOUND" });
  });

  it("requires messages to belong to the exact conversation", async () => {
    const authority = await conversationContext();
    mocks.getMessage.mockResolvedValue({ id: "message-a", conversation_id: "conversation-b", instance_id: "instance-a" });
    await expect(resolveConversationMessageAuthority({ conversation: authority, messageId: "message-a" }))
      .resolves.toEqual({ ok: false, status: 404, code: "MESSAGE_NOT_FOUND" });
  });

  it("resolves run-only URLs through the owning conversation", async () => {
    const owner = await ownerContext();
    mocks.getChatRun.mockResolvedValue({ id: "run-a", user_id: "owner-a", instance_id: "instance-a", conversation_id: "conversation-a" });
    mocks.getConversationForOwnerAndInstance.mockResolvedValue(null);
    await expect(resolveInstanceRunAuthority({ instance: owner, runId: "run-a" }))
      .resolves.toEqual({ ok: false, status: 404, code: "RUN_NOT_FOUND" });
  });

  it("rejects a run from a different conversation", async () => {
    const authority = await conversationContext();
    mocks.getChatRun.mockResolvedValue({ id: "run-a", user_id: "owner-a", instance_id: "instance-a", conversation_id: "conversation-b" });
    mocks.getConversationForOwnerAndInstance.mockResolvedValue({ ...conversation, id: "conversation-b" });
    await expect(resolveConversationRunAuthority({ conversation: authority, runId: "run-a" }))
      .resolves.toEqual({ ok: false, status: 404, code: "RUN_NOT_FOUND" });
  });

  it("rejects reconciler dispatch before runtime access when the chain is stale", async () => {
    mocks.getInstanceById.mockResolvedValue(instance);
    await expect(resolveRunDispatchAuthority({
      id: "run-a",
      user_id: "other",
      instance_id: "instance-a",
      conversation_id: "conversation-a",
    })).resolves.toEqual({ ok: false, status: 404, code: "RUN_NOT_FOUND" });
    expect(mocks.getConversationForOwnerAndInstance).not.toHaveBeenCalled();
  });
});

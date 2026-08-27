import { dbAdapter } from "../../db";
import { chatRepo } from "../../repositories/chatRepo";
import { filesRepo, type FileRecord } from "../../repositories/filesRepo";

export type AuthorityActor = {
  kind: "user" | "system";
  id: string;
};

export type AuthorityFailure = {
  ok: false;
  status: 401 | 403 | 404 | 409;
  code:
    | "UNAUTHENTICATED"
    | "INSTANCE_NOT_FOUND"
    | "FORBIDDEN"
    | "INSTANCE_OWNERSHIP_INCONSISTENT"
    | "CONVERSATION_NOT_FOUND"
    | "FILE_NOT_FOUND"
    | "MESSAGE_NOT_FOUND"
    | "RUN_NOT_FOUND";
};

export type InstanceAuthorityContext = {
  ok: true;
  actor: AuthorityActor;
  instance: any;
  ownerId: string;
};

export type ConversationAuthorityContext = InstanceAuthorityContext & {
  conversation: any;
};

export type ConversationFileAuthorityContext = ConversationAuthorityContext & {
  file: FileRecord;
};

export type ConversationRunAuthorityContext = ConversationAuthorityContext & {
  run: any;
};

export type ConversationMessageAuthorityContext = ConversationAuthorityContext & {
  message: any;
};

export function resolveInstanceOwnerId(instance: any):
  | { ok: true; ownerId: string; legacyField: "owner_id" | "user_id" | "both" }
  | AuthorityFailure {
  const ownerId = String(instance?.owner_id || "").trim();
  const userId = String(instance?.user_id || "").trim();
  if (ownerId && userId && ownerId !== userId) {
    return { ok: false, status: 409, code: "INSTANCE_OWNERSHIP_INCONSISTENT" };
  }
  const effectiveOwnerId = ownerId || userId;
  if (!effectiveOwnerId) return { ok: false, status: 404, code: "INSTANCE_NOT_FOUND" };
  return {
    ok: true,
    ownerId: effectiveOwnerId,
    legacyField: ownerId && userId ? "both" : ownerId ? "owner_id" : "user_id",
  };
}

export async function resolveInstanceAuthority(input: {
  actor: AuthorityActor | null | undefined;
  instanceId: string;
}): Promise<InstanceAuthorityContext | AuthorityFailure> {
  if (!input.actor?.id) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  const instance = await dbAdapter.getInstanceById(input.instanceId);
  if (!instance) return { ok: false, status: 404, code: "INSTANCE_NOT_FOUND" };
  const owner = resolveInstanceOwnerId(instance);
  if (owner.ok === false) return owner;
  if (input.actor.kind !== "user" || input.actor.id !== owner.ownerId) {
    return { ok: false, status: 403, code: "FORBIDDEN" };
  }
  return { ok: true, actor: input.actor, instance, ownerId: owner.ownerId };
}

export async function resolveConversationAuthority(input: {
  instance: InstanceAuthorityContext;
  conversationId: string;
}): Promise<ConversationAuthorityContext | AuthorityFailure> {
  const conversation = await chatRepo.getConversationForOwnerAndInstance(
    input.instance.ownerId,
    String(input.instance.instance.id),
    input.conversationId,
  );
  if (!conversation) return { ok: false, status: 404, code: "CONVERSATION_NOT_FOUND" };
  return { ...input.instance, conversation };
}

export async function resolveConversationFileAuthority(input: {
  conversation: ConversationAuthorityContext;
  fileId: string;
  includeDeleted?: boolean;
}): Promise<ConversationFileAuthorityContext | AuthorityFailure> {
  const file = await filesRepo.findById(input.fileId);
  if (!file
    || String(file.owner_id || "") !== input.conversation.ownerId
    || String(file.instance_id || "") !== String(input.conversation.instance.id)
    || String(file.conversation_id || "") !== String(input.conversation.conversation.id)
    || (!input.includeDeleted && Boolean(String(file.deleted_at || "").trim()))) {
    return { ok: false, status: 404, code: "FILE_NOT_FOUND" };
  }
  return { ...input.conversation, file };
}

export async function resolveConversationFilesAuthority(input: {
  conversation: ConversationAuthorityContext;
  fileIds: string[];
  includeDeleted?: boolean;
}): Promise<{ ok: true; files: FileRecord[] } | AuthorityFailure> {
  const files: FileRecord[] = [];
  for (const fileId of input.fileIds) {
    const result = await resolveConversationFileAuthority({
      conversation: input.conversation,
      fileId,
      includeDeleted: input.includeDeleted,
    });
    if (result.ok === false) return result;
    files.push(result.file);
  }
  return { ok: true, files };
}

export async function resolveConversationMessageAuthority(input: {
  conversation: ConversationAuthorityContext;
  messageId: string;
}): Promise<ConversationMessageAuthorityContext | AuthorityFailure> {
  const message = await chatRepo.getMessage(input.messageId);
  if (!message
    || String(message.conversation_id || "") !== String(input.conversation.conversation.id)
    || (message.instance_id && String(message.instance_id) !== String(input.conversation.instance.id))) {
    return { ok: false, status: 404, code: "MESSAGE_NOT_FOUND" };
  }
  return { ...input.conversation, message };
}

export async function resolveInstanceRunAuthority(input: {
  instance: InstanceAuthorityContext;
  runId: string;
}): Promise<ConversationRunAuthorityContext | AuthorityFailure> {
  const run = await chatRepo.getChatRun(input.runId);
  if (!run
    || String(run.user_id || "") !== input.instance.ownerId
    || String(run.instance_id || "") !== String(input.instance.instance.id)
    || !run.conversation_id) {
    return { ok: false, status: 404, code: "RUN_NOT_FOUND" };
  }
  const conversation = await resolveConversationAuthority({
    instance: input.instance,
    conversationId: String(run.conversation_id),
  });
  if (conversation.ok === false) return { ok: false, status: 404, code: "RUN_NOT_FOUND" };
  return { ...conversation, run };
}

export async function resolveConversationRunAuthority(input: {
  conversation: ConversationAuthorityContext;
  runId: string;
}): Promise<ConversationRunAuthorityContext | AuthorityFailure> {
  const resolved = await resolveInstanceRunAuthority({ instance: input.conversation, runId: input.runId });
  if (resolved.ok === false
    || String(resolved.conversation.id) !== String(input.conversation.conversation.id)) {
    return { ok: false, status: 404, code: "RUN_NOT_FOUND" };
  }
  return resolved;
}

export async function resolveRunDispatchAuthority(
  run: any,
): Promise<ConversationRunAuthorityContext | AuthorityFailure> {
  const instance = await dbAdapter.getInstanceById(String(run?.instance_id || ""));
  if (!instance) return { ok: false, status: 404, code: "INSTANCE_NOT_FOUND" };
  const owner = resolveInstanceOwnerId(instance);
  if (owner.ok === false) return owner;
  if (String(run?.user_id || "") !== owner.ownerId || !run?.conversation_id || !run?.id) {
    return { ok: false, status: 404, code: "RUN_NOT_FOUND" };
  }
  const conversation = await chatRepo.getConversationForOwnerAndInstance(
    owner.ownerId,
    String(instance.id),
    String(run.conversation_id),
  );
  if (!conversation) return { ok: false, status: 404, code: "RUN_NOT_FOUND" };
  return {
    ok: true,
    actor: { kind: "system", id: "run-reconciler" },
    instance,
    ownerId: owner.ownerId,
    conversation,
    run,
  };
}

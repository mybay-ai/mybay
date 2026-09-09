import { randomUUID } from "node:crypto";
import { chatRepo } from "../../repositories/chatRepo";
import { channelMessagesRepo, type ChannelMessage } from "../../repositories/channelMessagesRepo";
import { readStoreCollections } from "../../localStore";
import { resolveConversationAuthority, resolveInstanceAuthority } from "../instances/resourceAuthorityService";
import { guardManagedOperation } from "../../utils/managedOperationGuard";
import { isQuestionBridgeInstalling } from "../runs/questionBridgeInstaller";
import { runtimeRegistry } from "../../runtime/runtimeRegistry";
import { createConfiguredModelEvidence } from "../../../shared/localModelEvidence";
import { emitChatConversationUpdated } from "../chatRealtime";
import { requestRunReconcile, requestRunsReconcile, primeRunFileSnapshot, discardRunFileSnapshot } from "../runsReconciler";

/** Use the same persisted runs and reconciler as Web chat, without owner tokens
 * or internal HTTP calls. Revalidate the owner for every inbox dispatch. */
export async function submitManagedChannelMessage(message: ChannelMessage): Promise<string | null> {
  const authority = await resolveInstanceAuthority({ actor: { kind: "user", id: message.ownerId }, instanceId: message.instanceId });
  if (!authority.ok) throw new Error("CHANNEL_INSTANCE_UNAVAILABLE");
  const conversation = await resolveConversationAuthority({ instance: authority, conversationId: message.conversationId });
  if (!conversation.ok || conversation.conversation.channel_key !== message.conversationKey) throw new Error("CHANNEL_CONVERSATION_UNAVAILABLE");
  const instance = authority.instance;
  if (!["pi", "codex"].includes(instance.runtime_type)) throw new Error("CHANNEL_RUNTIME_UNSUPPORTED");
  const guard = guardManagedOperation(message.text, instance.runtime_type);
  if (guard.blocked) throw new Error(guard.code);
  if (isQuestionBridgeInstalling(message.instanceId)) return null;
  const config = typeof instance.config_json === "string" ? JSON.parse(instance.config_json) : instance.config_json || {};
  if (config.modelBillingMode === "platform") throw new Error("PLATFORM_MODELS_DISABLED");
  const runId = message.runId || randomUUID();
  // Persist the identity before beginning the run: crash recovery repeats the
  // same request, never a fresh model operation.
  channelMessagesRepo.update(message.id, { runId });
  const existingRun = readStoreCollections(["chatRuns"]).chatRuns.some(run => run.id === runId);
  if (!existingRun) primeRunFileSnapshot(runId, message.instanceId);
  let accepted = false;
  try {
    const result = await chatRepo.beginChatRun({
      runId, conversationId: message.conversationId, userId: message.ownerId,
      instanceId: message.instanceId, content: message.text, requestId: `feishu:${message.id}`,
      runtimeBinding: runtimeRegistry.createBindingForInstance(instance),
      modelEvidence: createConfiguredModelEvidence(config.model || instance.model_name),
    });
    if (result.status === "CONCURRENT_RUN") return null;
    if (result.status !== "success" && result.status !== "IDEMPOTENT_REPLAY") throw new Error("CHANNEL_RUN_REJECTED");
    accepted = true;
    const acceptedRunId = result.run_id || runId;
    channelMessagesRepo.update(message.id, { runId: acceptedRunId, status: "submitted" });
    emitChatConversationUpdated({ userId: message.ownerId, instanceId: message.instanceId, conversationId: message.conversationId, requestId: `feishu:${message.id}`, runId: acceptedRunId, source: "run_created", status: result.run_status || "queued" });
    if (!requestRunReconcile(acceptedRunId)) requestRunsReconcile();
    return acceptedRunId;
  } finally {
    if (!accepted && !existingRun) discardRunFileSnapshot(runId);
  }
}

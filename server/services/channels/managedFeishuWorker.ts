import { createHash, randomUUID } from "node:crypto";
import { decrypt } from "../../crypto";
import { readStoreCollections } from "../../localStore";
import { channelMessagesRepo, type ChannelMessage } from "../../repositories/channelMessagesRepo";
import { chatRepo } from "../../repositories/chatRepo";
import { requestRunsReconcile } from "../runsReconciler";
import { parseFeishuInbound, type FeishuBinding } from "./feishuInbound";
import { FeishuTransport } from "./feishuTransport";
import { submitManagedChannelMessage } from "./managedChannelRuns";

const connections = new Map<string, { fingerprint: string; transport: FeishuTransport; binding: FeishuBinding }>();
const statuses = new Map<string, string>();
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let stopped = true;
const ids = (value: unknown) => typeof value === "string" ? value.split(/[\s,;]+/).filter(Boolean) : [];

export function managedFeishuStatus(instanceId: string) { return statuses.get(instanceId) || "disabled"; }

function configOf(instance: any) {
  try { return typeof instance.config_json === "string" ? JSON.parse(instance.config_json) : instance.config_json || {}; } catch { return {}; }
}

function replies(text: string) {
  const chars = Array.from(text || "任务已结束，没有文本输出。");
  const chunks: NonNullable<ChannelMessage["replies"]> = [];
  for (let index = 0; index < chars.length; index += 2000) chunks.push({ id: randomUUID(), text: chars.slice(index, index + 2000).join(""), sent: false });
  return chunks;
}

export async function processManagedFeishuMessage(message: ChannelMessage, transport: Pick<FeishuTransport, "reply">) {
  if (message.status === "received" && !message.replies) {
    if (message.text === "/stop") {
      const runs = readStoreCollections(["chatRuns"]).chatRuns;
      const run = runs.find(row => row.conversation_id === message.conversationId && row.user_id === message.ownerId && row.instance_id === message.instanceId && (message.runId ? row.id === message.runId : ["queued", "running", "stopping"].includes(row.status)));
      if (run) {
        channelMessagesRepo.update(message.id, { runId: run.id });
        await chatRepo.requestStopChatRun({ runId: run.id, userId: message.ownerId, instanceId: message.instanceId });
        requestRunsReconcile();
      }
      channelMessagesRepo.update(message.id, { replies: replies(run ? "已提交停止请求，正在等待 Agent 确认。" : "当前会话没有正在执行的任务。") });
    } else {
      // An uncertain persistence error must remain retryable with the same
      // request ID; it must not hide a run that was already committed.
      await submitManagedChannelMessage(message);
    }
    return;
  }
  if (message.status === "submitted" && !message.replies) {
    const run = readStoreCollections(["chatRuns"]).chatRuns.find(row => row.id === message.runId && row.conversation_id === message.conversationId && row.user_id === message.ownerId && row.instance_id === message.instanceId);
    if (!run) {
      channelMessagesRepo.update(message.id, { replies: replies("任务记录已不存在，请在 MyBay 中确认。") });
    } else if (["completed", "failed", "cancelled", "expired"].includes(run.status)) {
      const prefix = run.status === "completed" ? "" : `任务状态：${run.status}\n`;
      channelMessagesRepo.update(message.id, { replies: replies(prefix + String(run.partial_output || "")) });
    }
    return;
  }
  if (message.replies) {
    const pending = message.replies.find(reply => !reply.sent);
    if (pending) {
      await transport.reply(message.messageId, pending.text, pending.id);
      pending.sent = true;
      channelMessagesRepo.update(message.id, { replies: message.replies });
    } else channelMessagesRepo.update(message.id, { status: "finished" });
  }
}

export async function reconcileManagedFeishu() {
  if (busy || stopped) return;
  busy = true;
  try {
    const instances = readStoreCollections(["instances"]).instances;
    const enabled = instances.filter(instance => ["pi", "codex"].includes(instance.runtime_type) && !instance.archived_at && configOf(instance).managedFeishuEnabled === true);
    const appCounts = new Map<string, number>();
    for (const instance of enabled) {
      const appId = String(configOf(instance).feishuAppId || "");
      appCounts.set(appId, (appCounts.get(appId) || 0) + 1);
    }
    for (const instance of instances) {
      const config = configOf(instance);
      if (!instance.archived_at && !enabled.some(row => row.id === instance.id)
        && ["feishu", "lark"].includes(config.channel) && config.allowMode !== "disabled") {
        const appId = String(config.feishuAppId || "");
        appCounts.set(appId, (appCounts.get(appId) || 0) + 1);
      }
    }
    for (const [instanceId, connection] of connections) {
      if (!enabled.some(instance => instance.id === instanceId) || appCounts.get(connection.binding.appId) !== 1) {
        connection.transport.close(); connections.delete(instanceId); statuses.set(instanceId, "disabled");
      }
    }
    for (const instance of enabled) {
      if (stopped) break;
      const config = configOf(instance);
      const ownerId = String(instance.user_id || instance.owner_id || "");
      if (appCounts.get(config.feishuAppId) !== 1) { statuses.set(instance.id, "duplicate_app_binding"); continue; }
      if (!ownerId || (instance.user_id && instance.owner_id && instance.user_id !== instance.owner_id)
        || !config.feishuAppSecret || !ids(config.feishuAllowedUsers).length) {
        connections.get(instance.id)?.transport.close(); connections.delete(instance.id);
        statuses.set(instance.id, "configuration_required"); continue;
      }
      const fingerprint = createHash("sha256").update(JSON.stringify([ownerId, instance.runtime_type, config.feishuAppId, config.feishuAppSecret, config.feishuAllowedUsers, config.feishuAllowedChats])).digest("hex");
      let connection = connections.get(instance.id);
      if (connection && connection.fingerprint !== fingerprint) {
        connection.transport.close(); connections.delete(instance.id); connection = undefined;
      }
      try {
        if (!connection) {
          const transport = new FeishuTransport(config.feishuAppId, decrypt(config.feishuAppSecret));
          try {
            const binding: FeishuBinding = { instanceId: instance.id, ownerId, appId: config.feishuAppId, botOpenId: await transport.botIdentity(), allowedUsers: ids(config.feishuAllowedUsers), allowedChats: ids(config.feishuAllowedChats) };
            connection = { fingerprint, transport, binding };
            connections.set(instance.id, connection);
            await transport.connect(event => {
              if (stopped || connections.get(instance.id)?.fingerprint !== fingerprint) return;
              const parsed = parseFeishuInbound(binding, event);
              if (parsed) channelMessagesRepo.receive(parsed);
            });
            if (stopped) { transport.close(); connections.delete(instance.id); break; }
          } catch {
            transport.close(); connections.delete(instance.id); throw new Error("FEISHU_CONNECTION_FAILED");
          }
        }
        statuses.set(instance.id, "listening");
        for (const message of channelMessagesRepo.pending(instance.id)) {
          if (stopped) break;
          // Recheck allowlists for queued work after configuration changes.
          if (message.appId !== connection.binding.appId || message.ownerId !== ownerId || !connection.binding.allowedUsers.includes(message.senderId)
            || (message.chatType === "group" && !connection.binding.allowedChats.includes(message.chatId))) continue;
          await processManagedFeishuMessage(message, connection.transport);
        }
      } catch { statuses.set(instance.id, "connection_or_delivery_failed"); }
    }
  } finally { busy = false; }
}

export function startManagedFeishuWorker() {
  if (timer) return;
  stopped = false;
  timer = setInterval(() => { void reconcileManagedFeishu().catch(() => {}); }, 3000);
  timer.unref();
  void reconcileManagedFeishu().catch(() => {});
}

export function stopManagedFeishuWorker() {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  for (const connection of connections.values()) connection.transport.close();
  connections.clear(); statuses.clear();
}

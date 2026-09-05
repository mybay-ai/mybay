export const CHAT_GROUP_MAX_PEERS = 5;
export const CHAT_GROUP_MAX_ROUNDS = 3;

export type ChatGroupConfig = {
  mode: "group";
  peerIds: string[];
  maxRounds: number;
};

export type ChatGroupRun = {
  version: 1;
  mode: "group";
  contextId: string;
  leader: { id: string; name: string };
  peers: Array<{ id: string; name: string }>;
  maxRounds: number;
};

function oneLine(value: unknown, max: number): string {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function readChatGroupConfig(value: unknown): ChatGroupConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.mode !== "group" || !Array.isArray(source.peerIds)) return null;
  const peerIds = Array.from(new Set(source.peerIds
    .filter((id): id is string => typeof id === "string")
    .map(id => id.trim())
    .filter(id => /^[A-Za-z0-9-]{1,128}$/.test(id))));
  if (peerIds.length < 1 || peerIds.length > CHAT_GROUP_MAX_PEERS) return null;
  const requestedRounds = Number(source.maxRounds);
  const maxRounds = Number.isInteger(requestedRounds)
    ? Math.min(CHAT_GROUP_MAX_ROUNDS, Math.max(1, requestedRounds))
    : 1;
  return { mode: "group", peerIds, maxRounds };
}

export function createChatGroupRun(input: {
  runId: string;
  leader: { id: string; name: string };
  peers: Array<{ id: string; name: string }>;
  maxRounds: number;
}): ChatGroupRun | null {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(input.runId)) return null;
  const leaderId = oneLine(input.leader.id, 128);
  const peers = input.peers.slice(0, CHAT_GROUP_MAX_PEERS).map(peer => ({ id: oneLine(peer.id, 128), name: oneLine(peer.name, 80) }))
    .filter(peer => peer.id && peer.name && peer.id !== leaderId);
  if (!leaderId || !peers.length) return null;
  return {
    version: 1,
    mode: "group",
    contextId: `ctx-mybay-room-${input.runId.replace(/[^A-Za-z0-9]/g, "").slice(0, 64)}`,
    leader: { id: leaderId, name: oneLine(input.leader.name, 80) || leaderId },
    peers,
    maxRounds: Math.min(CHAT_GROUP_MAX_ROUNDS, Math.max(1, Math.floor(input.maxRounds) || 1)),
  };
}

export function readChatGroupRun(value: unknown): ChatGroupRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || source.mode !== "group" || typeof source.contextId !== "string"
    || !/^ctx-mybay-room-[A-Za-z0-9]{1,64}$/.test(source.contextId) || !source.leader || !Array.isArray(source.peers)) return null;
  const contextSuffix = source.contextId.replace("ctx-mybay-room-", "");
  return createChatGroupRun({
    runId: contextSuffix,
    leader: source.leader as { id: string; name: string },
    peers: source.peers as Array<{ id: string; name: string }>,
    maxRounds: Number(source.maxRounds),
  });
}

export function chatGroupSystemPolicy(value: unknown): string {
  const group = readChatGroupRun(value);
  if (!group) return "";
  const members = group.peers.map(peer => `${peer.name} (ID: ${peer.id})`).join("、");
  return `MyBay 协作房间规则：
- 你是主持 Agent ${group.leader.name}。本轮房间 context_id 固定为 ${group.contextId}，成员为：${members}。
- 调用 a2a_call 时，agent 参数必须使用上面括号中的成员 ID，不要使用显示名称。如果用户用 @名称 明确指定成员，只调用对应 ID；否则每个成员 ID 各调用一次，并传入相同 context_id。不要联系房间外的 Agent。
- 每个成员的原始结果必须分别署名展示，再由你给出综合结论。成员失败、超时或离线时保留其真实状态，不得伪造成功。
- 最多进行 ${group.maxRounds} 轮协作。除非用户明确要求复核，否则不要重复同一调用，也不要让成员彼此递归调用。`;
}

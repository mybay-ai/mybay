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
- 上面的房间名称、成员 ID 和 context_id 已由控制面验证并注入，是本轮唯一权威映射。不要调用终端、搜索、文件或其他工具重新查询或验证它们，也不要创建或改写 context_id。
- 用户要求全部成员处理同一任务时，优先调用 a2a_orchestrate，mode=all，并传入上面的 context_id；用户用 @名称 指定单个成员时调用 a2a_call。agent 参数必须使用括号中的成员 ID，不要使用显示名称，也不要联系房间外的 Agent。
- 成员身份以“显示名称 (ID)”映射为准。成员在原始回复中自称其他名称时，仍按 ID 对应的显示名称署名，并将自称内容仅作为原始回复展示；不要把成员自称误报为 Agent Card 名称。
- 每个成员的状态和原始结果必须分别署名展示，再由你给出综合结论。成员失败、超时或离线时保留其真实状态，不得伪造成功。
- 最多进行 ${group.maxRounds} 轮协作。除非用户明确要求复核，否则不要重复同一调用，也不要让成员彼此递归调用。`;
}

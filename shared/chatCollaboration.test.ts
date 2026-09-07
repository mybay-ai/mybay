import { describe, expect, it } from "vitest";
import { chatGroupSystemPolicy, createChatGroupRun, readChatGroupConfig, readChatGroupRun, selectChatGroupPeers } from "./chatCollaboration";

describe("chat collaboration contracts", () => {
  it('snapshots explicit mentions and preserves the selection when reading a saved run', () => {
    const peers = [{ id: 'research', name: '研究' }, { id: 'review', name: '研究复核' }];
    expect(selectChatGroupPeers('@研究复核 请检查', peers)).toEqual(['review']);
    expect(selectChatGroupPeers('请大家协作', peers)).toEqual(['research', 'review']);
    const run = createChatGroupRun({ runId: 'selected', leader: { id: 'host', name: 'Host' }, peers, maxRounds: 2, selectedPeerIds: ['review'] });
    expect(readChatGroupRun(run)?.selectedPeerIds).toEqual(['review']);
    expect(chatGroupSystemPolicy(run)).not.toContain('(ID: research)');
  });
  it("normalizes a bounded group configuration", () => {
    expect(readChatGroupConfig({ mode: "group", peerIds: ["peer-1", "peer-1", "peer-2"], maxRounds: 9 }))
      .toEqual({ mode: "group", peerIds: ["peer-1", "peer-2"], maxRounds: 3 });
    expect(readChatGroupConfig({ mode: "group", peerIds: [] })).toBeNull();
  });

  it("creates a stable per-run context and an attributed group policy", () => {
    const run = createChatGroupRun({ runId: "run-123", leader: { id: "lead", name: "主持" }, peers: [{ id: "peer", name: "研究" }], maxRounds: 1 });
    expect(run?.contextId).toBe("ctx-mybay-room-run123");
    const policy = chatGroupSystemPolicy(run);
    expect(policy).toContain("研究 (ID: peer)");
    expect(policy).toContain("a2a_orchestrate，mode=all");
    expect(policy).toContain("本轮唯一权威映射");
    expect(policy).toContain("不要创建或改写 context_id");
    expect(policy).toContain("agent 参数必须使用括号中的成员 ID");
    expect(policy).toContain("成员身份以“显示名称 (ID)”映射为准");
    expect(policy).toContain("不要把成员自称误报为 Agent Card 名称");
    expect(policy).toContain("状态和原始结果必须分别署名展示");
    expect(policy).toContain("最多进行 1 轮");
  });
});

import { describe, expect, it } from "vitest";
import { chatGroupSystemPolicy, createChatGroupRun, readChatGroupConfig } from "./chatCollaboration";

describe("chat collaboration contracts", () => {
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
    expect(policy).toContain("agent 参数必须使用上面括号中的成员 ID");
    expect(policy).toContain("分别署名展示");
    expect(policy).toContain("最多进行 1 轮");
  });
});

import { describe, expect, it } from "vitest";

import type { ChatGroupRun } from "../../../shared/chatCollaboration";
import { buildA2ATaskRecordUrl } from "../../constants/routes";
import { extractGroupActivityFiles, formatGroupDuration, groupPollAttemptLimit, shouldPollGroupActivities, type GroupRunActivity } from "./ChatGroupRunSummary";

const group = { contextId: "ctx-room", peers: [{ id: "peer-a", name: "A" }, { id: "peer-b", name: "B" }] } as ChatGroupRun;
const activity = (peerId: string, status: string): GroupRunActivity => ({ contextId: group.contextId, taskId: `task-${peerId}`, peerId, peerName: peerId, status });

describe("ChatGroupRunSummary helpers", () => {
  it("polls until every configured peer reaches a terminal state", () => {
    expect(shouldPollGroupActivities(group, [activity("peer-a", "completed")])).toBe(true);
    expect(shouldPollGroupActivities(group, [activity("peer-a", "completed"), activity("peer-b", "in_progress")])).toBe(true);
    expect(shouldPollGroupActivities(group, [activity("peer-a", "completed"), activity("peer-b", "auth_failed")])).toBe(false);
    expect(shouldPollGroupActivities(group, [activity("peer-a", "completed"), activity("peer-b", "completed"), activity("peer-b", "in_progress")])).toBe(false);
  });

  it("formats durations for the active locale", () => {
    expect(formatGroupDuration(37_000, "zh-CN", "进行中")).toBe("37秒");
    expect(formatGroupDuration(90_000, "en", "In progress")).toBe("1.5m");
    expect(formatGroupDuration(null, "zh-CN", "进行中")).toBe("进行中");
  });

  it("builds a deep link to the exact instance and A2A task", () => {
    expect(buildA2ATaskRecordUrl("instance/1", "task 1")).toBe("/app/instances?id=instance%2F1&tab=collaboration#a2a-activity-task%201");
  });

  it("extracts bounded safe files from a collaboration member result", () => {
    expect(extractGroupActivityFiles("Created /opt/data/workspace/report.txt and /etc/passwd; repeated workspace/report.txt"))
      .toEqual([{ path: "workspace/report.txt", name: "report.txt" }]);
    expect(extractGroupActivityFiles("工作区根目录即 `/opt/data/workspace`（无嵌套），文件 `/opt/data/workspace/final.txt`"))
      .toEqual([{ path: "workspace/final.txt", name: "final.txt" }]);
  });

  it("allows a short evidence grace period after the host run becomes terminal", () => {
    expect(groupPollAttemptLimit(false)).toBe(60);
    expect(groupPollAttemptLimit(true)).toBe(5);
  });
});

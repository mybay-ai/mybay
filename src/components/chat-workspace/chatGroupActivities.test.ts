import { expect, it } from "vitest";
import { groupMemberCalls } from "./chatGroupActivities";

it("keeps the latest failed call ahead of earlier success without losing either attempt or mixing rooms", () => {
  const older = { contextId: "room", peerId: "peer", taskId: "old", peerName: "Member", status: "completed", result: "old success", startedAt: "2026-09-07T01:00:00Z" };
  const latest = { ...older, taskId: "latest", status: "failed", result: null, startedAt: "2026-09-07T02:00:00Z" };
  const rows = [older, { ...latest, contextId: "other" }, latest, { ...latest, peerId: "other" }];
  expect(groupMemberCalls(rows, "room", "peer")).toEqual([latest, older]);
  expect(rows[0]).toBe(older);
});

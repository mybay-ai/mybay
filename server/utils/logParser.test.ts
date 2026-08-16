import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ events: [] as any[] }));

vi.mock("../db", () => ({
  dbAdapter: {
    getChannelAuthEventsByInstance: vi.fn(async (instanceId: string) =>
      store.events.filter((event) => event.instance_id === instanceId).map((event) => ({ ...event }))
    ),
    getChannelAuthEventById: vi.fn(async (id: string) => store.events.find((event) => event.id === id) || null),
    upsertChannelAuthEvent: vi.fn(async (event: any) => {
      const index = store.events.findIndex((candidate) => candidate.id === event.id);
      if (index >= 0) store.events[index] = { ...store.events[index], ...event };
      else store.events.push({ ...event });
      return { ...event };
    }),
    updateChannelAuthEventStatus: vi.fn(async (id: string, status: string, approvedBy?: string) => {
      const event = store.events.find((candidate) => candidate.id === id);
      if (!event) return null;
      Object.assign(event, { status, approved_by: approvedBy });
      return { ...event };
    }),
    deleteChannelAuthEventsByIds: vi.fn(async (ids: string[]) => {
      const idSet = new Set(ids);
      const before = store.events.length;
      store.events = store.events.filter((event) => !idSet.has(event.id));
      return { changes: before - store.events.length };
    }),
    deleteChannelAuthEventsForInstance: vi.fn(async (instanceId: string) => {
      store.events = store.events.filter((event) => event.instance_id !== instanceId);
    }),
  },
}));

import { channelAuthEventsRepo, normalizeChannelAuthPlatform } from "../repositories/channelAuthEventsRepo";
import { scanLogsForAuthEvents } from "./logParser";

describe("channel authorization event pipeline", () => {
  beforeEach(() => {
    store.events = [];
    vi.clearAllMocks();
  });

  it.each([
    ["lark", "feishu"],
    ["wechat", "weixin"],
    ["wechat_work", "wecom"],
    ["qqbot", "qq_bot"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeChannelAuthPlatform(input)).toBe(expected);
  });

  it("captures Telegram, Feishu/Lark and Weixin as pending events without duplicates", async () => {
    const logs = [
      "WARNING gateway.run: Unauthorized user: 915241554 (Will Jo) on telegram",
      "WARNING gateway.run: Unauthorized user: ou_12345678 (Feishu User) on lark",
      "WARNING gateway.run: Unauthorized user: wxid_alice (Weixin User) on weixin",
    ].join("\n");

    const firstCapture = await scanLogsForAuthEvents("instance-1", logs);
    const repeatedCapture = await scanLogsForAuthEvents("instance-1", logs);

    expect(firstCapture.map((event) => event.platform)).toEqual(["telegram", "feishu", "weixin"]);
    expect(repeatedCapture).toEqual([]);

    const events = await channelAuthEventsRepo.listByInstance("instance-1");
    expect(events).toHaveLength(3);
    expect(events.map((event) => ({ platform: event.platform, user: event.external_user_id, status: event.status })))
      .toEqual(expect.arrayContaining([
        { platform: "telegram", user: "915241554", status: "pending" },
        { platform: "feishu", user: "ou_12345678", status: "pending" },
        { platform: "weixin", user: "wxid_alice", status: "pending" },
      ]));
  });

  it("repairs legacy missing statuses and consolidates duplicate events", async () => {
    store.events = [
      {
        id: "legacy-1",
        instance_id: "instance-1",
        platform: "telegram",
        external_user_id: "915241554",
        raw_payload: { log_line: "first" },
        created_at: "2026-08-14T10:00:00.000Z",
        updated_at: "2026-08-14T10:00:00.000Z",
      },
      {
        id: "legacy-2",
        instance_id: "instance-1",
        platform: "telegram",
        external_user_id: "915241554",
        raw_payload: { log_line: "latest" },
        created_at: "2026-08-14T10:01:00.000Z",
        updated_at: "2026-08-14T10:01:00.000Z",
      },
    ];

    const events = await channelAuthEventsRepo.listByInstance("instance-1");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("pending");
    expect(events[0].raw_payload).toEqual({ log_line: "latest" });
    expect(store.events).toHaveLength(1);
  });

  it("keeps an approved sender approved when the same unauthorized log is scanned again", async () => {
    const approved = await channelAuthEventsRepo.upsert({
      instance_id: "instance-1",
      platform: "feishu",
      external_user_id: "ou_approved01",
      external_chat_id: null,
      external_channel_id: null,
      external_group_id: null,
      display_name: "Approved User",
      raw_payload: {},
    });
    await channelAuthEventsRepo.updateStatus(approved.id, "approved", "admin");

    await scanLogsForAuthEvents("instance-1", "Unauthorized user: ou_approved01 on feishu");

    const events = await channelAuthEventsRepo.listByInstance("instance-1");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("approved");
  });
});

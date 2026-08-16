import { dbAdapter } from "../db";
import crypto from "crypto";

export interface ChannelAuthEvent {
  id: string;
  instance_id: string;
  platform: string;
  external_user_id: string | null;
  external_chat_id: string | null;
  external_channel_id: string | null;
  external_group_id: string | null;
  display_name: string | null;
  raw_payload: any;
  status: 'pending' | 'approved' | 'ignored';
  first_seen_at: string;
  last_seen_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES = new Set<ChannelAuthEvent["status"]>(["pending", "approved", "ignored"]);

export function normalizeChannelAuthPlatform(value: unknown): string {
  const platform = String(value || "").trim().toLowerCase().replace(/[\])},.;:]+$/g, "");
  if (platform === "lark") return "feishu";
  if (platform === "wechat" || platform === "wx") return "weixin";
  if (platform === "wechat_work" || platform === "enterprise_wechat") return "wecom";
  if (platform === "qq" || platform === "qqbot") return "qq_bot";
  return platform;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function eventSubjectKey(event: Partial<ChannelAuthEvent>): string {
  const platform = normalizeChannelAuthPlatform(event.platform);
  const userId = normalizeId(event.external_user_id);
  const chatId = normalizeId(event.external_chat_id);
  const channelId = normalizeId(event.external_channel_id);
  const groupId = normalizeId(event.external_group_id);
  if (userId) return `${platform}:user:${userId}`;
  if (chatId) return `${platform}:chat:${chatId}`;
  if (channelId) return `${platform}:channel:${channelId}`;
  return `${platform}:group:${groupId || "unknown"}`;
}

function statusPriority(status: unknown): number {
  if (status === "approved") return 3;
  if (status === "ignored") return 2;
  if (status === "pending") return 1;
  return 0;
}

function normalizeStoredEvent(event: any, now: string): ChannelAuthEvent {
  const createdAt = event.created_at || event.first_seen_at || now;
  const updatedAt = event.updated_at || event.last_seen_at || createdAt;
  return {
    ...event,
    platform: normalizeChannelAuthPlatform(event.platform),
    external_user_id: normalizeId(event.external_user_id),
    external_chat_id: normalizeId(event.external_chat_id),
    external_channel_id: normalizeId(event.external_channel_id),
    external_group_id: normalizeId(event.external_group_id),
    status: VALID_STATUSES.has(event.status) ? event.status : "pending",
    first_seen_at: event.first_seen_at || createdAt,
    last_seen_at: event.last_seen_at || updatedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function needsRepair(raw: any, normalized: ChannelAuthEvent, duplicateCount: number): boolean {
  return duplicateCount > 0 ||
    raw.platform !== normalized.platform || raw.status !== normalized.status ||
    raw.external_user_id !== normalized.external_user_id || raw.external_chat_id !== normalized.external_chat_id ||
    raw.external_channel_id !== normalized.external_channel_id || raw.external_group_id !== normalized.external_group_id ||
    raw.display_name !== normalized.display_name ||
    raw.first_seen_at !== normalized.first_seen_at || raw.last_seen_at !== normalized.last_seen_at ||
    raw.created_at !== normalized.created_at || raw.updated_at !== normalized.updated_at ||
    JSON.stringify(raw.raw_payload ?? null) !== JSON.stringify(normalized.raw_payload ?? null);
}

async function consolidateInstanceEvents(instanceId: string): Promise<ChannelAuthEvent[]> {
  const now = new Date().toISOString();
  const stored = await dbAdapter.getChannelAuthEventsByInstance(instanceId);
  const rawById = new Map(stored.map((event: any) => [event.id, event]));
  const groups = new Map<string, ChannelAuthEvent[]>();
  for (const rawEvent of stored) {
    const event = normalizeStoredEvent(rawEvent, now);
    const key = eventSubjectKey(event);
    groups.set(key, [...(groups.get(key) || []), event]);
  }

  const consolidated: ChannelAuthEvent[] = [];
  const duplicateIds: string[] = [];
  for (const events of groups.values()) {
    events.sort((a, b) => statusPriority(b.status) - statusPriority(a.status) || String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
    const canonical = events[0];
    const oldest = events.slice().sort((a, b) => String(a.first_seen_at).localeCompare(String(b.first_seen_at)))[0];
    const newest = events.slice().sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)))[0];
    const merged: ChannelAuthEvent = {
      ...canonical,
      external_user_id: canonical.external_user_id || newest.external_user_id,
      external_chat_id: canonical.external_chat_id || newest.external_chat_id,
      external_channel_id: canonical.external_channel_id || newest.external_channel_id,
      external_group_id: canonical.external_group_id || newest.external_group_id,
      display_name: newest.display_name || canonical.display_name,
      raw_payload: newest.raw_payload || canonical.raw_payload,
      first_seen_at: oldest.first_seen_at,
      last_seen_at: newest.last_seen_at,
      created_at: oldest.created_at,
      updated_at: newest.updated_at,
    };
    const rawCanonical = rawById.get(canonical.id);
    consolidated.push(needsRepair(rawCanonical, merged, events.length - 1)
      ? await dbAdapter.upsertChannelAuthEvent(merged) as ChannelAuthEvent
      : merged);
    duplicateIds.push(...events.slice(1).map((event) => event.id));
  }
  if (duplicateIds.length > 0) await dbAdapter.deleteChannelAuthEventsByIds(duplicateIds);
  return consolidated;
}

type NewChannelAuthEvent = Omit<ChannelAuthEvent, "id" | "status" | "first_seen_at" | "last_seen_at" | "created_at" | "updated_at">;

async function upsertWithResult(event: NewChannelAuthEvent): Promise<{ event: ChannelAuthEvent; created: boolean }> {
    const now = new Date().toISOString();
    const normalizedEvent = {
      ...event,
      platform: normalizeChannelAuthPlatform(event.platform),
      external_user_id: normalizeId(event.external_user_id),
      external_chat_id: normalizeId(event.external_chat_id),
      external_channel_id: normalizeId(event.external_channel_id),
      external_group_id: normalizeId(event.external_group_id),
    };
    const existing = (await consolidateInstanceEvents(event.instance_id)).find((candidate) =>
      eventSubjectKey(candidate) === eventSubjectKey(normalizedEvent)
    );

    if (existing) {
      const updated = await dbAdapter.upsertChannelAuthEvent({
        ...existing,
        status: VALID_STATUSES.has(existing.status) ? existing.status : "pending",
        last_seen_at: now,
        display_name: normalizedEvent.display_name || existing.display_name,
        raw_payload: normalizedEvent.raw_payload || existing.raw_payload,
        external_user_id: normalizedEvent.external_user_id || existing.external_user_id,
        external_chat_id: normalizedEvent.external_chat_id || existing.external_chat_id,
        external_channel_id: normalizedEvent.external_channel_id || existing.external_channel_id,
        external_group_id: normalizedEvent.external_group_id || existing.external_group_id,
        updated_at: now
      }) as ChannelAuthEvent;
      return { event: updated, created: false };
    }

    const created = await dbAdapter.upsertChannelAuthEvent({
      id: crypto.randomUUID(),
      instance_id: normalizedEvent.instance_id,
      platform: normalizedEvent.platform,
      external_user_id: normalizedEvent.external_user_id,
      external_chat_id: normalizedEvent.external_chat_id,
      external_channel_id: normalizedEvent.external_channel_id,
      external_group_id: normalizedEvent.external_group_id,
      display_name: normalizedEvent.display_name,
      raw_payload: normalizedEvent.raw_payload,
      status: 'pending',
      first_seen_at: now,
      last_seen_at: now,
      created_at: now,
      updated_at: now
    }) as ChannelAuthEvent;
    return { event: created, created: true };
}

export const channelAuthEventsRepo = {
  async upsert(event: NewChannelAuthEvent): Promise<ChannelAuthEvent> {
    return (await upsertWithResult(event)).event;
  },

  async upsertWithResult(event: NewChannelAuthEvent): Promise<{ event: ChannelAuthEvent; created: boolean }> {
    return upsertWithResult(event);
  },

  async listByInstance(instanceId: string): Promise<ChannelAuthEvent[]> {
    const events = await consolidateInstanceEvents(instanceId);
    return events.slice().sort((a: any, b: any) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime());
  },

  async getById(id: string): Promise<ChannelAuthEvent | null> {
    return dbAdapter.getChannelAuthEventById(id) as Promise<ChannelAuthEvent | null>;
  },

  async updateStatus(id: string, status: 'approved' | 'ignored' | 'pending', approvedBy?: string): Promise<ChannelAuthEvent | null> {
    return dbAdapter.updateChannelAuthEventStatus(id, status, approvedBy) as Promise<ChannelAuthEvent | null>;
  },

  async deleteByInstance(instanceId: string): Promise<void> {
    await dbAdapter.deleteChannelAuthEventsForInstance(instanceId);
  }
};

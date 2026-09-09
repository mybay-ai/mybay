import { describe, expect, it } from "vitest";
import { parseFeishuInbound, type FeishuBinding } from "./feishuInbound";

const binding: FeishuBinding = { instanceId: "pi-test", ownerId: "owner", appId: "cli_test", botOpenId: "ou_bot", allowedUsers: ["ou_user", "ou_other"], allowedChats: ["oc_group"] };
function event(overrides: Record<string, unknown> = {}) {
  return { sender: { sender_type: "user", sender_id: { open_id: "ou_user" } }, message: { message_id: "om_one", chat_id: "oc_group", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "hello" }), ...overrides } };
}

describe("Feishu managed Runtime inbound boundary", () => {
  it("keeps replay identity stable and separates apps", () => {
    const first = parseFeishuInbound(binding, event())!;
    expect(first.text).toBe("hello");
    expect(parseFeishuInbound(binding, event())?.id).toBe(first.id);
    expect(parseFeishuInbound({ ...binding, appId: "cli_other" }, event())?.id).not.toBe(first.id);
  });
  it("requires a user allowlist and rejects bot senders", () => {
    expect(parseFeishuInbound({ ...binding, allowedUsers: [] }, event())).toBeNull();
    expect(parseFeishuInbound(binding, { ...event(), sender: { sender_type: "app", sender_id: { open_id: "ou_user" } } })).toBeNull();
  });
  it("requires both an allowed group and an exact bot mention", () => {
    expect(parseFeishuInbound(binding, event({ chat_type: "group" }))).toBeNull();
    const group = event({ chat_type: "group", mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }], content: JSON.stringify({ text: "@_user_1 hello" }) });
    expect(parseFeishuInbound(binding, group)?.text).toBe("hello");
    expect(parseFeishuInbound({ ...binding, allowedChats: [] }, group)).toBeNull();
    expect(parseFeishuInbound(binding, event({ chat_type: "group", mentions: [{ key: "@_user_1", id: { open_id: "ou_someone" } }] }))).toBeNull();
  });
  it("isolates senders, owners and Runtime instances within one chat", () => {
    const key = parseFeishuInbound(binding, event())?.conversationKey;
    expect(parseFeishuInbound(binding, { ...event(), sender: { sender_type: "user", sender_id: { open_id: "ou_other" } } })?.conversationKey).not.toBe(key);
    expect(parseFeishuInbound({ ...binding, instanceId: "codex-test" }, event())?.conversationKey).not.toBe(key);
    expect(parseFeishuInbound({ ...binding, ownerId: "other-owner" }, event())?.conversationKey).not.toBe(key);
  });
  it("ignores malformed, non-text, empty and oversized payloads", () => {
    for (const input of [null, {}, event({ content: "{" }), event({ content: "null" }), event({ message_type: "image" }), event({ content: JSON.stringify({ text: " " }) }), event({ content: "x".repeat(128 * 1024 + 1) }), event({ message_id: "../escape" })]) expect(parseFeishuInbound(binding, input)).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { closeLocalDatabase, mutateStoreCollections, readStoreCollections } from "../localStore";
import { parseFeishuInbound, type FeishuBinding } from "../services/channels/feishuInbound";
import { channelMessagesRepo } from "./channelMessagesRepo";

const binding: FeishuBinding = { instanceId: "pi", ownerId: "owner", appId: "cli_test", botOpenId: "ou_bot", allowedUsers: ["ou_user"], allowedChats: [] };
const message = parseFeishuInbound(binding, { sender: { sender_type: "user", sender_id: { open_id: "ou_user" } }, message: { message_id: "om_one", chat_id: "oc_one", chat_type: "p2p", message_type: "text", content: '{"text":"hello"}' } })!;

beforeEach(() => mutateStoreCollections(["channelMessages", "conversations", "instances"], data => {
  data.channelMessages = [];
  data.conversations = [];
  data.instances = [{ id: "pi", user_id: "owner", runtime_type: "pi" }];
}));

describe("durable Feishu inbox", () => {
  it("persists replay identity and conversation across database reopen", () => {
    const first = channelMessagesRepo.receive(message);
    closeLocalDatabase();
    const replay = channelMessagesRepo.receive(message);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect(readStoreCollections(["conversations"]).conversations).toHaveLength(1);
    expect(channelMessagesRepo.pending("pi")).toHaveLength(1);
  });
  it("reuses a sender conversation for another message", () => {
    const first = channelMessagesRepo.receive(message);
    const second = channelMessagesRepo.receive({ ...message, id: "second", messageId: "om_two" });
    expect(second.receipt.conversationId).toBe(first.receipt.conversationId);
  });
  it("rejects mutated replay and changed ownership", () => {
    channelMessagesRepo.receive(message);
    expect(() => channelMessagesRepo.receive({ ...message, text: "changed" })).toThrow("CHANNEL_MESSAGE_CONFLICT");
    mutateStoreCollections(["instances"], data => { data.instances[0].user_id = "other"; });
    expect(() => channelMessagesRepo.receive(message)).toThrow("CHANNEL_INSTANCE_UNAVAILABLE");
  });
  it("bounds the pending inbox without losing exact retries", () => {
    for (let index = 0; index < 100; index++) channelMessagesRepo.receive({ ...message, id: String(index), messageId: `om_${index}` });
    expect(() => channelMessagesRepo.receive(message)).toThrow("CHANNEL_QUEUE_FULL");
    expect(channelMessagesRepo.receive({ ...message, id: "0", messageId: "om_0" }).replayed).toBe(true);
  });
});

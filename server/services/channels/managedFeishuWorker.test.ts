import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./feishuTransport", () => ({ FeishuTransport: class {} }));
vi.mock("../../crypto", () => ({ decrypt: (value: string) => value }));
vi.mock("../runsReconciler", () => ({ requestRunsReconcile: vi.fn() }));
vi.mock("./managedChannelRuns", () => ({ submitManagedChannelMessage: vi.fn() }));
import { processManagedFeishuMessage } from "./managedFeishuWorker";
import { channelMessagesRepo } from "../../repositories/channelMessagesRepo";
import { mutateStoreCollections, readStoreCollections, closeLocalDatabase } from "../../localStore";
import { parseFeishuInbound } from "./feishuInbound";
import { submitManagedChannelMessage } from "./managedChannelRuns";

const incoming = parseFeishuInbound({ instanceId: "pi", ownerId: "owner", appId: "cli_test", botOpenId: "ou_bot", allowedUsers: ["ou_user"], allowedChats: [] }, {
  sender: { sender_type: "user", sender_id: { open_id: "ou_user" } }, message: { message_id: "om_one", chat_id: "oc_one", chat_type: "p2p", message_type: "text", content: '{"text":"hello"}' },
})!;
beforeEach(() => {
  vi.clearAllMocks();
  mutateStoreCollections(["instances", "channelMessages", "conversations", "chatRuns"], data => {
    data.instances = [{ id: "pi", runtime_type: "pi", user_id: "owner" }];
    data.channelMessages = []; data.conversations = []; data.chatRuns = [];
  });
});
const current = () => channelMessagesRepo.pending("pi")[0];

describe("managed Feishu delivery and cancellation", () => {
  it("dispatches accepted text through the shared run submission boundary", async () => {
    const { receipt } = channelMessagesRepo.receive(incoming);
    await processManagedFeishuMessage(receipt, { reply: vi.fn() });
    expect(submitManagedChannelMessage).toHaveBeenCalledWith(receipt);
  });
  it("persists final replies and retries the same UUID after a failed send and restart", async () => {
    const { receipt } = channelMessagesRepo.receive(incoming);
    channelMessagesRepo.update(receipt.id, { runId: "run", status: "submitted" });
    mutateStoreCollections(["chatRuns"], data => { data.chatRuns.push({ id: "run", conversation_id: receipt.conversationId, user_id: "owner", instance_id: "pi", status: "completed", partial_output: "done" }); });
    const reply = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    await processManagedFeishuMessage(current(), { reply });
    const uuid = current().replies![0].id;
    await expect(processManagedFeishuMessage(current(), { reply })).rejects.toThrow("network");
    closeLocalDatabase();
    await processManagedFeishuMessage(current(), { reply });
    expect(reply).toHaveBeenLastCalledWith("om_one", "done", uuid);
    await processManagedFeishuMessage(current(), { reply });
    expect(channelMessagesRepo.pending("pi")).toHaveLength(0);
    expect(submitManagedChannelMessage).not.toHaveBeenCalled();
  });
  it("only stops the sender's mapped conversation and retains the exact target", async () => {
    const { receipt } = channelMessagesRepo.receive({ ...incoming, text: "/stop" });
    mutateStoreCollections(["chatRuns"], data => {
      data.chatRuns.push({ id: "foreign", conversation_id: "another", user_id: "owner", instance_id: "pi", status: "running" });
      data.chatRuns.push({ id: "mine", conversation_id: receipt.conversationId, user_id: "owner", instance_id: "pi", status: "running" });
    });
    await processManagedFeishuMessage(receipt, { reply: vi.fn() });
    expect(current().runId).toBe("mine");
    const runs = readStoreCollections(["chatRuns"]).chatRuns;
    expect(runs.find(row => row.id === "mine").status).toBe("stopping");
    expect(runs.find(row => row.id === "foreign").status).toBe("running");
  });
  it("chunks Unicode output without losing or splitting characters", async () => {
    const { receipt } = channelMessagesRepo.receive(incoming);
    channelMessagesRepo.update(receipt.id, { status: "submitted", runId: "run" });
    const output = "🙂".repeat(2100);
    mutateStoreCollections(["chatRuns"], data => { data.chatRuns.push({ id: "run", conversation_id: receipt.conversationId, user_id: "owner", instance_id: "pi", status: "completed", partial_output: output }); });
    await processManagedFeishuMessage(current(), { reply: vi.fn() });
    expect(current().replies!.map(reply => reply.text).join("")).toBe(output);
    expect(current().replies).toHaveLength(2);
  });
});

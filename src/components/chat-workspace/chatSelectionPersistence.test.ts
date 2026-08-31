import { describe, expect, it, vi } from "vitest";
import { createChatSelectionPersistence, resolveRememberedConversation } from "./chatSelectionPersistence";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
describe("chat selection persistence", () => {
  it("restores each instance's conversation across remounts without saving content", () => {
    const db = storage();
    const first = createChatSelectionPersistence(() => db, "user-a");
    first.rememberConversation("agent-a", "conversation-a");
    first.rememberInstance("agent-b");
    expect(first.conversationFor("agent-a")).toBe("conversation-a");
    first.rememberConversation("agent-b", "conversation-b");
    const restored = createChatSelectionPersistence(() => db, "user-a");
    expect(restored.read().instanceId).toBe("agent-b");
    expect(restored.conversationFor("agent-b")).toBe("conversation-b");
    expect(restored.conversationFor("agent-a")).toBe("conversation-a");
    expect(Object.keys(restored.read())).toEqual(["version", "instanceId", "conversations"]);
  });
  it("isolates users and ignores anonymous persistence", () => {
    const db = storage();
    createChatSelectionPersistence(() => db, "alice").rememberConversation("agent-a", "private-conversation");
    expect(createChatSelectionPersistence(() => db, "bob").read().instanceId).toBe("");
    createChatSelectionPersistence(() => db, undefined).rememberInstance("agent-b");
    expect(db.values.size).toBe(1);
  });
  it("clears a deleted choice without clearing other instance choices", () => {
    const db = storage(); const selected = createChatSelectionPersistence(() => db, "user");
    selected.rememberConversation("a", "one"); selected.rememberConversation("b", "two");
    selected.rememberConversation("a", null);
    expect(selected.conversationFor("a")).toBeNull();
    expect(selected.conversationFor("b")).toBe("two");
  });
  it.each(["invalid json", "null", '{"version":9,"conversations":{}}', '{"version":1,"conversations":[]}'])("ignores malformed storage: %s", raw => {
    const db = storage(); const selected = createChatSelectionPersistence(() => db, "user");
    selected.rememberInstance("a"); const key = [...db.values.keys()][0]; db.setItem(key, raw);
    expect(selected.read()).toEqual({ version: 1, instanceId: "", conversations: {} });
  });
  it("tolerates blocked storage and filters invalid or prototype ids", () => {
    const unavailable = createChatSelectionPersistence(() => { throw new Error("disabled"); }, "user");
    expect(() => unavailable.rememberConversation("a", "one")).not.toThrow();
    expect(unavailable.read().instanceId).toBe("");
    const db=storage(), selected=createChatSelectionPersistence(()=>db,"user");
    selected.rememberConversation("__proto__", "invalid");
    selected.rememberConversation("a", "../private");
    expect(db.values.size).toBe(0);
  });
  it("bounds remembered instance count", () => {
    const db=storage(), selected=createChatSelectionPersistence(()=>db,"user");
    for(let i=0;i<80;i++) selected.rememberConversation(`a-${i}`,`c-${i}`);
    expect(Object.keys(selected.read().conversations)).toHaveLength(64);
    expect(selected.conversationFor("a-79")).toBe("c-79");
  });
});

describe("authorized conversation restoration", () => {
  const list=[{id:"newest"},{id:"second"}];
  it("keeps a remembered non-first conversation without extra lookup", async () => {
    const detail=vi.fn();
    expect((await resolveRememberedConversation(list,"second",detail)).selectedId).toBe("second");
    expect(detail).not.toHaveBeenCalled();
  });
  it("resolves a remembered conversation outside the first page through authorized detail", async () => {
    const result=await resolveRememberedConversation(list,"older",async()=>({id:"older"}));
    expect(result.selectedId).toBe("older");
    expect(result.list.map(c=>c.id)).toEqual(["newest","second","older"]);
  });
  it.each([400,403,404,410])("falls back after invalid/deleted/inaccessible saved selection (%s)", async status => {
    expect((await resolveRememberedConversation(list,"deleted",async()=>{throw {status};})).selectedId).toBe("newest");
  });
  it("does not erase a saved choice after transient failure or cancellation", async () => {
    const failure={status:503};
    await expect(resolveRememberedConversation(list,"older",async()=>{throw failure;})).rejects.toBe(failure);
    const abort=new DOMException("aborted","AbortError");
    await expect(resolveRememberedConversation(list,"older",async()=>{throw abort;})).rejects.toBe(abort);
  });
  it("rejects a mismatched detail record and safely handles an empty list", async () => {
    expect((await resolveRememberedConversation(list,"older",async()=>({id:"wrong"}))).selectedId).toBe("newest");
    expect((await resolveRememberedConversation([],null,vi.fn())).selectedId).toBeNull();
  });
});

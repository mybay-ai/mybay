import { describe, expect, it } from "vitest";
import { placeConversation } from "./localConversationPlacement";

describe("conversation placement", () => {
  const rows = [{ id: "a" }, { id: "p", project_id: "project" }, { id: "b" }, { id: "c" }];
  it("preserves unrelated rows and input objects when moving before or after a sibling", () => {
    const move = { conversationId: "c", targetId: "a", section: { kind: "recent" as const }, position: "after" as const };
    expect(placeConversation(rows, ["project"], move, "now").map(c => c.id)).toEqual(["a", "c", "p", "b"]);
    expect(placeConversation(rows, ["project"], { ...move, position: "before" }, "now").map(c => c.id)).toEqual(["c", "a", "p", "b"]);
    expect(rows[3]).toEqual({ id: "c" });
  });
  it("is idempotent when retrying the same relative drop", () => {
    const move = { conversationId: "a", targetId: "c", section: { kind: "recent" as const }, position: "after" as const };
    const once = placeConversation(rows, ["project"], move, "now");
    expect(placeConversation(once, ["project"], move, "later")).toEqual(once);
  });
  it("rejects a self-drop or missing source/target", () => {
    for (const [conversationId, targetId] of [["a", "a"], ["missing", "a"], ["a", "missing"]]) {
      expect(() => placeConversation(rows, ["project"], { conversationId, targetId, section: { kind: "recent" }, position: "before" }, "now")).toThrow();
    }
  });
});

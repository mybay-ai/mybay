import { describe, expect, it } from "vitest";
import { insertLongText, longTextTitle, serializeLongTextDraft, shouldCollapsePastedText, unfoldLongText, type ComposerDraft } from "./composerLongText";

const initial = (): ComposerDraft => ({ blocks: [], input: "before[replace]after" });
const serialize = (draft: ComposerDraft) => serializeLongTextDraft(draft.blocks, draft.input);

describe("long-text presentation without changing the message contract", () => {
  it("folds at 1500 Unicode characters or 20 lines, not UTF-16 units", () => {
    expect(shouldCollapsePastedText("🙂".repeat(1499))).toBe(false);
    expect(shouldCollapsePastedText("🙂".repeat(1500))).toBe(true);
    for (const newline of ["\n", "\r\n", "\r"]) {
      expect(shouldCollapsePastedText(Array(19).fill("line").join(newline))).toBe(false);
      expect(shouldCollapsePastedText(Array(20).fill("line").join(newline))).toBe(true);
    }
    expect(shouldCollapsePastedText("")).toBe(false);
  });

  it("replaces the selection while retaining both surrounding instructions", () => {
    const draft = insertLongText(initial(), "MATERIAL", 6, 15, "a");
    expect(draft).toEqual({ blocks: [{ id: "a", leadingText: "before", content: "MATERIAL" }], input: "after" });
    expect(serialize(draft)).toBe("beforeMATERIALafter");
  });

  it("preserves exact whitespace, code, Unicode, and multiple card ordering", () => {
    let draft = insertLongText({ blocks: [], input: "instruction\n\nend" }, "```ts\r\n🙂\r\n```", 12, 12, "a");
    draft = insertLongText(draft, "\nnext\n", 0, 0, "b");
    expect(serialize(draft)).toBe("instruction\n```ts\r\n🙂\r\n```\nnext\n\nend");
  });

  it("can insert a material before an existing card", () => {
    let draft = insertLongText(initial(), "A", 6, 15, "a");
    draft = insertLongText(draft, "B", 3, 3, "b", "a");
    expect(draft.blocks.map(block => block.id)).toEqual(["b", "a"]);
    expect(serialize(draft)).toBe("befBoreAafter");
  });

  it("removes only the selected card and keeps all surrounding instructions", () => {
    let draft = insertLongText(initial(), "A", 6, 15, "a");
    draft = insertLongText(draft, "B", 2, 2, "b");
    expect(serialize(unfoldLongText(draft, "a", true))).toBe("beforeafBter");
    expect(serialize(unfoldLongText(draft, "b", true))).toBe("beforeAafter");
    expect(serialize(unfoldLongText(unfoldLongText(draft, "a", true), "b", true))).toBe("beforeafter");
  });

  it("unfolds either middle or last card losslessly, including live edits", () => {
    let draft = insertLongText(initial(), "A", 6, 15, "a");
    draft = insertLongText(draft, "B", 1, 1, "b");
    draft.blocks[0] = { ...draft.blocks[0], content: "edited\nA" };
    for (const id of ["a", "b"]) expect(serialize(unfoldLongText(draft, id))).toBe(serialize(draft));
    expect(serialize(unfoldLongText(unfoldLongText(draft, "a"), "b"))).toBe(serialize(draft));
  });

  it("does not mutate the previous draft or act on a stale card ID", () => {
    const original = initial();
    const folded = insertLongText(original, "A", 6, 15, "a");
    const snapshot = JSON.stringify(folded);
    unfoldLongText(folded, "a");
    expect(JSON.stringify(folded)).toBe(snapshot);
    expect(original).toEqual(initial());
    expect(unfoldLongText(folded, "missing")).toBe(folded);
    expect(insertLongText(folded, "B", 0, 0, "b", "missing")).toBe(folded);
    expect(insertLongText(folded, "", 0, 0, "b")).toBe(folded);
  });

  it("produces a bounded Unicode-safe title, without changing the source", () => {
    expect(longTextTitle("\n  First line\nSecond line")).toBe("First line");
    expect(longTextTitle("🙂".repeat(49))).toBe("🙂".repeat(48) + "…");
    expect(longTextTitle("\r\n \t")).toBe("");
  });
});

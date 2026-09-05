import { describe, expect, it } from "vitest";

import { filterComposerSuggestions, findComposerTrigger, replaceComposerTrigger, type ComposerSuggestion } from "./chatComposerSuggestions";

describe("chat composer suggestions", () => {
  it("opens commands only for a single leading slash token", () => {
    expect(findComposerTrigger("/ag")).toMatchObject({ kind: "command", query: "ag", start: 0, end: 3 });
    expect(findComposerTrigger("please /ag")).toBeNull();
    expect(findComposerTrigger("/agents now")).toBeNull();
  });

  it("finds and replaces the active mention without changing the surrounding draft", () => {
    const input = "请让 @研 完成资料整理";
    const cursor = input.indexOf(" 完成");
    const trigger = findComposerTrigger(input, cursor);
    expect(trigger).toMatchObject({ kind: "mention", query: "研" });
    expect(replaceComposerTrigger(input, trigger!, "@研究Agent ").value).toBe("请让 @研究Agent 完成资料整理");
  });

  it("filters commands and peers by their visible metadata", () => {
    const items: ComposerSuggestion[] = [
      { kind: "command", id: "agents", label: "协作节点", description: "查看可信 Agent" },
      { kind: "mention", id: "writer", name: "写作 Agent", capabilities: ["文案"] },
    ];
    expect(filterComposerSuggestions(items, "可信")).toHaveLength(1);
    expect(filterComposerSuggestions(items, "文案")).toEqual([items[1]]);
  });
});

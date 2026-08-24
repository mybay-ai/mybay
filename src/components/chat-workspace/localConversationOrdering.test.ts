import { describe, expect, it } from "vitest";
import { mergePersistedOrder, moveConversationWithinSection, moveOrderedRecord, sortConversationRecords, sortProjectRecords } from "./localConversationOrdering";

describe("local conversation ordering", () => {
  const rows = [
    { id: "a", sort_order: 0, updated_at: "2026-01-01T00:00:00Z" },
    { id: "b", sort_order: 1, updated_at: "2026-01-02T00:00:00Z" },
    { id: "c", sort_order: 2, updated_at: "2026-01-03T00:00:00Z" },
  ];

  it("moves a row and assigns deterministic sort values", () => {
    expect(moveOrderedRecord(rows, "b", "up")?.map((item) => [item.id, item.sort_order])).toEqual([
      ["b", 0], ["a", 1], ["c", 2],
    ]);
    expect(moveOrderedRecord(rows, "a", "up")).toBeNull();
  });

  it("keeps pinned conversations first and uses persisted order within sections", () => {
    const sorted = sortConversationRecords([
      ...rows,
      { id: "p", sort_order: 99, pinned_at: "2026-01-04T00:00:00Z", updated_at: "2026-01-04T00:00:00Z" },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["p", "a", "b", "c"]);
  });

  it("moves conversations only inside their pin and project section", () => {
    const sectioned = [
      { id: "p", pinned_at: "now", project_id: null, sort_order: 0 },
      { id: "a", pinned_at: null, project_id: "project-1", sort_order: 1 },
      { id: "x", pinned_at: null, project_id: null, sort_order: 2 },
      { id: "b", pinned_at: null, project_id: "project-1", sort_order: 3 },
    ];
    expect(moveConversationWithinSection(sectioned, "b", "up")?.map((item) => item.id)).toEqual(["p", "b", "x", "a"]);
    expect(moveConversationWithinSection(sectioned, "a", "up")).toBeNull();
  });

  it("merges authoritative server order without adding unloaded records", () => {
    const merged = mergePersistedOrder(rows.slice(0, 2), [
      { id: "b", sort_order: 0 }, { id: "a", sort_order: 1 }, { id: "unloaded", sort_order: 2 },
    ], sortConversationRecords);
    expect(merged.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("sorts projects by their persisted order", () => {
    expect(sortProjectRecords([rows[2], rows[0], rows[1]]).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

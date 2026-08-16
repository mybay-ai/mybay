import { describe, expect, it } from "vitest";
import { retainNewestInstanceRows } from "./index";

describe("instance event retention", () => {
  it("keeps the newest rows for one instance without removing other instances", () => {
    const rows = [
      { id: "a-old", instance_id: "a", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "b", instance_id: "b", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "a-new", instance_id: "a", created_at: "2026-01-02T00:00:00.000Z" },
    ];
    expect(retainNewestInstanceRows(rows, "a", 1).map((row) => row.id)).toEqual(["b", "a-new"]);
  });
});

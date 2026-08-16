import { describe, expect, it } from "vitest";
import { filterVisibleInstances } from "./list.routes";

describe("instance list visibility", () => {
  it("hides instances only after cleanup reaches deleted", () => {
    const rows = [{ id: "running", status: "running" }, { id: "deleting", status: "deleting" }, { id: "deleted", status: "deleted" }];
    expect(filterVisibleInstances(rows).map(row => row.id)).toEqual(["running", "deleting"]);
  });

  it("keeps cleanup failures visible for remediation", () => {
    expect(filterVisibleInstances([{ id: "failed", status: "failed", desired_state: "deleted" }])).toHaveLength(1);
  });
});

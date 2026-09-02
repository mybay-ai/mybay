import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AssistantInstanceGrid.tsx", import.meta.url), "utf8");

describe("AssistantInstanceGrid presentation", () => {
  it("keeps the commercial-inspired work hierarchy without commercial-only management code", () => {
    expect(source).toContain("xl:grid-cols-3");
    expect(source).toContain("min-h-[236px]");
    expect(source).not.toContain("min-h-[292px]");
    expect(source).toContain('t("agent_view_chat")');
    expect(source).toContain('t("agent_view_files")');
    expect(source).toContain('t("btn_redeploy")');
    expect(source).toContain('handleInstanceAction(instance.id, "redeploy", true, t("confirm_redeploy"))');
    expect(source).toContain("sm:grid-cols-[minmax(0,1fr)_auto_auto]");
    expect(source).toContain('openDetails(instance.id, "diagnostics")');
    expect(source).toContain("props.bulkMode &&");
    expect(source).not.toContain("AssistantManagementSummary");
    expect(source).not.toContain("owner_id");
  });
});

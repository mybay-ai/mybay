import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AssistantInstanceGrid.tsx", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("./AgentManagementDrawer.tsx", import.meta.url), "utf8");

describe("AssistantInstanceGrid presentation", () => {
  it("keeps the Agent card focused on primary work and opens a dedicated management surface", () => {
    expect(source).toContain('t("agent_view_chat")');
    expect(source).toContain('t("agent_view_files")');
    expect(drawerSource).toContain("onRedeploy");
    expect(source).toContain('handleInstanceAction(managedInstance.id, "redeploy", true, t("confirm_redeploy"))');

    expect(source).toContain('openDetails(instance.id, "diagnostics")');
    expect(source).toContain("props.bulkMode &&");
    expect(source).toContain("AgentManagementDrawer");
    expect(source).toContain("setManagedInstanceId(instance.id)");
    expect(source).not.toContain("owner_id");
  });

  it("keeps Agent management usable as a desktop drawer and a narrow-screen full-width surface", () => {
    expect(drawerSource).toContain("h-dvh");
    expect(drawerSource).toContain("w-full max-w-2xl");
    expect(drawerSource).toContain("min-[360px]:grid-cols-2");
    expect(drawerSource).toContain("env(safe-area-inset-bottom)");
    expect(drawerSource).toContain("showModal()");
    expect(drawerSource).toContain("returnFocusRef.current?.focus()");
    expect(drawerSource).toContain('supportsRuntimeDashboard(runtimeType)');
    expect(drawerSource).toContain('t("action_export_archive_short")');
    expect(source).toContain("props.handleExportConfig(event, managedInstance.id, managedInstance.name)");
  });
});

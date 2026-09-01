import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("dark theme P0 guardrails", () => {
  it("keeps the instance table header and loading spinner theme-aware", () => {
    expect(source("../components/dashboard/InstanceTable.tsx")).not.toContain('bg-[#f9fafb]');
    expect(source("../App.tsx")).not.toContain("border-b-2 border-slate-950");
  });

  it("keeps mobile instance actions and the disabled wizard next button theme-aware", () => {
    const sheet = source("../components/dashboard/MobileInstanceSheet.tsx");
    expect(sheet).toContain("bg-status-info-bg");
    expect(sheet).toContain("bg-status-warning-bg");
    expect(sheet).toContain("bg-status-danger-bg");
    expect(sheet).not.toMatch(/bg-(?:indigo|amber|red|emerald)-50\/(?:40|50)/);

    const footer = source("../features/deploy/WizardFooter.tsx");
    expect(footer).toContain("bg-surface-muted border-outline text-content-muted disabled:opacity-100");
    expect(footer).not.toContain("dark:bg-slate-800 border-transparent");
  });

  it("uses compact instance and version layouts below xl", () => {
    expect(source("../components/dashboard/InstanceTable.tsx")).toContain('viewMode === \'table\' ? "xl:block"');
    expect(source("../components/dashboard/InstanceGrid.tsx")).toContain('viewMode === \'table\' && "xl:hidden"');
    expect(source("../components/dashboard/InstancesPanel.tsx")).toContain("Mid-width card fallback");
    expect(source("../components/version-management/VersionDesktopInstanceTable.tsx")).toContain("hidden xl:block");
    expect(source("../components/version-management/VersionMobileInstanceCards.tsx")).toContain("xl:hidden");
  });

  it.each([
    "../components/Privacy.tsx",
    "../components/Terms.tsx",
    "../components/Changelog.tsx",
    "../components/FAQ.tsx",
    "../components/SecurityPage.tsx",
  ])("keeps %s on the semantic canvas", path => {
    expect(source(path)).toContain("min-h-screen bg-app-canvas");
  });
});

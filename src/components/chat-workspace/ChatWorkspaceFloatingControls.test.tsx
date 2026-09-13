import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatWorkspaceFloatingControls } from "./ChatWorkspaceFloatingControls";

function render(sidebarOpen: boolean, selectedInstanceId = "instance-a", mobileWorkspaceOpen = false) {
  return renderToStaticMarkup(<ChatWorkspaceFloatingControls
    sidebarOpen={sidebarOpen}
    selectedInstanceId={selectedInstanceId}
    mobileWorkspaceOpen={mobileWorkspaceOpen}
    expandHistoryLabel="Expand history"
    workspaceLabel="Workspace"
    onOpenSidebar={() => {}}
    onOpenMobileWorkspace={() => {}}
  />);
}

describe("chat workspace floating controls", () => {
  it("shows the desktop expand control only while the sidebar is closed", () => {
    expect(render(false)).toContain('aria-label="Expand history"');
    expect(render(true)).not.toContain('aria-label="Expand history"');
  });

  it("shows the workspace entry only when an instance is selected", () => {
    expect(render(true, "")).not.toContain('aria-label="Workspace"');
    expect(render(true, "instance-a", true)).toContain('aria-expanded="true"');
    expect(render(true, "instance-a", true)).toContain('aria-controls="mobile-chat-workspace-panel"');
  });
});

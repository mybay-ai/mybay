import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatMobileWorkspaceDialog } from "./ChatMobileWorkspaceDialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("mobile workspace dialog", () => {
  it("keeps dialog accessibility and the selected workspace tab", () => {
    const html = renderToStaticMarkup(
      <ChatMobileWorkspaceDialog
        activeTab="files"
        onActiveTabChange={() => {}}
        onClose={() => {}}
        dialogLabel="Workspace"
        closeLabel="Close workspace"
        panelProps={{ messages: [], toolSteps: [] }}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Workspace"');
    expect(html).toContain('aria-label="Close workspace"');
    expect(html).toContain("chatWorkspace.workspaceFilesTab");
    expect(html).toContain("chatWorkspace.workspaceStorageTitle");
  });
});

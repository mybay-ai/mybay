import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatWorkspaceHeader } from "./ChatWorkspaceHeader";
import type { AgentInstance } from "../../types";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe("instance readiness recovery in the chat selector", () => {
  it("keeps a failed probe selectable for rechecking when another instance is ready", () => {
    const ready = { id: "ready", name: "Ready" } as AgentInstance;
    const retry = { id: "retry", name: "Retry" } as AgentInstance;
    const html = renderToStaticMarkup(<ChatWorkspaceHeader mobileSidebarOpen={false} loadingInstances={false}
      instances={[ready, retry]} selectedId="ready" selectedInstance={ready}
      groupedInstances={{ ready: [ready], probing: [], unready: [retry] }}
      chatReadiness={{ ready: { ready: true }, retry: { ready: false, reason: "PROBE_FAILED" } }}
      showSettings={false} hasMessages={false} chatMode="agent" getInstanceDropdownLabel={instance => instance.name}
      onOpenMobileSidebar={() => {}} onDeployNewInstance={() => {}} onInstanceChange={() => {}} onToggleSettings={() => {}} onClear={() => {}} />);
    const option = html.match(/<option[^>]*value="retry"[^>]*>/)?.[0];
    expect(option).toBeDefined(); expect(option).not.toContain("disabled");
  });
});

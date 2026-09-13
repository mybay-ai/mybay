import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { A2ARetryNavigationState } from "./a2aRetryNavigation";
import { ChatWorkspaceRecoveryDraftNotice, resolveRecoveryDraftNoticeKey } from "./ChatWorkspaceRecoveryDraftNotice";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const recoveryDraft: A2ARetryNavigationState = {
  a2aRetryDraft: "retry peer",
  a2aRetryInstanceId: "instance-a",
  a2aRecoverySource: { contextId: "context-a", taskId: "task-a", peerId: "peer-a" },
};

describe("A2A recovery draft notice", () => {
  it("identifies an unchanged linked Agent draft", () => {
    expect(resolveRecoveryDraftNoticeKey({
      selectedInstanceId: "instance-a",
      input: " retry peer ",
      blockCount: 0,
      chatMode: "agent",
      recoveryDraft,
    })).toBe("a2a.draftLinkedHint");
  });

  it.each([
    { input: "edited", blockCount: 0, chatMode: "agent" as const },
    { input: "retry peer", blockCount: 1, chatMode: "agent" as const },
    { input: "retry peer", blockCount: 0, chatMode: "assist" as const },
  ])("marks a modified recovery draft as unlinked", state => {
    expect(resolveRecoveryDraftNoticeKey({ selectedInstanceId: "instance-a", recoveryDraft, ...state }))
      .toBe("a2a.draftUnlinkedHint");
  });

  it("hides stale recovery state from another instance", () => {
    const html = renderToStaticMarkup(<ChatWorkspaceRecoveryDraftNotice
      selectedInstanceId="instance-b"
      input="retry peer"
      blockCount={0}
      chatMode="agent"
      recoveryDraft={recoveryDraft}
    />);
    expect(html).toBe("");
  });

  it("renders a live status region for the active recovery draft", () => {
    const html = renderToStaticMarkup(<ChatWorkspaceRecoveryDraftNotice
      selectedInstanceId="instance-a"
      input="retry peer"
      blockCount={0}
      chatMode="agent"
      recoveryDraft={recoveryDraft}
    />);
    expect(html).toContain('role="status"');
    expect(html).toContain("a2a.draftLinkedHint");
  });
});

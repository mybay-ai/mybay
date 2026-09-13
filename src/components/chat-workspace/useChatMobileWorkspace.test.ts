import { describe, expect, it } from "vitest";
import {
  initialChatMobileWorkspaceState,
  reduceChatMobileWorkspace,
} from "./useChatMobileWorkspace";

describe("mobile chat workspace state", () => {
  it("opens history without losing the selected workspace tab", () => {
    const state = reduceChatMobileWorkspace(
      { overlay: "workspace", workspaceTab: "files" },
      { type: "open-history" },
    );

    expect(state).toEqual({ overlay: "history", workspaceTab: "files" });
  });

  it("opens a requested workspace tab in one transition", () => {
    const state = reduceChatMobileWorkspace(
      initialChatMobileWorkspaceState,
      { type: "open-workspace", tab: "preview" },
    );

    expect(state).toEqual({ overlay: "workspace", workspaceTab: "preview" });
  });

  it("keeps the workspace tab selected after an ordinary close", () => {
    const state = reduceChatMobileWorkspace(
      { overlay: "workspace", workspaceTab: "steps" },
      { type: "close-overlay" },
    );

    expect(state).toEqual({ overlay: null, workspaceTab: "steps" });
  });

  it("resets the workspace tab when the selected instance changes", () => {
    const state = reduceChatMobileWorkspace(
      { overlay: "history", workspaceTab: "debug" },
      { type: "close-and-reset-workspace" },
    );

    expect(state).toEqual(initialChatMobileWorkspaceState);
  });

  it("changes tabs without changing overlay visibility", () => {
    const state = reduceChatMobileWorkspace(
      { overlay: null, workspaceTab: "result" },
      { type: "select-workspace-tab", tab: "files" },
    );

    expect(state).toEqual({ overlay: null, workspaceTab: "files" });
  });
});

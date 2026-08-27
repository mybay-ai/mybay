import { describe, expect, it } from "vitest";
import {
  resolveChatWorkspaceLayoutMode,
  shouldUseOverlayWorkspace,
} from "./chatWorkspaceResponsiveLayout";

describe("chat workspace responsive layout", () => {
  it("uses a single-column mobile layout below 768px", () => {
    expect(resolveChatWorkspaceLayoutMode(767)).toBe("mobile");
    expect(shouldUseOverlayWorkspace(767)).toBe(true);
  });

  it("uses history plus chat with an overlay workspace on tablets", () => {
    expect(resolveChatWorkspaceLayoutMode(768)).toBe("tablet");
    expect(resolveChatWorkspaceLayoutMode(1279)).toBe("tablet");
    expect(shouldUseOverlayWorkspace(1024)).toBe(true);
  });

  it("uses the three-column desktop layout from 1280px", () => {
    expect(resolveChatWorkspaceLayoutMode(1280)).toBe("desktop");
    expect(shouldUseOverlayWorkspace(1920)).toBe(false);
  });
});

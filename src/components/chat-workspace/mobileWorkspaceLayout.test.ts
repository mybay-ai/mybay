import { describe, expect, it } from "vitest";
import { computeMobileWorkspaceFrame } from "./mobileWorkspaceLayout";

describe("mobile workspace layout", () => {
  it("keeps the workspace below the mobile dashboard header", () => {
    expect(computeMobileWorkspaceFrame({
      innerHeight: 844,
      viewportHeight: 844,
      viewportOffsetTop: 0
    })).toEqual({ top: 48, bottom: 0, keyboardOpen: false });
  });

  it("tracks the visual viewport when the software keyboard opens", () => {
    expect(computeMobileWorkspaceFrame({
      innerHeight: 844,
      viewportHeight: 510,
      viewportOffsetTop: 12
    })).toEqual({ top: 48, bottom: 322, keyboardOpen: true });
  });

  it("does not classify a small browser toolbar inset as a keyboard", () => {
    expect(computeMobileWorkspaceFrame({
      innerHeight: 844,
      viewportHeight: 780,
      viewportOffsetTop: 0
    })).toEqual({ top: 48, bottom: 64, keyboardOpen: false });
  });

  it("keeps keyboard mode active while the visual viewport is panned", () => {
    expect(computeMobileWorkspaceFrame({
      innerHeight: 844,
      viewportHeight: 510,
      viewportOffsetTop: 200
    })).toEqual({ top: 48, bottom: 134, keyboardOpen: true });
  });
});

import { describe, expect, it } from "vitest";
import { shouldIgnoreComposerKeyDown } from "./ChatInputBar";

describe("ChatInputBar keyboard handling", () => {
  it("does not submit while an IME composition is active", () => {
    expect(shouldIgnoreComposerKeyDown({ nativeEvent: { isComposing: true, keyCode: 13 } } as any)).toBe(true);
    expect(shouldIgnoreComposerKeyDown({ nativeEvent: { isComposing: false, keyCode: 229 } } as any)).toBe(true);
    expect(shouldIgnoreComposerKeyDown({ nativeEvent: { isComposing: false, keyCode: 13 } } as any)).toBe(false);
  });
});

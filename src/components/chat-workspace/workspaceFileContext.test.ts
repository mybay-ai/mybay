import { describe, expect, it } from "vitest";
import { buildWorkspaceFileContextKey, selectWorkspaceFileContextValue } from "./workspaceFileContext";

describe("workspace file context", () => {
  it("keeps files and previews for the selected conversation", () => {
    const key = buildWorkspaceFileContextKey("instance-1", "conversation-1");
    expect(selectWorkspaceFileContextValue(["file-1"], key, "instance-1", "conversation-1"))
      .toEqual(["file-1"]);
  });

  it("hides the previous conversation value synchronously", () => {
    const oldKey = buildWorkspaceFileContextKey("instance-1", "conversation-old");
    expect(selectWorkspaceFileContextValue(["file-old"], oldKey, "instance-1", "conversation-new"))
      .toBeNull();
  });

  it("does not expose values without a complete selected context", () => {
    expect(selectWorkspaceFileContextValue(["file-1"], "instance-1:conversation-1", "instance-1", null))
      .toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  clearGeneratedPreviewSelection,
  clearPreviewSelection,
  generatedPreviewSelectionStorageKey,
  loadGeneratedPreviewSelection,
  loadPreviewSelection,
  previewSelectionStorageKey,
  saveGeneratedPreviewSelection,
  savePreviewSelection,
} from "./previewSelectionStorage";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("preview selection storage", () => {
  it("isolates the selected file by instance and conversation", () => {
    const storage = createStorage();
    savePreviewSelection(storage as any, "instance/1", "conversation:1", "file-1");
    expect(loadPreviewSelection(storage, "instance/1", "conversation:1")).toBe("file-1");
    expect(loadPreviewSelection(storage, "instance/2", "conversation:1")).toBeNull();
    expect(previewSelectionStorageKey("instance/1", "conversation:1")).toContain("instance%2F1");
  });

  it("forgets a selection only when explicitly cleared", () => {
    const storage = createStorage();
    savePreviewSelection(storage as any, "instance-1", "conversation-1", "file-1");
    clearPreviewSelection(storage, "instance-1", "conversation-1");
    expect(loadPreviewSelection(storage, "instance-1", "conversation-1")).toBeNull();
  });

  it("fails closed when browser storage is unavailable", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(loadPreviewSelection(broken, "instance-1", "conversation-1")).toBeNull();
    expect(() => savePreviewSelection(broken, "instance-1", "conversation-1", "file-1")).not.toThrow();
    expect(() => clearPreviewSelection(broken, "instance-1", "conversation-1")).not.toThrow();
  });

  it("persists generated paths separately from uploaded conversation files", () => {
    const storage = createStorage();
    savePreviewSelection(storage as any, "instance-1", "conversation-1", "file-1");
    saveGeneratedPreviewSelection(storage as any, "instance-1", "conversation-1", "outputs/site/index.html");
    expect(loadPreviewSelection(storage, "instance-1", "conversation-1")).toBe("file-1");
    expect(loadGeneratedPreviewSelection(storage, "instance-1", "conversation-1")).toBe("outputs/site/index.html");
    expect(generatedPreviewSelectionStorageKey("instance-1", "conversation-1"))
      .not.toBe(previewSelectionStorageKey("instance-1", "conversation-1"));
    clearGeneratedPreviewSelection(storage, "instance-1", "conversation-1");
    expect(loadGeneratedPreviewSelection(storage, "instance-1", "conversation-1")).toBeNull();
  });
});

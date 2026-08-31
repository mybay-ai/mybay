import { describe, expect, it, vi } from "vitest";
import type { ClipboardEvent } from "react";
import { handleClipboardAttachments } from "./clipboardAttachments";

function paste(files: File[], items: any[] = []) {
  return { clipboardData: { files, items }, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as ClipboardEvent<HTMLElement>;
}
describe("composer file paste", () => {
  it("sends clipboard files once and prevents the nested text handler consuming the event", () => {
    const files = [new File(["text"], "中文.txt"), new File(["image"], "image.png", { type: "image/png" })];
    const event = paste(files, [{ kind: "file", getAsFile: () => files[0] }]);
    const upload = vi.fn();
    expect(handleClipboardAttachments(event, upload)).toBe(true);
    expect(upload).toHaveBeenCalledExactlyOnceWith(files);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it("accepts image clipboard items when the files list is empty", () => {
    const image = new File(["image"], "image.png", { type: "image/png" });
    const upload = vi.fn();
    expect(handleClipboardAttachments(paste([], [{ kind: "file", getAsFile: () => image }, { kind: "file", getAsFile: () => null }]), upload)).toBe(true);
    expect(upload).toHaveBeenCalledWith([image]);
  });
  it("preserves native short-text and long-text paste, and does nothing without an upload callback", () => {
    const event = paste([], [{ kind: "string" }]);
    expect(handleClipboardAttachments(event, vi.fn())).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled();
    const fileEvent = paste([new File(["x"], "x.txt")]);
    expect(handleClipboardAttachments(fileEvent)).toBe(false); expect(fileEvent.preventDefault).not.toHaveBeenCalled();
  });
});

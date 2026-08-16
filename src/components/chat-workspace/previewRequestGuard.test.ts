import { describe, expect, it } from "vitest";
import { createPreviewRequestGuard } from "./previewRequestGuard";

describe("preview request concurrency guard", () => {
  it("keeps only the latest request current", () => {
    const guard = createPreviewRequestGuard();
    const first = guard.begin({ instanceId: "instance-a", conversationId: "conversation-a", identity: "first" });
    const second = guard.begin({ instanceId: "instance-a", conversationId: "conversation-a", identity: "second" });
    expect(first.signal.aborted).toBe(true);
    expect(guard.isCurrent(first, { instanceId: "instance-a", conversationId: "conversation-a" })).toBe(false);
    expect(guard.isCurrent(second, { instanceId: "instance-a", conversationId: "conversation-a" })).toBe(true);
  });

  it("rejects a stale request after switching instances or conversations", () => {
    const guard = createPreviewRequestGuard();
    const request = guard.begin({ instanceId: "instance-a", conversationId: "conversation-a", identity: "file" });
    expect(guard.isCurrent(request, { instanceId: "instance-b", conversationId: "conversation-a" })).toBe(false);
    expect(guard.isCurrent(request, { instanceId: "instance-a", conversationId: "conversation-b" })).toBe(false);
  });

  it("invalidates the active request when Preview closes", () => {
    const guard = createPreviewRequestGuard();
    const request = guard.begin({ instanceId: "instance-a", conversationId: "conversation-a", identity: "file" });
    guard.invalidate();
    expect(request.signal.aborted).toBe(true);
    expect(guard.isCurrent(request, { instanceId: "instance-a", conversationId: "conversation-a" })).toBe(false);
  });
});
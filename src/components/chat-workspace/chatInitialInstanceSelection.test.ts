import { describe, expect, it } from "vitest";
import { resolveInitialChatInstanceId } from "./chatInitialInstanceSelection";

const instances = [{ id: "first", status: "running" }, { id: "preferred", status: "running" }] as any;

describe("initial chat instance selection", () => {
  it("restores a remembered ready instance but respects an explicit URL selection", () => {
    const readiness = { first: { ready: true }, preferred: { ready: true } } as any;
    expect(resolveInitialChatInstanceId(instances, readiness, null, "preferred")).toBe("preferred");
    expect(resolveInitialChatInstanceId(instances, readiness, "first", "preferred")).toBe("first");
  });
  it("falls back when a saved instance is removed or not ready", () => {
    expect(resolveInitialChatInstanceId(instances, { first: { ready: true } } as any, null, "missing")).toBe("first");
    expect(resolveInitialChatInstanceId(instances, { first: { ready: true } } as any, null, "preferred")).toBe("first");
  });
  it("selects a requested ready instance after quick deployment", () => {
    expect(resolveInitialChatInstanceId(instances, {
      first: { ready: true },
      preferred: { ready: true },
    } as any, "preferred")).toBe("preferred");
  });

  it("falls back to the first ready instance when the requested one is unavailable", () => {
    expect(resolveInitialChatInstanceId(instances, {
      first: { ready: true },
      preferred: { ready: false },
    } as any, "preferred")).toBe("first");
  });

  it("falls back to the first instance when none are chat-ready", () => {
    expect(resolveInitialChatInstanceId(instances, {} as any, "missing")).toBe("first");
  });
});

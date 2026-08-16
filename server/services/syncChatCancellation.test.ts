import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createSyncChatRequestLifecycle, SyncChatOwnership } from "./syncChatCancellation";

function createRequestResponse() {
  const req = new EventEmitter() as any;
  req.aborted = false;
  const res = new EventEmitter() as any;
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;
  return { req, res };
}

describe("SyncChatOwnership", () => {
  it("allows cancellation to win exactly once", () => {
    const owner = new SyncChatOwnership();
    expect(owner.tryAcquireCancel()).toBe(true);
    expect(owner.tryAcquireCommit()).toBe(false);
    expect(owner.state).toBe("cancelled");
  });

  it("prevents a late cancellation after commit ownership", () => {
    const owner = new SyncChatOwnership();
    expect(owner.tryAcquireCommit()).toBe(true);
    expect(owner.tryAcquireCancel()).toBe(false);
    expect(owner.markCompleted()).toBe(true);
    expect(owner.state).toBe("completed");
  });
});

describe("createSyncChatRequestLifecycle", () => {
  it("aborts upstream work when the client disconnects", () => {
    const { req, res } = createRequestResponse();
    const lifecycle = createSyncChatRequestLifecycle(req, res);
    req.aborted = true;
    req.emit("aborted");
    expect(lifecycle.isCancelled()).toBe(true);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(() => lifecycle.throwIfCancelled()).toThrowError(/cancelled/i);
  });

  it("does not cancel after a response has finished", () => {
    const { req, res } = createRequestResponse();
    const lifecycle = createSyncChatRequestLifecycle(req, res);
    res.writableEnded = true;
    res.emit("finish");
    res.emit("close");
    expect(lifecycle.isCancelled()).toBe(false);
    expect(lifecycle.signal.aborted).toBe(false);
  });
});

import type { Request, Response } from "express";

export type SyncChatState = "running" | "committing" | "cancelled" | "completed" | "failed";

export class SyncChatOwnership {
  private currentState: SyncChatState = "running";

  get state(): SyncChatState {
    return this.currentState;
  }

  tryAcquireCancel(): boolean {
    if (this.currentState !== "running") return false;
    this.currentState = "cancelled";
    return true;
  }

  tryAcquireCommit(): boolean {
    if (this.currentState !== "running") return false;
    this.currentState = "committing";
    return true;
  }

  markCompleted(): boolean {
    if (this.currentState !== "committing") return false;
    this.currentState = "completed";
    return true;
  }

  markFailed(): boolean {
    if (this.currentState !== "committing") return false;
    this.currentState = "failed";
    return true;
  }
}

export class SyncChatCancelledError extends Error {
  readonly code = "CANCELLED_BY_USER";

  constructor() {
    super("Chat request cancelled by user");
    this.name = "AbortError";
  }
}

export function createSyncChatRequestLifecycle(req: Request, res: Response) {
  const ownership = new SyncChatOwnership();
  const controller = new AbortController();
  let responseFinished = false;
  let cleanedUp = false;

  const cancelFromDisconnect = () => {
    if (!responseFinished && ownership.tryAcquireCancel()) {
      controller.abort(new SyncChatCancelledError());
    }
  };
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    req.off("aborted", cancelFromDisconnect);
    res.off("finish", handleFinish);
    res.off("close", handleClose);
  };
  const handleFinish = () => {
    responseFinished = true;
    cleanup();
  };
  const handleClose = () => {
    if (!responseFinished && !res.writableEnded) cancelFromDisconnect();
    cleanup();
  };

  req.once("aborted", cancelFromDisconnect);
  res.once("finish", handleFinish);
  res.once("close", handleClose);

  return {
    ownership,
    signal: controller.signal,
    isCancelled: () => ownership.state === "cancelled",
    hasCommitOwnership: () => ownership.state === "committing",
    throwIfCancelled: () => {
      if (ownership.state === "cancelled") throw new SyncChatCancelledError();
    },
    tryAcquireCommit: () => ownership.tryAcquireCommit(),
    markCompleted: () => ownership.markCompleted(),
    markFailed: () => ownership.markFailed(),
    cleanup
  };
}

export function canWriteHttpResponse(req: Request, res: Response): boolean {
  return !req.aborted && !res.headersSent && !res.writableEnded && !res.destroyed;
}

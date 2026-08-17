import { commitRunSseFrame } from "../runSseCursor";
import type { RunSseCursor } from "../runSseCursor";
import { normalizeSseRunEvent } from "./runEventNormalizer";
import { runReducer } from "./runReducer";
import type { RunExecutionState } from "./runTypes";

export type RunSseFrame = {
  eventId?: number;
  event: string;
  data: string;
  runId: string;
  conversationId?: string;
  requestId?: string;
};

export type RunSseFrameResult = {
  state: RunExecutionState;
  cursor: RunSseCursor;
  consumed: boolean;
};

export function consumeRunSseFrame(
  state: RunExecutionState,
  cursor: RunSseCursor,
  frame: RunSseFrame
): RunSseFrameResult {
  const observedEventId = Number.isSafeInteger(frame.eventId) && Number(frame.eventId) > 0
    ? Number(frame.eventId)
    : 0;
  const seq = observedEventId > 0
    ? observedEventId
    : Math.max(cursor.lastCommittedEventId, state.lastProcessedSeq) + 1;
  const normalized = normalizeSseRunEvent({
    seq,
    event: frame.event,
    data: frame.data,
    runId: frame.runId,
    conversationId: frame.conversationId,
    requestId: frame.requestId || state.requestId
  });
  const nextState = normalized ? runReducer(state, normalized) : state;
  const consumed = nextState !== state;
  return {
    state: nextState,
    cursor: commitRunSseFrame({
      currentEventId: observedEventId,
      lastCommittedEventId: cursor.lastCommittedEventId
    }, consumed),
    consumed
  };
}

import { describe, expect, it } from "vitest";
import { commitRunSseFrame, observeRunSseEventId } from "./runSseCursor";

describe("run SSE cursor", () => {
  it("commits an event id only after the frame is consumed", () => {
    const observed = observeRunSseEventId({ currentEventId: 0, lastCommittedEventId: 4 }, 5);
    expect(commitRunSseFrame(observed, false)).toEqual({ currentEventId: 0, lastCommittedEventId: 4 });
    expect(commitRunSseFrame(observed, true)).toEqual({ currentEventId: 0, lastCommittedEventId: 5 });
  });

  it("never moves the committed cursor backwards", () => {
    const stale = { currentEventId: 8, lastCommittedEventId: 12 };
    expect(commitRunSseFrame(stale, true)).toEqual({ currentEventId: 0, lastCommittedEventId: 12 });
  });

  it("ignores invalid event ids", () => {
    const cursor = { currentEventId: 0, lastCommittedEventId: 7 };
    expect(observeRunSseEventId(cursor, 0)).toBe(cursor);
    expect(observeRunSseEventId(cursor, Number.NaN)).toBe(cursor);
  });
});

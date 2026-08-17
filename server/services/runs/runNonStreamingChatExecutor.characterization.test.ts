import { describe, expect, it } from "vitest";
import { filterCurrentRunMessageFromHistory } from "../runsReconciler";

const history = [
  { id: "message-old", request_id: "request-old", role: "assistant", content: "old" },
  { id: "message-current", request_id: "request-a", role: "user", content: "duplicate id" },
  { id: "message-other", request_id: "request-current", role: "user", content: "duplicate request" }
];

describe("non-streaming history filtering characterization", () => {
  it("removes the current message by either message id or request id", () => {
    expect(filterCurrentRunMessageFromHistory(history, "message-current", "request-current"))
      .toEqual([history[0]]);
  });

  it("preserves order and object identity for retained history", () => {
    const filtered = filterCurrentRunMessageFromHistory(history, "message-current", null);
    expect(filtered).toEqual([history[0], history[2]]);
    expect(filtered[0]).toBe(history[0]);
    expect(filtered[1]).toBe(history[2]);
  });

  it("does not filter when both current identities are absent", () => {
    expect(filterCurrentRunMessageFromHistory(history, "", undefined)).toEqual(history);
  });
});

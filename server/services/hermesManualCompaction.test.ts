import { describe, expect, it } from "vitest";
import { parseHermesCompactionOutput } from "./hermesManualCompaction";

function line(value: unknown) {
  return `noise\nMYBAY_COMPACTION_JSON:${Buffer.from(JSON.stringify(value)).toString("base64")}\n`;
}

describe("Hermes manual compaction evidence", () => {
  it("accepts only bounded evidence and session identifiers", () => {
    expect(parseHermesCompactionOutput(line({
      status: "completed", previousSessionId: "api_session-old", sessionId: "api_session-new",
      tokensBefore: 34044, estimatedTokensAfter: 10240, messagesBefore: 46, messagesAfter: 12,
    }))).toEqual({
      runtime: "hermes", status: "completed", reason: "manual", previousSessionId: "api_session-old", sessionId: "api_session-new",
      tokensBefore: 34044, estimatedTokensAfter: 10240, messagesBefore: 46, messagesAfter: 12,
    });
  });

  it("rejects malformed or unmarked output", () => {
    expect(parseHermesCompactionOutput("plain output")).toBeNull();
    expect(parseHermesCompactionOutput(line({ status: "completed", previousSessionId: "bad id", sessionId: "new" }))).toBeNull();
  });
});

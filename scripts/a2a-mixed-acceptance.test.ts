import { describe, expect, it } from "vitest";
import { A2A_SCENARIOS, evaluateCompletedScenario, summarizeResults } from "./a2a-mixed-acceptance";

describe("mixed A2A acceptance evidence", () => {
  const expectedPeerId = "peer-pi";
  const marker = "MYBAY_A2A_TEST";
  const run = {
    id: "run-1",
    status: "completed",
    partialOutput: `member result: ${marker}`,
    groupOutcome: "completed",
    groupCollaboration: { contextId: "ctx-mybay-room-run1", selectedPeerIds: [expectedPeerId] },
  };
  const activity = {
    groupOutcome: "completed",
    activities: [{ direction: "outbound", peerId: expectedPeerId, status: "completed", taskId: "task-1" }],
  };

  it("passes only when host, member, persisted selection and marker all agree", () => {
    expect(evaluateCompletedScenario({ run, activity, expectedPeerId, marker })).toMatchObject({ ok: true, reasons: [] });
  });

  it("fails closed when retained member evidence is missing", () => {
    const result = evaluateCompletedScenario({ run, activity: { groupOutcome: "completed", activities: [] }, expectedPeerId, marker });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("no matching outbound member activity was retained");
  });

  it("fails closed when the exact configured peer was not selected", () => {
    const result = evaluateCompletedScenario({ run: { ...run, groupCollaboration: { ...run.groupCollaboration, selectedPeerIds: ["another-peer"] } }, activity, expectedPeerId, marker });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("persisted selected peer does not exactly match the expected peer");
  });

  it("lets non-strict exploratory runs retain NOT_RUN while strict mode rejects them", () => {
    const results = A2A_SCENARIOS.map((name, index) => ({ name, verdict: index ? "NOT_RUN" as const : "PASS" as const }));
    expect(summarizeResults(results, false).accepted).toBe(true);
    expect(summarizeResults(results, true).accepted).toBe(false);
  });
});

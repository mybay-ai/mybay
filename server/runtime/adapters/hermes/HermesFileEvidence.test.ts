import { describe, expect, it } from "vitest";
import { hermesRunEventProvider } from "./HermesRunEvents";
import { normalizeSseRunEvent } from "../../../../src/components/chat-workspace/run/runEventNormalizer";
import { createRunExecutionState, runReducer } from "../../../../src/components/chat-workspace/run/runReducer";
import { collectLocalRunFileChanges } from "../../../../src/components/chat-workspace/localRunFileChanges";
import { mergeLocalFileChanges, readLocalFileEvidence } from "../../../../shared/localRunFileEvidence";

function harness() {
  let execution = createRunExecutionState({ runId: "run-1" });
  const emitted: string[] = [];
  let seq = 0;
  let id = 0;
  const controller = hermesRunEventProvider.createController({
    addEvent: (runId, event, data) => {
      emitted.push(data);
      const normalized = normalizeSseRunEvent({ runId, event, data, seq: ++seq });
      if (normalized) execution = runReducer(execution, normalized);
    },
    completeTerminal: async () => true, requestReconcile() {}, warn() {}, randomUUID: () => `tool-${++id}`, now: () => 1,
  });
  return {
    send: (event: Record<string, unknown>) => controller.handle({ id: "run-1" }, event),
    live: () => collectLocalRunFileChanges(execution, [], { runId: "run-1" }),
    evidence: () => ({ version: 1, runId: "run-1", changes: mergeLocalFileChanges([...(controller.get("run-1")?.completedFileSteps?.values() || [])]) }),
    emitted,
  };
}

describe("Hermes file evidence from native event through message UI", () => {
  it.each([["patch", "modified"], ["write_file", "unknown"]])("pairs actual %s path previews and persists %s", (tool, kind) => {
    const h = harness();
    h.send({ event: "tool.started", tool, preview: "/opt/data/report.html" });
    expect(h.live()).toEqual([]);
    h.send({ event: "tool.completed", tool, error: false });
    const expected = [{ path: "report.html", kind }];
    expect(h.live()).toEqual(expected);
    expect(collectLocalRunFileChanges(null, [], { runId: "run-1", evidence: JSON.parse(JSON.stringify(h.evidence())) })).toEqual(expected);
    expect(readLocalFileEvidence(h.evidence(), "other-run")).toEqual([]);
  });

  it("accepts structured completed evidence without leaking tool arguments or content", () => {
    const h = harness();
    h.send({ event: "tool.completed", tool: "create_file", args: { path: "/opt/data/new.html", content: "PRIVATE-CONTENT", api_key: "PRIVATE-KEY" } });
    expect(h.live()).toEqual([{ path: "new.html", kind: "added" }]);
    expect(h.emitted.join("")).not.toContain("PRIVATE");
  });

  it.each([true, "disk full"])("rejects failed tool evidence (%s)", error => {
    const h = harness();
    h.send({ event: "tool.started", tool: "patch", preview: "/opt/data/report.html" });
    h.send({ event: "tool.completed", tool: "patch", error });
    expect(h.live()).toEqual([]);
    expect(h.evidence().changes).toEqual([]);
  });

  it("does not pair ambiguous concurrent same-tool events, even in the reducer", () => {
    const h = harness();
    for (const name of ["one", "two"]) h.send({ event: "tool.started", tool: "patch", preview: `/opt/data/${name}.html` });
    h.send({ event: "tool.completed", tool: "patch", error: true });
    h.send({ event: "tool.completed", tool: "patch", error: false });
    expect(h.live()).toEqual([]);
    expect(h.evidence().changes).toEqual([]);
  });

  it.each(["/etc/passwd", "/opt/data/../secret", "/opt/data/.env", "/opt/data/config.yaml", "/opt/data/report...", "/opt/data/a.sqlite", "report.html"])("ignores unsafe or incomplete previews: %s", preview => {
    const h = harness();
    h.send({ event: "tool.started", tool: "patch", preview });
    h.send({ event: "tool.completed", tool: "patch" });
    expect(h.live()).toEqual([]);
    expect(h.evidence().changes).toEqual([]);
    expect(h.emitted.join("")).not.toContain(preview);
  });

  it("never treats read basenames or shell previews as file mutations", () => {
    const h = harness();
    for (const [tool, preview] of [["read_file", "report.html lines 1-3"], ["terminal", "rm /opt/data/report.html"]]) {
      h.send({ event: "tool.started", tool, preview });
      h.send({ event: "tool.completed", tool });
    }
    expect(h.live()).toEqual([]);
  });
});

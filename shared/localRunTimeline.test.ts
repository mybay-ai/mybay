import { describe, expect, it } from "vitest";
import { createLocalRunTimeline, createLocalTimelineCollector, readLocalRunTimeline } from "./localRunTimeline";

const make = (events: Array<{ id: number; event: string; data: string }>) => createLocalRunTimeline({ runId: "r1", conversationId: "c1", status: "completed", events });
describe("local timeline archive", () => {
  it("keeps tool history through thousands of text fragments without duplicating replay", () => {
    const collector = createLocalTimelineCollector();
    collector.add("r", { id: 1, event: "step", data: '{"id":"tool","tool_name":"file","status":"completed"}' });
    for (let id = 2; id <= 4001; id++) collector.add("r", { id, event: "text", data: "x" });
    collector.add("r", { id: 4001, event: "text", data: "duplicate" });
    const result = collector.snapshot("r", "c", "completed");
    expect(result.events).toHaveLength(2);
    expect(result.events[1].data).toHaveLength(4000);
    expect(result.partial).toBe(false);
    collector.clear("r");
    collector.add("r", { id: 4002, event: "text", data: "recovery" });
    expect(collector.snapshot("r", "c", "completed").partial).toBe(true);
  });
  it("caps the summary and isolates concurrent runs", () => {
    const collector = createLocalTimelineCollector();
    collector.add("a", { id: 1, event: "text", data: "a" });
    collector.add("b", { id: 1, event: "text", data: "b" });
    collector.add("a", { id: 2, event: "text", data: "x".repeat(70 * 1024) });
    expect(collector.snapshot("a", "c", "cancelled")).toMatchObject({ partial: true, events: [{ data: "a" }] });
    expect(collector.snapshot("b", "d", "failed")).toMatchObject({ partial: false, events: [{ data: "b" }] });
  });
  it("stores only bounded display fields, never tool args, results or approval commands", () => {
    const result = make([{ id: 1, event: "step", data: JSON.stringify({ id: "tool1", tool_name: "file", status: "completed",
      title: "curl https://private?token=secret", args: { secret: "secret" }, output: "secret",
      metadata: { operation: "patch", file_path: "/opt/data/report.html", query: "secret", url: "secret", command: "secret" } }) },
    { id: 2, event: "approval", data: JSON.stringify({ id: "approval", command: "secret", choices: ["secret"], status: "resolved" }) }]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.parse(result.events[0].data).metadata).toEqual({ file_path: "report.html", operation: "modified" });
    expect(readLocalRunTimeline(result, "r1", "c1")).toEqual(result);
    expect(readLocalRunTimeline(result, "r2", "c1")).toBeNull();
    expect(readLocalRunTimeline(result, "r1", "c2")).toBeNull();
  });
  it("marks missing, oversized and duplicate observations partial without fabricating text", () => {
    expect(make([]).partial).toBe(true);
    expect(make([{ id: 20, event: "text", data: "suffix" }]).partial).toBe(true);
    const large = make(Array.from({ length: 250 }, (_, i) => ({ id: i + 1, event: "text", data: "x".repeat(4096) })));
    expect(large.partial).toBe(true);
    expect(JSON.stringify(large).length).toBeLessThan(66 * 1024);
    expect(make([{ id: 1, event: "text", data: "first" }, { id: 1, event: "text", data: "duplicate" }]).events).toHaveLength(1);
  });
  it("rejects sensitive paths and ignores terminal hints in favour of the database status", () => {
    const snapshot = make([{ id: 1, event: "step", data: JSON.stringify({ id: "a", metadata: { file_path: "/opt/data/.env" } }) },
      { id: 2, event: "status", data: '{"status":"failed"}' }]);
    expect(JSON.stringify(snapshot)).not.toContain(".env");
    expect(snapshot.status).toBe("completed");
    expect(snapshot.events).toHaveLength(1);
  });
});

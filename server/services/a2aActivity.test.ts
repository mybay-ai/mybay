import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { classifyA2AFailure, groupA2AOrchestrations, readA2AActivities } from "./a2aActivity";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-a2a-activity-"));
  roots.push(root);
  const instanceRoot = path.join(root, "agent-1");
  fs.mkdirSync(path.join(instanceRoot, "a2a_conversations"), { recursive: true });
  return { root, instanceRoot };
}

describe("A2A activity reader", () => {
  it.each([
    ["Error: <urlopen error [Errno 111] Connection refused>", "connection_failed"],
    ["Error: timed out", "timed_out"],
    ["Error: Name or service not known", "agent_offline"],
    ["HTTP 401 Unauthorized", "auth_failed"],
    ["unexpected peer failure", "failed"],
  ])("classifies persisted peer failures from %s", (message, expected) => {
    expect(classifyA2AFailure(message)).toBe(expected);
  });

  it("maps a persisted outbound conversation to a friendly peer and duration", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), `${JSON.stringify({ ts: 10, direction: "outbound", peer: "agent-2", task_id: "task-1" })}\n`);
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-one.jsonl"), [
      JSON.stringify({ ts: 10, role: "user", text: "Check status", task_id: "task-1" }),
      JSON.stringify({ ts: 12.25, role: "agent", text: "Ready", task_id: "task-1" }),
    ].join("\n"));

    expect(readA2AActivities({
      instanceId: "agent-1",
      dataRoot: root,
      peerNames: new Map([["agent-2", "Research Agent"]]),
    })).toEqual([expect.objectContaining({
      contextId: "ctx-one",
      taskId: "task-1",
      direction: "outbound",
      peerId: "agent-2",
      peerName: "Research Agent",
      status: "completed",
      durationMs: 2250,
      summary: "Check status",
      result: "Ready",
    })]);
  });

  it("resolves inbound peer IPs and ignores malformed or unsafe files", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), `${JSON.stringify({ ts: 20, direction: "inbound", peer: "ip:172.27.0.3", task_id: "task-2" })}\nnot-json\n`);
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-two.jsonl"), JSON.stringify({ ts: 20, role: "user", text: "Pending", task_id: "task-2" }));
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "not-a-context.txt"), "secret");

    expect(readA2AActivities({
      instanceId: "agent-1",
      dataRoot: root,
      peerIpToId: new Map([["172.27.0.3", "agent-2"]]),
      peerNames: new Map([["agent-2", "Peer Two"]]),
    })).toEqual([expect.objectContaining({
      direction: "inbound",
      peerId: "agent-2",
      peerName: "Peer Two",
      status: "in_progress",
      completedAt: null,
      durationMs: null,
    })]);
  });

  it("redacts credential-shaped text before it reaches the activity API", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), `${JSON.stringify({ ts: 30, direction: "outbound", peer: "agent-2", task_id: "task-3" })}\n`);
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-three.jsonl"), [
      JSON.stringify({ ts: 30, role: "user", text: "TOKEN=super-secret-value", task_id: "task-3" }),
      JSON.stringify({ ts: 31, role: "agent", text: "Authorization: Bearer hidden-value", task_id: "task-3" }),
    ].join("\n"));

    const [activity] = readA2AActivities({ instanceId: "agent-1", dataRoot: root });
    expect(activity.summary).toContain("[REDACTED]");
    expect(activity.result).toContain("[REDACTED]");
    expect(JSON.stringify(activity)).not.toContain("super-secret-value");
    expect(JSON.stringify(activity)).not.toContain("hidden-value");
  });

  it("keeps concurrent tasks in one context separate and builds an orchestration timeline", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), [
      JSON.stringify({ ts: 40, direction: "outbound", peer: "agent-2", task_id: "task-a" }),
      JSON.stringify({ ts: 40.1, direction: "outbound", peer: "agent-3", task_id: "task-b" }),
    ].join("\n"));
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-shared.jsonl"), [
      JSON.stringify({ ts: 40, role: "user", text: "Research", task_id: "task-a" }),
      JSON.stringify({ ts: 40.1, role: "user", text: "Research", task_id: "task-b" }),
      JSON.stringify({ ts: 42, role: "agent", text: "A", task_id: "task-a" }),
      JSON.stringify({ ts: 43, role: "agent", text: "B", task_id: "task-b" }),
    ].join("\n"));

    const activities = readA2AActivities({
      instanceId: "agent-1",
      dataRoot: root,
      peerNames: new Map([["agent-2", "Research A"], ["agent-3", "Research B"]]),
    });
    expect(activities).toHaveLength(2);
    expect(activities.map((activity) => activity.taskId).sort()).toEqual(["task-a", "task-b"]);
    expect(groupA2AOrchestrations(activities)).toEqual([expect.objectContaining({
      contextId: "ctx-shared",
      status: "completed",
      total: 2,
      completed: 2,
      inProgress: 0,
      durationMs: 3000,
      nodes: expect.arrayContaining([
        expect.objectContaining({ peerName: "Research A", taskId: "task-a" }),
        expect.objectContaining({ peerName: "Research B", taskId: "task-b" }),
      ]),
    })]);
  });

  it("recovers one missing concurrent audit mapping from the bounded trusted peer set", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), JSON.stringify({ ts: 50, direction: "outbound", peer: "agent-2", task_id: "task-a", summary: "Compare" }));
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-race.jsonl"), [
      JSON.stringify({ ts: 50, role: "user", text: "Compare", task_id: "task-a" }),
      JSON.stringify({ ts: 52, role: "agent", text: "A", task_id: "task-a" }),
      JSON.stringify({ ts: 53, role: "agent", text: "B", task_id: "task-b" }),
    ].join("\n"));

    const activities = readA2AActivities({
      instanceId: "agent-1",
      dataRoot: root,
      trustedPeerIds: ["agent-2", "agent-3"],
      peerNames: new Map([["agent-2", "Peer A"], ["agent-3", "Peer B"]]),
    });
    expect(activities).toHaveLength(2);
    expect(activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "task-a", peerId: "agent-2", peerName: "Peer A" }),
      expect.objectContaining({ taskId: "task-b", peerId: "agent-3", peerName: "Peer B", summary: "Compare" }),
    ]));
    expect(groupA2AOrchestrations(activities)[0]).toMatchObject({ contextId: "ctx-race", total: 2, completed: 2 });
  });

  it("marks a mixed completed and unanswered context as partially completed", () => {
    const activities = [
      { contextId: "ctx-partial", taskId: "task-ok", direction: "outbound" as const, peerId: "a", peerName: "A", status: "completed" as const, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:03.000Z", durationMs: 3000, summary: "work", result: "done", failureReason: null },
      { contextId: "ctx-partial", taskId: "task-wait", direction: "outbound" as const, peerId: "b", peerName: "B", status: "in_progress" as const, startedAt: "2026-01-01T00:00:00.000Z", completedAt: null, durationMs: null, summary: "work", result: null, failureReason: null },
    ];
    expect(groupA2AOrchestrations(activities)[0]).toMatchObject({ status: "in_progress", total: 2, completed: 1, failed: 0, inProgress: 1 });
  });

  it("uses the native Hermes tool result to terminalize a failed orchestration node", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), [
      JSON.stringify({ ts: 60, direction: "outbound", peer: "agent-2", task_id: "task-ok" }),
      JSON.stringify({ ts: 60.1, direction: "outbound", peer: "agent-3", task_id: "task-failed" }),
    ].join("\n"));
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-terminal.jsonl"), [
      JSON.stringify({ ts: 60, role: "user", text: "Research", task_id: "task-ok" }),
      JSON.stringify({ ts: 60.1, role: "user", text: "Research", task_id: "task-failed" }),
      JSON.stringify({ ts: 62, role: "agent", text: "Ready", task_id: "task-ok" }),
    ].join("\n"));
    const db = new DatabaseSync(path.join(instanceRoot, "state.db"));
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL)");
    const calls = JSON.stringify([{ id: "call-1", function: { name: "tool_call", arguments: JSON.stringify({ name: "a2a_orchestrate", arguments: { capability: "research", mode: "all", context_id: "ctx-terminal" } }) } }]);
    db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)").run(1, "assistant", "", null, calls, null, 60);
    db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)").run(2, "tool", "Orchestrated 'research' to 2 peer(s):\n\n--- agent-2 ---\nReady\n\n--- agent-3 ---\nError: <urlopen error [Errno 111] Connection refused>", "call-1", null, "a2a_orchestrate", 63);
    db.close();

    const activities = readA2AActivities({ instanceId: "agent-1", dataRoot: root });
    expect(activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ peerId: "agent-2", status: "completed" }),
      expect.objectContaining({ peerId: "agent-3", status: "connection_failed", completedAt: "1970-01-01T00:01:03.000Z", durationMs: 2900, failureReason: expect.stringContaining("Connection refused") }),
    ]));
    expect(groupA2AOrchestrations(activities)[0]).toMatchObject({ status: "partial", completed: 1, failed: 1, inProgress: 0 });
  });

  it("uses a direct a2a_call tool result to terminalize an authentication failure", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), JSON.stringify({ ts: 80, direction: "outbound", peer: "agent-2", task_id: "task-auth" }));
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-auth.jsonl"), JSON.stringify({ ts: 80, role: "user", text: "Check auth", task_id: "task-auth" }));
    const db = new DatabaseSync(path.join(instanceRoot, "state.db"));
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL)");
    const calls = JSON.stringify([{ id: "call-auth", function: { name: "tool_call", arguments: JSON.stringify({ name: "a2a_call", arguments: { agent: "agent-2", message: "Check auth" } }) } }]);
    db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)").run(1, "assistant", "", null, calls, null, 80);
    db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)").run(2, "tool", "Error: peer 'agent-2' rejected auth (HTTP 401). Check the configured token.", "call-auth", null, "a2a_call", 81.5);
    db.close();

    expect(readA2AActivities({ instanceId: "agent-1", dataRoot: root })).toEqual([
      expect.objectContaining({
        contextId: "ctx-auth",
        peerId: "agent-2",
        status: "auth_failed",
        completedAt: "1970-01-01T00:01:21.500Z",
        durationMs: 1500,
        failureReason: expect.stringContaining("HTTP 401"),
      }),
    ]);
  });

  it("marks an unfinished first-mode node as cancelled after a successful terminal tool result", () => {
    const { root, instanceRoot } = fixture();
    fs.writeFileSync(path.join(instanceRoot, "a2a_audit.jsonl"), [
      JSON.stringify({ ts: 70, direction: "outbound", peer: "agent-2", task_id: "task-ok" }),
      JSON.stringify({ ts: 70.1, direction: "outbound", peer: "agent-3", task_id: "task-stopped" }),
    ].join("\n"));
    fs.writeFileSync(path.join(instanceRoot, "a2a_conversations", "ctx-first.jsonl"), [
      JSON.stringify({ ts: 70, role: "user", text: "Research", task_id: "task-ok" }),
      JSON.stringify({ ts: 70.1, role: "user", text: "Research", task_id: "task-stopped" }),
      JSON.stringify({ ts: 72, role: "agent", text: "First", task_id: "task-ok" }),
    ].join("\n"));
    const db = new DatabaseSync(path.join(instanceRoot, "state.db"));
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL)");
    const calls = JSON.stringify([{ id: "call-first", function: { name: "a2a_orchestrate", arguments: JSON.stringify({ capability: "research", mode: "first", context_id: "ctx-first" }) } }]);
    db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)").run(1, "assistant", "", null, calls, null, 70);
    db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)").run(2, "tool", "[first: agent-2]\nFirst", "call-first", null, "a2a_orchestrate", 73);
    db.close();

    const activities = readA2AActivities({ instanceId: "agent-1", dataRoot: root });
    expect(activities).toEqual(expect.arrayContaining([expect.objectContaining({ peerId: "agent-3", status: "cancelled", failureReason: null })]));
  });
});

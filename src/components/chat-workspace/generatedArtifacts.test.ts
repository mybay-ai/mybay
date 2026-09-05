import { describe, expect, it } from "vitest";
import { extractGeneratedArtifacts, getGeneratedArtifactActionPath, isGeneratedArtifactPreviewable, mergeGeneratedArtifactVerification } from "./generatedArtifacts";
import { normalizeGeneratedInstanceFilePath } from "./generatedFilePath";
import { selectMessageGeneratedArtifacts } from "./ChatGeneratedArtifactCards";

describe("generated artifacts", () => {
  it("retains each message/run reference when a later reply mentions the same file", () => {
    const messages = [
      { id: "m1", role: "assistant" as const, content: "/opt/data/report.html", metadata: { run_id: "r1" }, request_id: "q1" },
      { id: "m2", role: "assistant" as const, content: "Read /opt/data/report.html", metadata: { run_id: "r2" }, request_id: "q2" },
    ];
    const artifacts = extractGeneratedArtifacts(messages, null);
    expect(artifacts).toHaveLength(1);
    expect(selectMessageGeneratedArtifacts(artifacts, "m1", "r1")[0]).toMatchObject({ messageId: "m1", runId: "r1", requestId: "q1" });
    expect(selectMessageGeneratedArtifacts(artifacts, "m2", "r2")[0]).toMatchObject({ messageId: "m2", runId: "r2", requestId: "q2" });
    expect(selectMessageGeneratedArtifacts(artifacts, "m3", "r3")).toEqual([]);
    expect(extractGeneratedArtifacts(JSON.parse(JSON.stringify(messages)), null)).toEqual(artifacts);
    expect(mergeGeneratedArtifactVerification(artifacts[0], { references: [], status: "ready" }).references).toEqual(artifacts[0].references);
  });
  it.each(["report.html", "custom-folder/report.html", "outputs/report.html"])("round-trips a generated path through preview and download: %s", (path) => {
    const [artifact] = extractGeneratedArtifacts([{
      id: "assistant-root", role: "assistant", status: "completed", content: `/opt/data/${path}`,
    }], null);
    expect(artifact.path).toBe(path);
    expect(getGeneratedArtifactActionPath(artifact)).toBe(`/opt/data/${path}`);
    expect(normalizeGeneratedInstanceFilePath(getGeneratedArtifactActionPath(artifact))).toBe(path);
  });

  it.each(["../secret.html", "outputs/../secret.html", "C:/temp/report.html", "/etc/report.html", "\\\\host\\share\\report.html"])("rejects unsafe or noncanonical artifact identity: %s", (path) => {
    expect(getGeneratedArtifactActionPath({ path })).toBe("");
  });

  it("extracts safe container artifacts and binds them to the assistant run", () => {
    const artifacts = extractGeneratedArtifacts([{
      id: "assistant-1",
      role: "assistant",
      content: "已生成 /opt/data/outputs/site/index.html 和 outputs/report.pdf",
      status: "pending",
      request_id: "request-1",
      metadata: { runId: "run-1" },
    }], "run-1");

    expect(artifacts).toEqual([
      expect.objectContaining({ path: "outputs/site/index.html", messageId: "assistant-1", runId: "run-1", requestId: "request-1", status: "generating" }),
      expect.objectContaining({ path: "outputs/report.pdf", status: "generating" }),
    ]);
  });

  it("restores generated files and their mutation history from persisted run evidence", () => {
    const artifacts = extractGeneratedArtifacts([
      {
        id: "assistant-added",
        role: "assistant",
        content: "文件已经生成。",
        status: "completed",
        created_at: "2026-09-05T08:00:00.000Z",
        metadata: { run_id: "run-added", file_evidence: { version: 1, runId: "run-added", changes: [{ path: "outputs/report.md", kind: "added" }] } },
      },
      {
        id: "assistant-modified",
        role: "assistant",
        content: "内容已经更新。",
        status: "completed",
        updated_at: "2026-09-05T09:00:00.000Z",
        metadata: { run_id: "run-modified", file_evidence: { version: 1, runId: "run-modified", changes: [{ path: "outputs/report.md", kind: "modified" }] } },
      },
    ], null);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ path: "outputs/report.md", messageId: "assistant-modified", runId: "run-modified" });
    expect(artifacts[0].history).toEqual([
      { kind: "added", messageId: "assistant-added", runId: "run-added", occurredAt: "2026-09-05T08:00:00.000Z" },
      { kind: "modified", messageId: "assistant-modified", runId: "run-modified", occurredAt: "2026-09-05T09:00:00.000Z" },
    ]);
    expect(mergeGeneratedArtifactVerification(artifacts[0], { status: "ready", history: [] }).history).toEqual(artifacts[0].history);
  });

  it("does not attribute a collaboration peer path to the host instance", () => {
    const artifacts = extractGeneratedArtifacts([{
      id: "assistant-group",
      role: "assistant",
      content: "Peer created /opt/data/workspace/peer-report.txt",
      status: "completed",
      metadata: { run_id: "run-group", group_collaboration: { mode: "group", contextId: "ctx-room" } },
    }], null);
    expect(artifacts).toEqual([]);
  });

  it("rejects host paths and deduplicates repeated generated paths", () => {
    const artifacts = extractGeneratedArtifacts([{
      id: "assistant-1",
      role: "assistant",
      content: "G:\\outputs\\secret.html /opt/data/outputs/result.html outputs/result.html",
      status: "completed",
    }], null);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ path: "outputs/result.html", status: "checking" });
  });

  it("preserves run association when verification updates lifecycle state", () => {
    const source = extractGeneratedArtifacts([{
      id: "assistant-1",
      role: "assistant",
      content: "/opt/data/outputs/result.html",
      status: "completed",
      metadata: { runId: "run-1" },
    }], null)[0];
    expect(mergeGeneratedArtifactVerification(source, { status: "ready", size: 42, runId: "wrong" }))
      .toMatchObject({ status: "ready", size: 42, runId: "run-1", messageId: "assistant-1" });
  });

  it("keeps incomplete HTML projects selectable so diagnostics can be shown", () => {
    expect(isGeneratedArtifactPreviewable({ status: "ready" })).toBe(true);
    expect(isGeneratedArtifactPreviewable({ status: "incomplete" })).toBe(true);
    expect(isGeneratedArtifactPreviewable({ status: "missing" })).toBe(false);
  });
});

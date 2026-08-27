import { describe, expect, it } from "vitest";
import { extractGeneratedArtifacts, isGeneratedArtifactPreviewable, mergeGeneratedArtifactVerification } from "./generatedArtifacts";

describe("generated artifacts", () => {
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

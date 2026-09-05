import { describe, expect, it } from "vitest";
import { canRefreshGeneratedArtifact, formatGeneratedArtifactSize, selectMessageGeneratedArtifacts } from "./ChatGeneratedArtifactCards";
import type { GeneratedArtifact } from "./generatedArtifacts";

const artifacts: GeneratedArtifact[] = [
  { path: "outputs/a.html", name: "a.html", messageId: "message-a", runId: "run-a", requestId: null, status: "ready" },
  { path: "outputs/b.pdf", name: "b.pdf", messageId: "message-b", runId: "run-b", requestId: null, status: "ready" },
];

describe("chat generated artifact cards", () => {
  it("keeps artifacts scoped to the owning assistant message", () => {
    expect(selectMessageGeneratedArtifacts(artifacts, "message-a").map(item => item.path)).toEqual(["outputs/a.html"]);
  });

  it("recovers detached assistant artifacts by run id", () => {
    expect(selectMessageGeneratedArtifacts(artifacts, "detached", "run-b").map(item => item.path)).toEqual(["outputs/b.pdf"]);
  });

  it("offers an explicit recheck only after availability verification fails", () => {
    expect(canRefreshGeneratedArtifact({ status: "missing" })).toBe(true);
    expect(canRefreshGeneratedArtifact({ status: "failed" })).toBe(true);
    expect(canRefreshGeneratedArtifact({ status: "ready" })).toBe(false);
    expect(canRefreshGeneratedArtifact({ status: "checking" })).toBe(false);
  });

  it("formats bounded file sizes for the audit details", () => {
    expect(formatGeneratedArtifactSize(47)).toBe("47 B");
    expect(formatGeneratedArtifactSize(1536)).toBe("1.5 KB");
    expect(formatGeneratedArtifactSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatGeneratedArtifactSize(null)).toBeNull();
  });
});

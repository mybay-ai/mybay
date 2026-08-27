import { describe, expect, it } from "vitest";
import { selectMessageGeneratedArtifacts } from "./ChatGeneratedArtifactCards";
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
});

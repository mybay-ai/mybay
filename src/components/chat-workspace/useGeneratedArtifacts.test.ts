import { describe, expect, it } from "vitest";

import { isPendingGeneratedArtifactVerification, mergeArtifactVerificationResults } from "./useGeneratedArtifacts";

describe("generated artifact verification", () => {
  it("keeps both initial pending states in the bounded retry queue", () => {
    expect(isPendingGeneratedArtifactVerification("generating")).toBe(true);
    expect(isPendingGeneratedArtifactVerification("checking")).toBe(true);
    expect(isPendingGeneratedArtifactVerification("missing")).toBe(false);
    expect(isPendingGeneratedArtifactVerification("failed")).toBe(false);
    expect(isPendingGeneratedArtifactVerification("ready")).toBe(false);
  });

  it("preserves the last known file metadata when a later check reports it missing", () => {
    expect(mergeArtifactVerificationResults({
      "report.pdf": { status: "ready", size: 2048, updatedAt: "2026-09-05T08:00:00.000Z", checkedAt: "2026-09-05T08:01:00.000Z" },
    }, [["report.pdf", { status: "missing", checkedAt: "2026-09-05T08:02:00.000Z", error: "FILE_NOT_FOUND" }]])).toEqual({
      "report.pdf": { status: "missing", size: 2048, updatedAt: "2026-09-05T08:00:00.000Z", checkedAt: "2026-09-05T08:02:00.000Z", error: "FILE_NOT_FOUND" },
    });
  });
});

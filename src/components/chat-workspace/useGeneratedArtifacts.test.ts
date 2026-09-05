import { describe, expect, it } from "vitest";

import { isPendingGeneratedArtifactVerification } from "./useGeneratedArtifacts";

describe("generated artifact verification", () => {
  it("keeps both initial pending states in the bounded retry queue", () => {
    expect(isPendingGeneratedArtifactVerification("generating")).toBe(true);
    expect(isPendingGeneratedArtifactVerification("checking")).toBe(true);
    expect(isPendingGeneratedArtifactVerification("missing")).toBe(false);
    expect(isPendingGeneratedArtifactVerification("failed")).toBe(false);
    expect(isPendingGeneratedArtifactVerification("ready")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createLocalGeneratedArtifactSnapshot, LOCAL_GENERATED_ARTIFACT_CONTRACT_VERSION } from "./localGeneratedArtifactLifecycle";

describe("local generated artifact lifecycle", () => {
  it("marks output files as final and ready", () => {
    expect(createLocalGeneratedArtifactSnapshot({
      requestedPath: "/outputs/web/demo/index.html",
      size: 42,
      modifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      now: new Date("2026-01-02T00:00:00.000Z"),
    })).toMatchObject({
      contractVersion: LOCAL_GENERATED_ARTIFACT_CONTRACT_VERSION,
      status: "ready",
      role: "final",
      previewStatus: "ready",
      fingerprint: "42:1767225600000",
      checkedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("keeps the file discoverable while marking an incomplete HTML project", () => {
    const snapshot = createLocalGeneratedArtifactSnapshot({
      requestedPath: "outputs/web/demo/preview.html",
      size: 100,
      modifiedAt: new Date(0),
      htmlPreview: {
        status: "incomplete",
        aliases: {},
        dependencies: [{ reference: "./app.js", requestPath: "app.js", resolvedPath: null, status: "missing" }],
        missing: [{ reference: "./app.js", requestPath: "app.js", resolvedPath: null, status: "missing" }],
      },
    });
    expect(snapshot.status).toBe("incomplete");
    expect(snapshot.previewError).toBe("HTML_PREVIEW_DEPENDENCIES_MISSING");
    expect(snapshot.previewDependencies).toHaveLength(1);
  });
});

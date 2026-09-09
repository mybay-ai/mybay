import { afterEach, describe, expect, it } from "vitest";
import { enrichRuntimeVersionCacheStatus, listManagedRuntimeVersions } from "./runtimeVersionCatalog";

const originalImage = process.env.MYBAY_PI_RUNTIME_IMAGE;

afterEach(() => {
  if (originalImage === undefined) delete process.env.MYBAY_PI_RUNTIME_IMAGE;
  else process.env.MYBAY_PI_RUNTIME_IMAGE = originalImage;
});

describe("managed Runtime version catalog", () => {
  it("exposes the pinned Codex build without admitting upgrades", () => {
    expect(listManagedRuntimeVersions("codex")).toEqual([expect.objectContaining({
      runtime_type: "codex", version: "0.153.4", bridge_version: "0.1.0-experimental.2",
      image: "mybay/codex-runtime", upgradeable: false, certification_level: "experimental",
    })]);
    expect(listManagedRuntimeVersions("codex")[0].capabilities).not.toContain("upgrade");
  });
  it("maps the latest Pi release to the configured distributable image", () => {
    process.env.MYBAY_PI_RUNTIME_IMAGE = "ghcr.io/mybay-ai/pi-runtime:0.85.1";
    const versions = listManagedRuntimeVersions("pi");
    expect(versions).toHaveLength(3);
    expect(versions[0]).toEqual(expect.objectContaining({
        runtime_type: "pi",
        version: "0.85.1",
        tag: "0.85.1",
        image: "ghcr.io/mybay-ai/pi-runtime",
        certification_level: "certified",
        is_latest: true,
    }));
  });

  it("does not mix Hermes discovery into the managed Pi catalog", () => {
    expect(listManagedRuntimeVersions("hermes")).toEqual([]);
  });

  it("reports whether a managed Runtime image is present in Docker", async () => {
    const versions = listManagedRuntimeVersions("pi");
    const cached = await enrichRuntimeVersionCacheStatus(versions, {
      getImage: () => ({ inspect: async () => ({ Id: "sha256:cached" }) }),
    });
    expect(cached[0]).toMatchObject({ is_prewarmed: true, prewarm_status: "cached", image_id: "sha256:cached", repo_digests: [] });

    const missing = await enrichRuntimeVersionCacheStatus(versions, {
      getImage: () => ({ inspect: async () => { throw { statusCode: 404 }; } }),
    });
    expect(missing[0]).toMatchObject({ is_prewarmed: false, prewarm_status: "idle" });
  });
});

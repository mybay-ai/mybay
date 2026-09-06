import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ dbAdapter: { getMyBayVersions: vi.fn(async () => []) } }));
import { resolveCreateRuntimeImage } from "./createRuntimeImageSelection";

describe("create runtime image selection", () => {
  beforeEach(() => delete process.env.MYBAY_PI_RUNTIME_IMAGE);

  it("selects the pinned local Pi bridge image without consulting Hermes versions", async () => {
    await expect(resolveCreateRuntimeImage({ data: { runtime_type: "pi" }, secureData: {}, userRole: "user" }))
      .resolves.toEqual({
        ok: true,
        selection: {
          agent_image: "mybay/pi-runtime",
          agent_image_tag: "0.85.1",
          agent_version: "0.85.1",
          resolved_version: "0.85.1",
          myBayVersions: [],
        },
      });
  });
});

import { describe, expect, it, vi } from "vitest";
import { ensurePiRuntimeDataOwnership, ensureSelectedPiRuntimeImage, parsePiRuntimeImageRef } from "./localPiRuntime";

describe("local Pi Runtime image identity", () => {
  it("keeps the deployed image and persisted version metadata aligned", () => {
    expect(parsePiRuntimeImageRef("mybay/pi-runtime:0.1.0-beta")).toEqual({
      image: "mybay/pi-runtime",
      tag: "0.1.0-beta",
    });
    expect(parsePiRuntimeImageRef("registry.example.test:5443/team/pi:beta")).toEqual({
      image: "registry.example.test:5443/team/pi",
      tag: "beta",
    });
  });

  it("rejects mutable or malformed untagged references", () => {
    expect(() => parsePiRuntimeImageRef("mybay/pi-runtime")).toThrowError(/explicit tag/);
    expect(() => parsePiRuntimeImageRef("mybay/pi-runtime:")).toThrowError(/explicit tag/);
  });

  it("migrates only the mounted instance data with a constrained one-shot container", async () => {
    const calls: any[] = [];
    const remove = vi.fn(async () => {});
    const dockerClient = {
      createContainer: vi.fn(async (config: any) => {
        calls.push(config);
        return { start: vi.fn(async () => {}), wait: vi.fn(async () => ({ StatusCode: 0 })), remove };
      }),
    };
    await ensurePiRuntimeDataOwnership({ dockerClient, image: "mybay/pi-runtime:0.1.0-beta", hostInstanceDataDir: "C:/mybay/data/instance-1" });
    expect(calls[0]).toMatchObject({
      Image: "mybay/pi-runtime:0.1.0-beta",
      User: "root",
      NetworkDisabled: true,
      HostConfig: {
        Binds: ["C:/mybay/data/instance-1:/opt/data:rw"],
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        CapAdd: ["CHOWN"],
      },
    });
    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  it("reuses a labeled historical Pi image without rebuilding it", async () => {
    const dockerClient = {
      getImage: vi.fn(() => ({ inspect: vi.fn(async () => ({ Config: { Labels: {
        "com.mybay.pi.runtime": "true",
        "com.mybay.pi.bridge-version": "0.1.0-experimental",
        "com.mybay.pi.agent-version": "0.85.0",
      } } })) })),
    };
    await expect(ensureSelectedPiRuntimeImage({
      dockerClient,
      imageRef: "mybay/pi-runtime:0.1.0-experimental",
    })).resolves.toBe("mybay/pi-runtime:0.1.0-experimental");
  });

  it("fails closed for an unverified historical Pi image", async () => {
    const dockerClient = { getImage: vi.fn(() => ({ inspect: vi.fn(async () => ({ Config: { Labels: {} } })) })) };
    await expect(ensureSelectedPiRuntimeImage({
      dockerClient,
      imageRef: "mybay/pi-runtime:untrusted",
    })).rejects.toMatchObject({ code: "PI_RUNTIME_IMAGE_UNAVAILABLE" });
  });
});

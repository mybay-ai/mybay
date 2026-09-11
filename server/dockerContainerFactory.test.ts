import { describe, expect, it, vi } from "vitest";
import { createDashboardContainer } from "./dockerContainerFactory";

describe("Runtime container startup", () => {
  it.each(["pi", "codex"])("preserves %s image startup and exposes only its bridge port", async (RuntimeType) => {
    const createContainer = vi.fn((_options, callback) => callback(null, { id: "test-container" }));
    await createDashboardContainer({ createContainer } as any, { Image: "test-runtime", name: "test", RuntimeType, Env: ["PORT=8080"], HostConfig: {} });
    const options = createContainer.mock.calls[0][0];
    expect(options).not.toHaveProperty("Cmd");
    expect(options.ExposedPorts).toEqual({ "8080/tcp": {} });
    expect(options.User).toBe("node");
  });
});

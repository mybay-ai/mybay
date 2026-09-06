import { describe, expect, it } from "vitest";
import { sanitizeInstance } from "./sanitizer";

describe("Agent avatar instance projection", () => {
  it("projects a safe instance-local avatar URL into list and detail responses", () => {
    const instance = {
      id: "agent-1",
      status: "running",
      config_json: JSON.stringify({
        agentAvatarFilename: "avatar.png",
        agentAvatarUpdatedAt: "2026-09-06T12:00:00.000Z",
      }),
    };

    const result = sanitizeInstance(instance, "list");
    expect(result.avatar_url).toBe("/api/instances/agent-1/avatar?v=2026-09-06T12%3A00%3A00.000Z");
    expect(result.configSummary.avatarUrl).toBe(result.avatar_url);
  });

  it("does not expose an avatar URL for an unsafe filename", () => {
    const result = sanitizeInstance({
      id: "agent-1",
      status: "running",
      config_json: JSON.stringify({ agentAvatarFilename: "../avatar.png" }),
    });

    expect(result.avatar_url).toBeUndefined();
    expect(result.configSummary.avatarUrl).toBeNull();
  });
});

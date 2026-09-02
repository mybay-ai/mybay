import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Instance A2A collaboration activity presentation", () => {
  it("renders the protected activity feed with direction, duration, context, and result labels", () => {
    const source = fs.readFileSync(path.resolve("src/components/dashboard/InstanceA2ACollaboration.tsx"), "utf8");

    expect(source).toContain("/a2a/activity?limit=12");
    expect(source).toContain('t("a2a.recentActivity")');
    expect(source).toContain('t(outbound ? "a2a.outbound" : "a2a.inbound")');
    expect(source).toContain("activity.durationMs");
    expect(source).toContain("activity.contextId");
    expect(source).toContain('t("a2a.resultLabel")');
    expect(source).toContain('t("a2a.orchestrationTimeline")');
    expect(source).toContain("orchestration.nodes.map");
    expect(source).toContain('t("a2a.peerCapabilities")');
    expect(source).toContain("parseCapabilityText");
    expect(source).toContain("isRetryableA2AStatus(activity.status)");
    expect(source).toContain('t("a2a.retryInChat")');
    expect(source).toContain('activity.status === "auth_failed"');
    expect(source).toContain('t("a2a.authRecoveryTitle")');
    expect(source).toContain("currentInstanceIdRef.current !== targetInstanceId");
    expect(source).toContain("status?.peers?.find");
    expect(source).toContain("15_000");
  });
});

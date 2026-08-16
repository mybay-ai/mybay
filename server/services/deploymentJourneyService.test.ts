import { describe, expect, it } from "vitest";
import { buildDeploymentJourney } from "./deploymentJourneyService";

const runningInstance = (config: Record<string, unknown> = { channel: "web" }) => ({
  id: "instance-1",
  status: "running",
  health_status: "healthy",
  config_json: JSON.stringify(config),
});

const completedReply = {
  instance_id: "instance-1",
  role: "assistant",
  status: "completed",
  content: "OK",
};

describe("deployment journey truth model", () => {
  it("does not infer credentials or acceptance merely from an existing instance", () => {
    const result = buildDeploymentJourney({
      environmentReady: true,
      credentials: [],
      instances: [runningInstance()],
      chatMessages: [],
    });
    expect(result.completed).toBe(2);
    expect(result.steps.find((step) => step.key === "credential")?.done).toBe(false);
    expect(result.steps.find((step) => step.key === "acceptance")?.reason).toBe("WEB_CHAT_NOT_VERIFIED");
  });

  it("accepts Web mode only after a completed assistant reply", () => {
    const result = buildDeploymentJourney({
      environmentReady: true,
      credentials: [{ id: "credential-1", verification_status: "verified" }],
      instances: [runningInstance()],
      chatMessages: [completedReply],
    });
    expect(result.completed).toBe(4);
  });

  it("requires the credential selected by the deployed instance to be verified", () => {
    const result = buildDeploymentJourney({
      environmentReady: true,
      credentials: [
        { id: "credential-1", verification_status: "verified" },
        { id: "credential-2", verification_status: "untested" },
      ],
      instances: [runningInstance({ channel: "web", providerCredentialId: "credential-2" })],
      chatMessages: [completedReply],
    });
    expect(result.steps.find((step) => step.key === "credential")?.done).toBe(false);
    expect(result.completed).toBe(3);
  });

  it("requires explicit inbound and outbound acceptance for external channels", () => {
    const pending = buildDeploymentJourney({
      environmentReady: true,
      credentials: [{ id: "credential-1", verification_status: "verified" }],
      instances: [runningInstance({ channel: "telegram" })],
      chatMessages: [completedReply],
    });
    expect(pending.steps.find((step) => step.key === "acceptance")?.reason).toBe("EXTERNAL_CHANNEL_NOT_ACCEPTED");

    const complete = buildDeploymentJourney({
      environmentReady: true,
      credentials: [{ id: "credential-1", verification_status: "verified" }],
      instances: [runningInstance({ channel: "telegram", channelAcceptance: { channel: "telegram", inboundConfirmed: true, outboundConfirmed: true, verifiedAt: "2026-08-15T00:00:00.000Z" } })],
      chatMessages: [completedReply],
    });
    expect(complete.completed).toBe(4);
  });
});

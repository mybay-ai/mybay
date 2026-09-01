import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const questionBridgeEnabled = vi.hoisted(() => vi.fn());
const authenticateQuestionBridge = vi.hoisted(() => vi.fn());
const getContainer = vi.hoisted(() => vi.fn());

vi.mock("./questionBridgeCredentials", () => ({
  authenticateQuestionBridge,
  bridgeCredentialPath: (id: string) => path.resolve("data", "question-bridge", `${id}.json`),
  questionBridgeEnabled,
}));
vi.mock("../../lib/docker", () => ({ docker: { getContainer } }));

import { inspectLocalQuestionBridge, invalidateLocalQuestionBridgeStatus } from "./questionBridgeInstaller";

const instance = { id: "question-health-test", container_id: "agent" };
const root = path.resolve("data", "instances", instance.id);
const supportedImage = "sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79";

function runtime(image = supportedImage, running = true, sharedNetwork = true) {
  const stream = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    resume() { queueMicrotask(() => this.emit("end")); },
  });
  const agent = {
    inspect: vi.fn().mockResolvedValue({ Image: image, State: { Running: running }, NetworkSettings: { Networks: { agent_net: {} } } }),
    exec: vi.fn().mockResolvedValue({ start: vi.fn().mockResolvedValue(stream), inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }) }),
  };
  const controller = { inspect: vi.fn().mockResolvedValue({ Name: "/controller", NetworkSettings: { Networks: sharedNetwork ? { agent_net: {} } : { other_net: {} } } }) };
  getContainer.mockImplementation((id: string) => id === "agent" ? agent : controller);
}

describe("structured question health inspection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateLocalQuestionBridgeStatus(instance.id);
    fs.rmSync(root, { recursive: true, force: true });
    runtime();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("distinguishes an installable missing plugin from an unsupported image", async () => {
    questionBridgeEnabled.mockReturnValue(false);
    expect(await inspectLocalQuestionBridge(instance)).toMatchObject({ reason: "not_configured", configured: false, supported: true, installable: true, repairable: false });
    invalidateLocalQuestionBridgeStatus(instance.id);
    runtime("sha256:unsupported");
    expect(await inspectLocalQuestionBridge(instance)).toMatchObject({ reason: "unsupported_image", supported: false, installable: false, repairable: false });
  });

  it("requires matching credentials and successful ask_user discovery", async () => {
    questionBridgeEnabled.mockReturnValue(true);
    authenticateQuestionBridge.mockReturnValue(true);
    fs.mkdirSync(path.join(root, "plugins", "oss-local-questions"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugins", "oss-local-questions", "bridge.json"), JSON.stringify({ url: `http://controller:3000/internal/questions/${instance.id}`, token: "a".repeat(64) }));
    expect(await inspectLocalQuestionBridge(instance)).toEqual({ configured: true, supported: true, healthy: true, installable: false, repairable: false, reason: "healthy" });
    invalidateLocalQuestionBridgeStatus(instance.id);
    authenticateQuestionBridge.mockReturnValue(false);
    expect(await inspectLocalQuestionBridge(instance)).toMatchObject({ reason: "plugin_unavailable", healthy: false, repairable: true });
  });

  it("deduplicates concurrent probes and serves the short-lived cache", async () => {
    questionBridgeEnabled.mockReturnValue(false);
    const [first, second] = await Promise.all([inspectLocalQuestionBridge(instance), inspectLocalQuestionBridge(instance)]);
    expect(first).toEqual(second);
    expect(getContainer).toHaveBeenCalledTimes(2);
    await inspectLocalQuestionBridge(instance);
    expect(getContainer).toHaveBeenCalledTimes(2);
  });
});

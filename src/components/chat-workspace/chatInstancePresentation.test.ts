import { describe, expect, it } from "vitest";
import type { AgentInstance } from "../../types";
import {
  getChatInstanceDropdownLabel,
  groupChatInstances,
  isCodexChatGPTAccountInstance,
} from "./chatInstancePresentation";

const instance = (id: string, overrides: Partial<AgentInstance> = {}) => ({ id, name: id, ...overrides } as AgentInstance);
const t = ((key: string) => key.split(".").at(-1) || key) as any;

describe("chat instance presentation", () => {
  it("groups instances by readiness without changing their relative order", () => {
    const ready = instance("ready"), probing = instance("probing"), unready = instance("unready");
    expect(groupChatInstances([probing, ready, unready], {
      ready: { ready: true } as any,
      unready: { ready: false } as any,
    })).toEqual({ ready: [ready], probing: [probing], unready: [unready] });
  });

  it("formats ready, probing and unavailable channel labels", () => {
    const web = instance("web", { configSummary: { channel: "web" } as any });
    const feishu = instance("feishu", { configSummary: { channel: "feishu", channelLabel: "飞书" } as any });
    expect(getChatInstanceDropdownLabel(web, {}, t)).toBe("[pureWebLabel] web (probingLabel)");
    expect(getChatInstanceDropdownLabel(web, { web: { ready: false } as any }, t)).toBe("[pureWebLabel] web (webOnlyNotReadyLabel)");
    expect(getChatInstanceDropdownLabel(feishu, { feishu: { ready: false } as any }, t)).toBe("[飞书] feishu (externalMainChannelOnlyLabel)");
    expect(getChatInstanceDropdownLabel(web, { web: { ready: true } as any }, t)).toBe("[pureWebLabel] web");
  });

  it("identifies only ChatGPT OAuth Codex instances", () => {
    expect(isCodexChatGPTAccountInstance(instance("codex", { runtime_type: "codex", codexAuthMode: "chatgpt" }))).toBe(true);
    expect(isCodexChatGPTAccountInstance(instance("api", { runtime_type: "codex", codexAuthMode: "api" }))).toBe(false);
    expect(isCodexChatGPTAccountInstance(instance("pi", { runtime_type: "pi" }))).toBe(false);
  });
});

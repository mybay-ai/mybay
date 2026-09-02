import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

import {
  DEFAULT_AGENT_API_MAX_RETRIES,
  DEFAULT_AGENT_DISABLED_TOOLSETS,
  DEFAULT_AGENT_MCP_RESULT_SIZE_CHARS,
  EMPTY_SKILLS_DISABLED_TOOLSET,
  HERMES_A2A_PLUGIN,
  HERMES_NATIVE_CONFIG_VERSION,
  buildHermesNativeYamlTemplate,
  resolveAgentDisabledToolsets,
  resolveHermesPluginPolicy,
} from "./configWriter";
import { encrypt } from "./crypto";

describe("Hermes Agent tool policy", () => {
  it("disables unused high-cost toolsets when the instance has no selected skills", () => {
    const parsed = yaml.load(buildHermesNativeYamlTemplate()) as any;

    expect(parsed._config_version).toBe(HERMES_NATIVE_CONFIG_VERSION);
    expect(parsed.agent.disabled_toolsets).toEqual([
      ...DEFAULT_AGENT_DISABLED_TOOLSETS,
      EMPTY_SKILLS_DISABLED_TOOLSET,
    ]);
    expect(parsed.agent.api_max_retries).toBe(DEFAULT_AGENT_API_MAX_RETRIES);
    expect(parsed.tool_budget.mcp_result_size_chars).toBe(DEFAULT_AGENT_MCP_RESULT_SIZE_CHARS);
  });

  it("keeps skill discovery available when the instance selected a skill", () => {
    expect(resolveAgentDisabledToolsets({ skills: ["browser"] })).toEqual([
      ...DEFAULT_AGENT_DISABLED_TOOLSETS,
    ]);
  });

  it("allows an explicit instance override while normalizing unsafe values", () => {
    expect(resolveAgentDisabledToolsets({
      agentDisabledToolsets: [" browser ", "browser", "memory", "bad value", 7],
    })).toEqual(["browser", "memory"]);

    const parsed = yaml.load(buildHermesNativeYamlTemplate(
      "openai",
      "gpt-4o",
      "",
      "",
      "",
      "",
      { agentDisabledToolsets: [] },
    )) as any;
    expect(parsed.agent.disabled_toolsets).toEqual([]);
  });

  it("writes the A2A gateway and resolved private peers into native Hermes YAML", () => {
    const parsed = yaml.load(buildHermesNativeYamlTemplate(
      "openai",
      "gpt-4o",
      "",
      "",
      "",
      "",
      {
        a2aEnabled: true,
        a2aResolvedPeers: [{
          instanceId: "research-agent",
          url: "http://mybay-agent-research-agent:9900",
          encryptedToken: encrypt("peer-secret"),
          capabilities: ["research", "review"],
        }],
      },
    )) as any;

    expect(parsed.gateway.platforms.a2a).toEqual({ enabled: true, extra: { port: 9900 } });
    expect(parsed.a2a_agents["research-agent"]).toMatchObject({
      url: "http://mybay-agent-research-agent:9900",
      auth: { type: "bearer", token: "peer-secret" },
      capabilities: ["research", "review"],
    });
    expect(parsed.platform_toolsets).toBeUndefined();
  });

  it("keeps the bundled A2A platform plugin enabled across generated config rewrites", () => {
    expect(resolveHermesPluginPolicy(
      { a2aEnabled: true },
      ["dashboard_auth/basic"],
      [HERMES_A2A_PLUGIN, "other/plugin"],
    )).toEqual({
      enabled: ["dashboard_auth/basic", HERMES_A2A_PLUGIN],
      disabled: ["other/plugin"],
    });
  });

  it("keeps outbound A2A tools disabled when no trusted peer was resolved", () => {
    const parsed = yaml.load(buildHermesNativeYamlTemplate(
      "openai",
      "gpt-4o",
      "",
      "",
      "",
      "",
      { a2aEnabled: true, a2aResolvedPeers: [] },
    )) as any;

    expect(parsed.gateway.platforms.a2a).toEqual({ enabled: true, extra: { port: 9900 } });
    expect(parsed.a2a_agents).toBeUndefined();
    expect(parsed.platform_toolsets).toBeUndefined();
  });
});

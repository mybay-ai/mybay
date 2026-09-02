import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAgentAvatar, resolveAgentAvatarPresentation } from "./ChatAgentAvatar";
import type { AgentInstance } from "../../types";

function instance(values: Partial<AgentInstance>): AgentInstance {
  return { id: "instance", name: "Agent", path: "/agent", status: "running", url: "http://localhost", createdAt: "2026-09-01", ...values };
}

describe("ChatAgentAvatar", () => {
  it("uses the Hermes identity from the runtime binding", () => {
    const presentation = resolveAgentAvatarPresentation(instance({ runtime_type: "hermes" }));
    expect(presentation).toMatchObject({ runtime: "hermes", labelKey: "chatWorkspace.agentAvatarHermes", initials: "H" });
    expect(renderToStaticMarkup(<ChatAgentAvatar instance={instance({ runtime_type: "hermes" })} />))
      .toContain('data-agent-runtime="hermes"');
  });

  it("falls back to the configured image and keeps other runtimes distinct", () => {
    expect(resolveAgentAvatarPresentation(instance({ agent_image: "nousresearch/hermes-agent" })).runtime).toBe("hermes");
    expect(resolveAgentAvatarPresentation(instance({ runtime_type: "opencode" }))).toMatchObject({ runtime: "opencode", labelKey: "chatWorkspace.agentAvatarOpenCode", initials: "OC" });
    expect(resolveAgentAvatarPresentation(instance({ runtime_type: "custom-runtime" }))).toMatchObject({ runtime: "custom-runtime", labelKey: "chatWorkspace.agentAvatarCustom", runtimeLabel: "custom-runtime", initials: "CR" });
  });
});

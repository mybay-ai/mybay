import { docker } from "../lib/docker";

export type A2AToolState = "ready" | "not_configured" | "disabled" | "missing" | "unknown";

// Read the same platform selection as Web chat, without invoking a model or a peer.
export const A2A_TOOL_PROBE = `
import sys, yaml
from hermes_cli.plugins import discover_plugins
from hermes_cli.tools_config import _get_platform_tools
from tools.registry import registry
with open('/opt/data/config.yaml') as f:
    config = yaml.safe_load(f) or {}
discover_plugins()
if 'a2a' in (config.get('agent', {}).get('disabled_toolsets', []) or []):
    sys.exit(21)
if 'a2a' not in _get_platform_tools(config, 'api_server'):
    sys.exit(20)
if any(registry.get_entry(name) is None for name in ['a2a_list', 'a2a_discover', 'a2a_call']):
    sys.exit(22)
`;

export async function probeA2ATools(instance: { id: string; container_id?: string }): Promise<A2AToolState> {
  try {
    const container = docker.getContainer(instance.container_id || `mybay-agent-${instance.id}`);
    const command = await container.exec({
      Cmd: ["timeout", "8", "/opt/hermes/.venv/bin/python", "-c", A2A_TOOL_PROBE],
      AttachStdout: true, AttachStderr: true,
    });
    const stream = await command.start({ Detach: false, Tty: false });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { stream.destroy(); reject(new Error("probe timeout")); }, 9000);
      stream.on("error", () => { clearTimeout(timer); reject(new Error("probe stream failed")); });
      stream.on("end", () => { clearTimeout(timer); resolve(); });
      stream.resume(); // Never return runtime output, which may contain private plugin diagnostics.
    });
    const code = (await command.inspect()).ExitCode;
    return code === 0 ? "ready" : code === 20 ? "not_configured" : code === 21 ? "disabled" : code === 22 ? "missing" : "unknown";
  } catch { return "unknown"; }
}

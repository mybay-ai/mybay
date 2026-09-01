import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import yaml from "js-yaml";
import { docker } from "../../lib/docker";
import { readStoreCollections } from "../../localStore";
import { authenticateQuestionBridge, bridgeCredentialPath, questionBridgeEnabled } from "./questionBridgeCredentials";
import { QuestionError } from "../../repositories/runQuestionsRepo";

const PLUGIN = "oss-local-questions";
const TOOLSET = "oss_local_questions";
const SUPPORTED_IMAGES = new Set([
  "sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79",
  "sha256:3811ed13da874fba2ac99b6d492db9a203d34cb6dccf90d886948c00d0ccec09",
]);
const installing = new Set<string>();
const statusCache = new Map<string, { expiresAt: number; status: QuestionBridgeStatus }>();
const statusInflight = new Map<string, Promise<QuestionBridgeStatus>>();
const STATUS_CACHE_MS = 10_000;
export function isQuestionBridgeInstalling(instanceId: string) { return installing.has(instanceId); }
export type QuestionBridgeStatusReason = "healthy" | "not_configured" | "unsupported_image" | "container_unavailable" | "container_stopped" | "network_unavailable" | "plugin_unavailable";
export type QuestionBridgeStatus = {
  configured: boolean;
  supported: boolean | null;
  healthy: boolean;
  installable: boolean;
  repairable: boolean;
  reason: QuestionBridgeStatusReason;
};
function append(values: unknown, item: string, fallback: string[] = []): string[] {
  return [...new Set([...(Array.isArray(values) ? values.filter(value => typeof value === "string") : fallback), item])];
}
function configurePlugin(config: Record<string, any>) {
  config.plugins ||= {};
  config.plugins.enabled = append(config.plugins.enabled, PLUGIN);
  config.plugins.disabled = (config.plugins.disabled || []).filter((value: string) => value !== PLUGIN);
  config.toolsets = append(config.toolsets, TOOLSET, ["hermes-cli"]);
  config.platform_toolsets ||= {};
  config.platform_toolsets.api_server = append(config.platform_toolsets.api_server, TOOLSET, ["hermes-api-server"]);
}
export function preserveLocalQuestionPlugin(instanceId: string, config: Record<string, any>) {
  if (questionBridgeEnabled(instanceId)) configurePlugin(config);
}
function safePath(target: string) {
  let current = path.resolve(target);
  const root = path.parse(current).root;
  while (current !== root) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new QuestionError("UNSAFE_PLUGIN_PATH");
    } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    current = path.dirname(current);
  }
}
async function probeQuestionTool(container: any, owner: { uid: number; gid: number }, timeoutMs: number) {
  const probe = await container.exec({ User: `${owner.uid}:${owner.gid}`, AttachStdout: true, AttachStderr: true, Cmd: ["/opt/hermes/.venv/bin/python", "-c", "from hermes_cli.plugins import discover_plugins; from tools.registry import registry; discover_plugins(); entry=registry.get_entry('ask_user'); assert entry is not None and entry.toolset == 'oss_local_questions', 'question tool unavailable'"] });
  const stream = await probe.start({ Detach: false, Tty: false });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { stream.destroy(); reject(new QuestionError("QUESTION_PLUGIN_UNAVAILABLE")); }, timeoutMs);
    stream.on("error", () => { clearTimeout(timeout); reject(new QuestionError("QUESTION_PLUGIN_UNAVAILABLE")); });
    stream.on("end", () => { clearTimeout(timeout); resolve(); });
    stream.resume();
  });
  if ((await probe.inspect()).ExitCode !== 0) throw new QuestionError("QUESTION_PLUGIN_UNAVAILABLE");
}
export function invalidateLocalQuestionBridgeStatus(instanceId: string) {
  statusCache.delete(instanceId);
}
async function inspectLocalQuestionBridgeUncached(instance: any): Promise<QuestionBridgeStatus> {
  const id = String(instance.id);
  const configured = questionBridgeEnabled(id);
  const unavailable = (reason: QuestionBridgeStatusReason, supported: boolean | null, installable = false, repairable = false): QuestionBridgeStatus => ({ configured, supported, healthy: false, installable, repairable, reason });
  let container: any;
  let agent: any;
  let controller: any;
  try {
    container = docker.getContainer(instance.container_id || `mybay-agent-${id}`);
    [agent, controller] = await Promise.all([container.inspect(), docker.getContainer(os.hostname()).inspect()]);
  } catch { return unavailable("container_unavailable", null); }
  const supported = SUPPORTED_IMAGES.has(agent.Image);
  if (!supported) return unavailable("unsupported_image", false);
  if (!agent.State.Running) return unavailable("container_stopped", true);
  const sharedNetwork = Object.keys(agent.NetworkSettings.Networks).some(network => controller.NetworkSettings.Networks[network]);
  if (!sharedNetwork) return unavailable("network_unavailable", true);
  if (!configured) return unavailable("not_configured", true, true);
  try {
    const name = controller.Name.replace(/^\//, "");
    const port = Number(process.env.PORT || 3000);
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || !Number.isInteger(port) || port < 1 || port > 65535) return unavailable("network_unavailable", true);
    const root = path.resolve("data", "instances", id);
    const bridgeFile = path.join(root, "plugins", PLUGIN, "bridge.json");
    safePath(bridgeFile);
    const bridgeStat = fs.statSync(bridgeFile);
    if (!bridgeStat.isFile() || bridgeStat.size > 4096) return unavailable("plugin_unavailable", true, false, true);
    const bridge = JSON.parse(fs.readFileSync(bridgeFile, "utf8"));
    if (bridge?.url !== `http://${name}:${port}/internal/questions/${id}` || typeof bridge?.token !== "string" || !authenticateQuestionBridge(id, `Bearer ${bridge.token}`)) return unavailable("plugin_unavailable", true, false, true);
    await probeQuestionTool(container, fs.statSync(root), 5000);
    return { configured: true, supported: true, healthy: true, installable: false, repairable: false, reason: "healthy" };
  } catch { return unavailable("plugin_unavailable", true, false, true); }
}
export async function inspectLocalQuestionBridge(instance: any): Promise<QuestionBridgeStatus> {
  const id = String(instance.id);
  const cached = statusCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.status;
  const active = statusInflight.get(id);
  if (active) return active;
  const pending = inspectLocalQuestionBridgeUncached(instance).then(status => {
    statusCache.set(id, { expiresAt: Date.now() + STATUS_CACHE_MS, status });
    return status;
  }).finally(() => statusInflight.delete(id));
  statusInflight.set(id, pending);
  return pending;
}
export async function installLocalQuestionBridge(instance: any) {
  const id = String(instance.id);
  const credentialFile = bridgeCredentialPath(id);
  if (installing.has(id)) throw new QuestionError("INSTANCE_BUSY");
  invalidateLocalQuestionBridgeStatus(id);
  installing.add(id);
  try {
    const assertIdle = () => {
      if (readStoreCollections(["chatRuns"]).chatRuns.some(run => run.instance_id === id && ["queued", "running", "stopping"].includes(run.status))) throw new QuestionError("INSTANCE_BUSY");
    };
    assertIdle();
    const container = docker.getContainer(instance.container_id || `mybay-agent-${id}`);
    const [agent, controller] = await Promise.all([container.inspect(), docker.getContainer(os.hostname()).inspect()]);
    if (!SUPPORTED_IMAGES.has(agent.Image)) throw new QuestionError("QUESTION_IMAGE_NOT_VERIFIED");
    if (!agent.State.Running || !Object.keys(agent.NetworkSettings.Networks).some(network => controller.NetworkSettings.Networks[network])) throw new QuestionError("QUESTION_NETWORK_UNAVAILABLE");
    // Use the stable controller name on an existing shared Docker network.
    const name = controller.Name.replace(/^\//, "");
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new QuestionError("QUESTION_NETWORK_UNAVAILABLE");
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new QuestionError("QUESTION_NETWORK_UNAVAILABLE");
    const root = path.resolve("data", "instances", id);
    const configFile = path.join(root, "config.yaml");
    const pluginDir = path.join(root, "plugins", PLUGIN);
    const configFiles = [configFile, ...["plugin.yaml", "__init__.py", "bridge.json"].map(file => path.join(pluginDir, file))];
    [...configFiles, credentialFile].forEach(safePath);
    const originalConfig = fs.readFileSync(configFile);
    const config = yaml.load(originalConfig.toString("utf8")) as Record<string, any>;
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new QuestionError("INVALID_PLUGIN_CONFIG");
    const assets = path.resolve("server", "runtimePlugins", PLUGIN);
    const manifest = fs.readFileSync(path.join(assets, "plugin.yaml"));
    const code = fs.readFileSync(path.join(assets, "__init__.py"));
    assertIdle();
    fs.mkdirSync(path.dirname(credentialFile), { recursive: true, mode: 0o700 });
    const backupDir = path.join(path.dirname(credentialFile), `${id}-backup-${Date.now()}`);
    fs.mkdirSync(backupDir, { mode: 0o700 });
    const originals = [...configFiles, credentialFile].map(file => ({ file, bytes: fs.existsSync(file) ? fs.readFileSync(file) : null }));
    for (const [index, original] of originals.entries()) if (original.bytes) fs.writeFileSync(path.join(backupDir, String(index)), original.bytes, { mode: 0o600, flag: "wx" });
    fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(originals.map(({ file, bytes }) => ({ file, existed: bytes !== null }))), { mode: 0o600 });
    try {
      const token = randomBytes(32).toString("hex");
      fs.mkdirSync(pluginDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(pluginDir, "plugin.yaml"), manifest);
      fs.writeFileSync(path.join(pluginDir, "__init__.py"), code);
      fs.writeFileSync(path.join(pluginDir, "bridge.json"), JSON.stringify({ url: `http://${name}:${port}/internal/questions/${id}`, token }), { mode: 0o600 });
      // The official image starts as root but runs Hermes under the data owner.
      // Keep secrets owner-only instead of making the plugin world-readable.
      const owner = fs.statSync(root);
      for (const target of [path.dirname(pluginDir), pluginDir, ...configFiles.slice(1)]) fs.chownSync(target, owner.uid, owner.gid);
      configurePlugin(config);
      fs.writeFileSync(configFile, yaml.dump(config, { noRefs: true, lineWidth: -1 }));
      fs.writeFileSync(credentialFile, JSON.stringify({ enabled: true, tokenHash: createHash("sha256").update(token).digest("hex") }), { mode: 0o600 });
      await probeQuestionTool(container, owner, 15000); // No plugin output or credentials enter API responses/logs.
      await container.restart({ t: 10 });
      return { installed: true, restarted: true };
    } catch (error) {
      for (const original of originals) {
        safePath(original.file);
        if (original.bytes) fs.writeFileSync(original.file, original.bytes, { mode: 0o600 });
        else if (fs.existsSync(original.file)) fs.unlinkSync(original.file);
      }
      throw error;
    }
  } finally { installing.delete(id); invalidateLocalQuestionBridgeStatus(id); }
}

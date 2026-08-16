import os from "os";
import { dbAdapter } from "../db";

export type DeploymentMode = "desktop" | "lan" | "server";

export interface DeploymentModeConfig {
  mode: DeploymentMode;
  bindIp: string;
  accessHost: string;
  availableLanIps: string[];
  proxyMode: string;
  baseDomain: string;
  valid: boolean;
  issues: string[];
  serverConfigured: boolean;
  serverIssues: string[];
  controlPanelBindIp: string;
}

const MODE_KEY = "deployment_mode";
const LAN_IP_KEY = "deployment_lan_bind_ip";

export function listLanIpv4Addresses(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.add(entry.address);
    }
  }
  return [...addresses].sort();
}

function normalizeMode(value: unknown): DeploymentMode {
  const mode = String(value || "").toLowerCase();
  if (mode === "lan" || mode === "server" || mode === "desktop") return mode;
  return (process.env.PROXY_MODE || "local").toLowerCase() === "traefik" ? "server" : "desktop";
}

function isLocalDomain(value: string): boolean {
  const host = value.replace(/^https?:\/\//i, "").split(/[/:]/)[0].toLowerCase();
  return !host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
}
function isValidPublicDomain(value: string): boolean {
  const host = value.replace(/^https?:\/\//i, "").split(/[/:]/)[0].toLowerCase();
  return !isLocalDomain(host) && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host);
}

function isValidCertificateEmail(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

export async function getDeploymentModeConfig(): Promise<DeploymentModeConfig> {
  const storedMode = await dbAdapter.getSystemSetting(MODE_KEY);
  const storedLanIp = await dbAdapter.getSystemSetting(LAN_IP_KEY);
  // An explicit startup mode is authoritative. This prevents a mode saved in
  // the database by an earlier deployment from overriding Quick Start's .env.
  const mode = normalizeMode(process.env.DEPLOYMENT_MODE || storedMode);
  const availableLanIps = listLanIpv4Addresses();
  const proxyMode = (process.env.PROXY_MODE || "local").toLowerCase();
  const baseDomain = String(process.env.MYBAY_INSTANCE_ROOT_DOMAIN || process.env.BASE_DOMAIN || "localhost").trim();
  const controlPanelDomain = String(process.env.CONTROL_PANEL_DOMAIN || "").trim();
  const certificateEmail = String(process.env.LETSENCRYPT_EMAIL || "").trim();
  const lanIp = String(process.env.DEPLOYMENT_LAN_BIND_IP || storedLanIp || "").trim();
  const controlPanelBindIp = String(process.env.CONTROL_PANEL_BIND_IP || "127.0.0.1").trim();
  const serverIssues: string[] = [];
  if (proxyMode !== "traefik") serverIssues.push("SERVER_TRAEFIK_REQUIRED");
  if (!isValidPublicDomain(baseDomain)) serverIssues.push("SERVER_DOMAIN_REQUIRED");
  if (!isValidPublicDomain(controlPanelDomain)) serverIssues.push("SERVER_CONTROL_PANEL_DOMAIN_REQUIRED");
  if (!isValidCertificateEmail(certificateEmail)) serverIssues.push("SERVER_CERT_EMAIL_REQUIRED");

  const issues: string[] = [];
  if (mode === "lan" && (!lanIp || !availableLanIps.includes(lanIp))) issues.push("LAN_IP_INVALID");
  if (mode === "lan" && lanIp && controlPanelBindIp !== lanIp) issues.push("LAN_CONTROL_PANEL_RESTART_REQUIRED");
  if (mode === "server") issues.push(...serverIssues);

  return {
    mode,
    bindIp: mode === "lan" ? lanIp : "127.0.0.1",
    accessHost: mode === "lan" ? lanIp : mode === "desktop" ? "" : baseDomain,
    availableLanIps,
    proxyMode,
    baseDomain,
    valid: issues.length === 0,
    issues,
    serverConfigured: serverIssues.length === 0,
    serverIssues,
    controlPanelBindIp,
  };
}

export async function saveDeploymentModeConfig(modeValue: unknown, lanIpValue?: unknown): Promise<DeploymentModeConfig> {
  const mode = normalizeMode(modeValue);
  const lanIp = String(lanIpValue || "").trim();
  const availableLanIps = listLanIpv4Addresses();
  const controlPanelBindIp = String(process.env.CONTROL_PANEL_BIND_IP || "127.0.0.1").trim();
  const proxyMode = (process.env.PROXY_MODE || "local").toLowerCase();
  const baseDomain = String(process.env.MYBAY_INSTANCE_ROOT_DOMAIN || process.env.BASE_DOMAIN || "localhost").trim();
  const controlPanelDomain = String(process.env.CONTROL_PANEL_DOMAIN || "").trim();
  const certificateEmail = String(process.env.LETSENCRYPT_EMAIL || "").trim();
  if (mode === "server" && proxyMode !== "traefik") {
    const error: any = new Error("SERVER_TRAEFIK_REQUIRED");
    error.code = "SERVER_TRAEFIK_REQUIRED";
    throw error;
  }
  if (mode === "server" && !isValidPublicDomain(baseDomain)) {
    const error: any = new Error("SERVER_DOMAIN_REQUIRED");
    error.code = "SERVER_DOMAIN_REQUIRED";
    throw error;
  }
  if (mode === "server" && !isValidPublicDomain(controlPanelDomain)) {
    const error: any = new Error("SERVER_CONTROL_PANEL_DOMAIN_REQUIRED");
    error.code = "SERVER_CONTROL_PANEL_DOMAIN_REQUIRED";
    throw error;
  }
  if (mode === "server" && !isValidCertificateEmail(certificateEmail)) {
    const error: any = new Error("SERVER_CERT_EMAIL_REQUIRED");
    error.code = "SERVER_CERT_EMAIL_REQUIRED";
    throw error;
  }
  if (mode === "lan" && !availableLanIps.includes(lanIp)) {
    const error: any = new Error("LAN_IP_INVALID");
    error.code = "LAN_IP_INVALID";
    throw error;
  }
  if (mode === "lan" && controlPanelBindIp !== lanIp) {
    const error: any = new Error("LAN_CONTROL_PANEL_RESTART_REQUIRED");
    error.code = "LAN_CONTROL_PANEL_RESTART_REQUIRED";
    throw error;
  }
  await dbAdapter.setSystemSetting(MODE_KEY, mode);
  await dbAdapter.setSystemSetting(LAN_IP_KEY, mode === "lan" ? lanIp : "");
  process.env.DEPLOYMENT_MODE = mode;
  process.env.DEPLOYMENT_LAN_BIND_IP = mode === "lan" ? lanIp : "";
  return getDeploymentModeConfig();
}

export function applyDeploymentModeToConfig(config: any, deployment: DeploymentModeConfig): boolean {
  const changed = config.deployment_mode !== deployment.mode || config.instance_bind_ip !== deployment.bindIp || config.instance_access_host !== deployment.accessHost;
  config.deployment_mode = deployment.mode;
  config.instance_bind_ip = deployment.bindIp;
  config.instance_access_host = deployment.accessHost;
  return changed;
}

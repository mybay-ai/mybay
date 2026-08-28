import os from "os";
import path from "path";
import Docker from "dockerode";
import { execFile } from "child_process";
import crypto from "crypto";
import { docker } from "./lib/docker";
import { Server as SocketIOServer } from "socket.io";
import { dbAdapter } from "./db";
import { decrypt, tryResolvePlainInstancePassword, isEncryptionKeyConfigured, getEncryptionKeyFingerprint } from "./crypto";
import { buildPasswordConfigSummary } from "./utils/passwordConfigSummary";
import { supportsNativeDashboardBasicAuth } from "./utils/hermesVersionCapabilities";
import { generateHermesDashboardPasswordHash } from "./utils/hermesDashboardAuth";
import { ensureEncryptedDashboardAuthSecret } from "./utils/dashboardAuthSecret";
import { buildDeploymentContext } from "./deploymentContext";
import { writePhysicalConfigs, DEFAULT_AGENT_MAX_TURNS, DEFAULT_AGENT_GATEWAY_TIMEOUT, DEFAULT_AGENT_RESTART_DRAIN_TIMEOUT } from "./configWriter";
import { runInstanceHealthChecks } from "./healthCheck";
import { rebuildProxyConfig } from "./proxy/nginx";
import { getTraefikLabels } from "./proxy/traefik";
import { parseTraefikEnv } from "./infrastructure/traefik/traefikConfig";
import { startPeriodicAgentDbSync } from "./sqliteAgentSync";
import { deploymentEventsRepo } from "./repositories/deploymentEventsRepo";
import { resolveInstanceDiskLimitMb } from "./services/instances/instanceStorageQuotaService";
import { resolveInstanceRole } from "./utils/instanceRole";
import { buildInstancePublicUrl } from "./utils/publicUrl";
import { applyDeploymentModeToConfig, getDeploymentModeConfig } from "./services/deploymentMode";
import { classifyDockerError, DeploymentError, toDeploymentError, isSimulatedDeploymentEnabled, type DeploymentErrorCode } from "./dockerErrorClassifier";
import http from "http";


import { globalTaskSemaphore, listInstancePortCandidates } from "./utils";
import fs from "fs";
import tar from "tar-fs";
import { skillPolicyRegistry } from "../shared/skillPolicyRegistry";
import { assertRuntimeSatisfiesSkillPolicy, createRuntimeSecurityManifest } from "./services/skillPolicyEnforcer";
import { resolveHermesProvider, VALID_HERMES_PROVIDERS } from "./providerEnv";
import { getDockerProfile, getResourceLimits } from "./services/docker/dockerResourcePolicy";
import { ensureLocalFeishuRuntimeImage, requiresLocalFeishuRuntime } from "./services/localFeishuRuntime";
import {
  connectControlPlaneToNetwork,
  connectTraefikToNetwork,
  verifyNetworkSecurity,
} from "./services/docker/dockerNetworkManager";

export async function ensureFrontendBuilt(docker: any, baseImage: string, instanceId: string, io: SocketIOServer, config?: any): Promise<string> {
  if (requiresLocalFeishuRuntime(config)) {
    const lastSlash = baseImage.lastIndexOf("/");
    const lastColon = baseImage.lastIndexOf(":");
    const selectedImage = lastColon > lastSlash ? baseImage.slice(0, lastColon) : baseImage;
    const selectedTag = lastColon > lastSlash ? baseImage.slice(lastColon + 1) : "latest";
    return ensureLocalFeishuRuntimeImage({
      dockerClient: docker,
      baseImage: selectedImage,
      baseTag: selectedTag,
      onLog: (message) => io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[飞书运行环境] ${message}`,
      }),
    });
  }
  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[标准镜像就绪] 遵循标准版本模型规范，跳过动态派生构建，直接调度官方标准镜像：${baseImage}`,
  });
  return baseImage;
}

export function getHostPath(containerPath: string): Promise<string> {
  return new Promise((resolve) => {
    const defaultResolution = containerPath;
    const hostname = os.hostname();
    if (!hostname) {
      resolve(defaultResolution);
      return;
    }

    const container = docker.getContainer(hostname);
    container.inspect((err, data) => {
      if (err || !data || !data.Mounts) {
        resolve(defaultResolution);
        return;
      }

      const mount = data.Mounts.find((m: any) => {
        const dest = m.Destination;
        return containerPath.startsWith(dest);
      });

      if (mount) {
        const relativePart = containerPath.substring(mount.Destination.length);
        const resolved = path.join(mount.Source, relativePart);
        resolve(resolved);
      } else {
        resolve(defaultResolution);
      }
    });
  });
}

export async function buildDockerHostConfig(
  type: "gateway" | "dashboard" | "single",
  options: {
    networkName: string;
    hostPort?: number; // legacy
    gatewayHostPort?: number;
    dashboardHostPort?: number;
    hostInstanceDataDir: string;
    isTraefik: boolean;
    instance: any;
    config: any;
    runtimeType?: "console-runtime" | "mybay-agent-runtime" | "sandbox-skill-runtime";
    requestUser?: any;
    systemTrustedContext?: boolean;
  }
): Promise<any> {
  const runtimeType = options.runtimeType || "mybay-agent-runtime";
  const profile = getDockerProfile(runtimeType);

  // Refined binds: only map the essential data volume
  const binds = [
    `${options.hostInstanceDataDir}:/opt/data:rw`
  ];

  const selectedSkills = options.config?.skills || [];
  const envAllowsDockerSocket = process.env.ENABLE_DOCKER_SOCKET_SKILL === "true";
  const settingsAllowsDockerSocket = await dbAdapter.getSystemSettingBoolean("admin_docker_socket_enabled", false);
  const isDemoSafeMode = options.config?.provider === "demo-proxy" || options.config?.use_demo_proxy === true;
  const isDockerSkillActive = !isDemoSafeMode && (selectedSkills.includes("docker") || selectedSkills.includes("docker_engine"));

  let isInstancePrivileged = false;
  if (options.instance) {
    const role = await resolveInstanceRole(options.instance);
    isInstancePrivileged = role === "admin" || role === "super_admin";
  }

  const instanceWasCreatedByAdmin = isInstancePrivileged;
  const actorIsAdmin = options.requestUser?.role === "admin" || options.requestUser?.role === "super_admin";
  const isTrustedSystemRecreate = options.systemTrustedContext === true;

  if (
    envAllowsDockerSocket &&
    settingsAllowsDockerSocket &&
    isDockerSkillActive &&
    instanceWasCreatedByAdmin &&
    (actorIsAdmin || isTrustedSystemRecreate)
  ) {
    binds.push("/var/run/docker.sock:/var/run/docker.sock");
  } else if (isDockerSkillActive) {
    console.warn("[Security] Docker socket mount blocked", {
      instanceId: options.instance?.id,
      envAllowsDockerSocket,
      settingsAllowsDockerSocket,
      isDockerSkillActive,
      instanceWasCreatedByAdmin,
      actorIsAdmin,
      isTrustedSystemRecreate,
    });
  }

  const portBindings: any = {};

  // Single-port architecture: always bind internal web port (9119) to host_port, omit 8642 binding entirely.
  const singlePort = options.dashboardHostPort || options.hostPort || options.gatewayHostPort;
  const internalPort = String(options.config?.internal_web_port || "9119");
  if (singlePort) {
    // Desktop/server stay loopback-only. LAN binds only to the exact IP validated by setup.
    let bindIp = options.config?.deployment_mode === "lan"
      ? String(options.config?.instance_bind_ip || "127.0.0.1")
      : "127.0.0.1";

    // Bind only according to the selected local deployment mode.

    portBindings[`${internalPort}/tcp`] = [{ HostIp: bindIp, HostPort: String(singlePort) }];
  }

  const isAdmin = isInstancePrivileged;
  const securityOpts = [...(profile.SecurityOpt || [])];
  if (!isAdmin) {
    if (!securityOpts.includes("no-new-privileges:true")) {
      securityOpts.push("no-new-privileges:true");
    }
  }

  const limits = getResourceLimits(options.config);
  const runtimeManifest = createRuntimeSecurityManifest({
    runtimeType,
    user: profile.User,
    capDrop: profile.CapDrop,
    capAdd: ["CHOWN", "SETUID", "SETGID"],
    securityOpt: securityOpts,
    readonlyRootfs: profile.ReadonlyRootfs,
    binds,
    resourceLimited: Number(limits.Memory || 0) > 0 && Number(limits.NanoCpus || 0) > 0,
  });
  assertRuntimeSatisfiesSkillPolicy({
    skills: selectedSkills,
    userRole: isAdmin ? "admin" : "user",
    isProduction: process.env.NODE_ENV === "production",
    runtime: runtimeManifest,
  });

  const dnsEnv = process.env.MYBAY_CONTAINER_DNS;
  const dnsServers = dnsEnv
    ? dnsEnv.split(",").map(s => s.trim()).filter(Boolean)
    : ["1.1.1.1", "8.8.8.8", "223.5.5.5", "114.114.114.114"];

  return {
    ...limits,
    Dns: dnsServers,
    NetworkMode: options.networkName,
    RestartPolicy: { Name: "unless-stopped" },
    PortBindings: portBindings,
    Binds: binds,
    ReadonlyRootfs: profile.ReadonlyRootfs,
    SecurityOpt: securityOpts,
    CapDrop: profile.CapDrop || [],
    CapAdd: ["CHOWN", "SETUID", "SETGID"],
    Privileged: false // Ensure regular containers are never running as privileged
  };
}
export function createGatewayContainer(
  dockerInstance: Docker,
  options: {
    Image: string;
    name: string;
    Env: string[];
    HostConfig: any;
    User?: string;
  }
): Promise<any> {
  // Disabled by agent as part of transition to single-container s6-overlay architecture.
  return Promise.reject(new Error("createGatewayContainer logic has been removed/disabled as part of the transition to a single-container architecture."));
}

export function createDashboardContainer(
  dockerInstance: Docker,
  options: {
    Image: string;
    name: string;
    Env: string[];
    Labels?: any;
    HostConfig: any;
    User?: string;
  }
): Promise<any> {
  const runtimeType = "mybay-agent-runtime";
  const profile = getDockerProfile(runtimeType);

  let internalWebPort = 9119;
  if (options.Env) {
    const portEnv = options.Env.find(e => e.startsWith("PORT="));
    if (portEnv) {
      const parsed = parseInt(portEnv.split("=")[1], 10);
      if (!isNaN(parsed)) {
        internalWebPort = parsed;
      }
    }
  }

  return new Promise((resolve, reject) => {
    // Determine the actual port to expose based on Env or default
    let targetPort = 9119;
    if (options.Env) {
      const portEnv = options.Env.find((e: string) => e.startsWith("PORT="));
      if (portEnv) {
        const parsed = parseInt(portEnv.split("=")[1], 10);
        if (!isNaN(parsed)) targetPort = parsed;
      }
    }

    dockerInstance.createContainer({
      Image: options.Image,
      name: options.name,
      Cmd: ["gateway", "run"], // Restore critical execution command
      Env: options.Env,
      Labels: options.Labels,
      ExposedPorts: {
        [`${targetPort}/tcp`]: {},
        "8642/tcp": {},
        "8644/tcp": {}
      },
      HostConfig: options.HostConfig,
      User: options.User !== undefined ? options.User : profile.User
    }, (err, container) => {
      if (err) {
        console.error(`[Docker] Failed to create container ${options.name}:`, err);
        reject(err);
      } else {
        resolve(container);
      }
    });
  });
}

export function createContainer(
  dockerInstance: Docker,
  type: "gateway" | "dashboard",
  options: any
): Promise<any> {
  if (type === "gateway") {
    return createGatewayContainer(dockerInstance, options);
  } else {
    return createDashboardContainer(dockerInstance, options);
  }
}

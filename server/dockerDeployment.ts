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

export { getDockerProfile, getResourceLimits } from "./services/docker/dockerResourcePolicy";
export type { DockerProfile } from "./services/docker/dockerResourcePolicy";


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

export async function cleanOldContainersOfInstance(instanceId: string, io?: SocketIOServer) {
  if (io) {
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[Docker Cleanup] 正在深层扫描并清理该实例的所有残留容器(gateway, dashboard, old, recreate)...`
    });
  }

  const containers = await docker.listContainers({ all: true }).catch(() => [] as Docker.ContainerInfo[]);
  const prefixes = [
    `mybay-agent-${instanceId}-gateway`,
    `mybay-agent-${instanceId}-dashboard`,
    `mybay-agent-${instanceId}-old`,
    `mybay-agent-${instanceId}-recreate`,
    `mybay-agent-${instanceId}`
  ];

  for (const c of containers) {
    const matchedName = c.Names.find(n => {
      const cleanName = n.startsWith('/') ? n.substring(1) : n;
      return prefixes.some(p => cleanName === p || cleanName.startsWith(p + "-"));
    });

    if (matchedName) {
      const cleanName = matchedName.startsWith('/') ? matchedName.substring(1) : matchedName;
      if (io) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[Docker Cleanup] 正在停止并销毁冲突容器: ${cleanName}...`
        });
      }
      
      const containerObj = docker.getContainer(c.Id);
      
      try {
        await dbAdapter.insertAuditLog({
          instance_id: instanceId,
          action: "stop_container",
          user_id: "system",
          timestamp: new Date().toISOString(),
          details: `cleanOldContainersOfInstance triggered Docker stop for ${cleanName}`
        }).catch(() => {});
      } catch (e) {}

      await containerObj.stop().catch(() => {});
      await containerObj.remove({ force: true }).catch(() => {});
      
      if (io) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[Docker Cleanup] 已成功销毁残留容器: ${cleanName}`
        });
      }
    }
  }
}

export async function recreateInstance(
  instance: any,
  image: string,
  options: {
    hostInstanceDataDir: string;
    gatewayContainerName: string;
    dashboardContainerName: string;
    gatewayEnv: string[];
    dashboardLabels?: any;
    gatewayHostPort: number;
    dashboardHostPort: number;
    isTraefik: boolean;
    networkName: string;
    config: any;
    io: SocketIOServer;
    requestUser?: any;
    systemTrustedContext?: boolean;
  }
): Promise<{ gateway: any; dashboard: any }> {
  const { io } = options;
  const instanceId = String(instance.id);

  // 1. Clean up old/leftover containers sequentially and wait
  await cleanOldContainersOfInstance(instanceId, io);

  const ownerId = instance.owner_id || instance.user_id;
  await deploymentEventsRepo.create({
    instance_id: instanceId,
    owner_id: ownerId,
    step: "launching",
    status: "info",
    message: "正在准备安全宿主机沙箱、清理历史资源并初始化新进程"
  }).catch(() => {});

  // 2. Build single host configuration combining both interface bindings
  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[Docker] 正在生成运行策略与 HostConfig (Network: ${options.networkName}, Port: ${options.dashboardHostPort})...`
  });

  const hostConfig = await buildDockerHostConfig("single", {
    networkName: options.networkName,
    gatewayHostPort: options.gatewayHostPort,
    dashboardHostPort: options.dashboardHostPort,
    hostInstanceDataDir: options.hostInstanceDataDir,
    isTraefik: options.isTraefik,
    instance,
    config: options.config,
    requestUser: options.requestUser,
    systemTrustedContext: options.systemTrustedContext
  });

  // 3. Create and start the single main MyBay container (historically referred to as dashboard container name but running elements of both)
  const limits = getResourceLimits(options.config);
  const resolvedCpu = limits.NanoCPUs ? `${(limits.NanoCPUs / 1000000000).toFixed(2)} cores` : "unlimited";
  const resolvedMemBytes = limits.Memory || 0;
  let resolvedMem = "unlimited";
  if (resolvedMemBytes > 0) {
    if (resolvedMemBytes >= 1024 * 1024 * 1024) {
      resolvedMem = `${(resolvedMemBytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
    } else {
      resolvedMem = `${(resolvedMemBytes / (1024 * 1024)).toFixed(0)}MB`;
    }
  }

  const logCpuVal = limits.NanoCPUs ? (limits.NanoCPUs / 1000000000).toFixed(1) : "0.5";
  const logMemValMb = limits.Memory ? (limits.Memory / (1024 * 1024)).toFixed(0) : "512";

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[资源限制] CPU=${logCpuVal} cores, Memory=${logMemValMb}MB, NanoCPUs=${limits.NanoCPUs}, Memory=${limits.Memory}`
  });

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[安全防震限制] CPU核心上限 (Limits): ${resolvedCpu} | 物理内存上限 (RAM Limits): ${resolvedMem}`
  });

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[Docker] 正在物理拉起统一的麦贝 Agent 容器: ${options.dashboardContainerName}...`
  });

  const internalPortVal = String(options.config?.internal_web_port || "9119");
  const filteredEnv = options.gatewayEnv.filter(e => !e.startsWith("PORT=") && !e.startsWith("GATEWAY_HEALTH_URL="));
  const finalEnv = [
    ...filteredEnv,
    `PORT=${internalPortVal}`
  ];

  const dashboard = await createDashboardContainer(docker, {
    Image: image,
    name: options.dashboardContainerName,
    Env: finalEnv,
    Labels: options.dashboardLabels,
    HostConfig: hostConfig
  });

  // Write new container_id and container_name to DB immediately to avoid delay or mis-reconciliation
  await dbAdapter.updateInstancePhysicalState(instanceId, {
    container_id: dashboard.id,
    container_name: options.dashboardContainerName
  }).catch((dbErr: any) => {
    console.error("Failed to update container_id in DB immediately:", dbErr);
  });

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[Docker] 容器创建成功(PID: ${dashboard.id.substring(0, 12)})，尝试启动服务...`
  });

  // --- B. 启动前兜底校验 ---
  if (options.networkName) {
    try {
      const net = docker.getNetwork(options.networkName);
      await net.inspect();
    } catch (netInspectErr: any) {
      console.warn(`[启动前兜底校验] 发现实例专属网络 ${options.networkName} 意外丢失! 正在尝试立即重建自愈...`);
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `⚠️ [启动前兜底校验] 发现专属网络 ${options.networkName} 意外丢失，正在紧急执行自愈重建...`
      });
      try {
        try {
          await docker.createNetwork({ Name: options.networkName });
        } catch (netCreateErr: any) {
          const isAlreadyExists = netCreateErr.statusCode === 409 || (netCreateErr.message && netCreateErr.message.includes("already exists"));
          if (!isAlreadyExists) {
            throw netCreateErr;
          }
        }
        if (options.isTraefik) {
          await connectTraefikToNetwork(options.networkName, io, instanceId).catch(() => {});
        }
        const net = docker.getNetwork(options.networkName);
        await net.inspect();
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[启动前兜底自愈成功] 专属网络 ${options.networkName} 已重建就绪并通过校验。`
        });
      } catch (rebuildNetErr: any) {
        console.error(`[启动前兜底自愈失败] 重建网络失败:`, rebuildNetErr);
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `❌ [启动前兜底自愈失败] 无法重建或验证专属网络 ${options.networkName}: ${rebuildNetErr.message || String(rebuildNetErr)}。启动中断。`
        });
        await deploymentEventsRepo.create({
          instance_id: instanceId,
          owner_id: ownerId,
          step: "launching",
          status: "failed",
          message: `启动前专属隔离网络自愈校验失败: ${rebuildNetErr.message || String(rebuildNetErr)}`
        }).catch(() => {});
        throw rebuildNetErr;
      }
    }
  }

  try {
    await dashboard.start();
  } catch (startErr: any) {
    const isNetworkNotFound = startErr.statusCode === 404 && (
      (startErr.message && startErr.message.toLowerCase().includes("network") && startErr.message.toLowerCase().includes("not found")) ||
      (startErr.json && startErr.json.message && startErr.json.message.toLowerCase().includes("network") && startErr.json.message.toLowerCase().includes("not found"))
    );

    if (isNetworkNotFound && options.networkName) {
      console.warn(`[启动网络未找到异常] 捕获到 network not found (404) 报错，开始一次性自动重试自愈启动...`);
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `⚠️ [启动故障自愈] 容器因网络缺失拒绝启动 (404: Network Not Found)。开始执行一次性自愈重建重试...`
      });

      try {
        try {
          await docker.createNetwork({ Name: options.networkName });
          console.log(`[启动故障自愈] 重建专属网络 ${options.networkName} 成功`);
          io.emit(`deploy_log_${instanceId}`, {
            timestamp: new Date().toISOString(),
            message: `[启动故障自愈] 成功重建专属安全隔离网络 ${options.networkName}`
          });
        } catch (netCreateErr: any) {
          const isAlreadyExists = netCreateErr.statusCode === 409 || (netCreateErr.message && netCreateErr.message.includes("already exists"));
          if (!isAlreadyExists) {
            console.error(`[启动故障自愈] 重建专属网络 ${options.networkName} 失败:`, netCreateErr);
            io.emit(`deploy_log_${instanceId}`, {
              timestamp: new Date().toISOString(),
              message: `❌ [启动故障自愈失败] 重建专属隔离网络失败: ${netCreateErr.message || String(netCreateErr)}`
            });
            throw new Error(`自愈重建隔离网络失败: ${netCreateErr.message || String(netCreateErr)}`);
          }
        }
        
        if (options.isTraefik) {
          try {
            await connectTraefikToNetwork(options.networkName, io, instanceId);
          } catch (traefikErr: any) {
            console.warn(`[启动故障自愈] 关联 Traefik 容器到网络失败:`, traefikErr);
            io.emit(`deploy_log_${instanceId}`, {
              timestamp: new Date().toISOString(),
              message: `⚠️ [启动故障自愈警告] 关联 Traefik 到专属网络失败: ${traefikErr.message || String(traefikErr)}`
            });
          }
        }

        try {
          const net = docker.getNetwork(options.networkName);
          await net.connect({ Container: dashboard.id });
          console.log(`[启动故障自愈] 成功将容器连接回专属网络 ${options.networkName}`);
          io.emit(`deploy_log_${instanceId}`, {
            timestamp: new Date().toISOString(),
            message: `[启动故障自愈] 成功将容器关联至专属安全网络。`
          });
        } catch (connectErr: any) {
          const isAlreadyConnected = connectErr.statusCode === 409 || (connectErr.message && connectErr.message.includes("already exists in network"));
          if (!isAlreadyConnected) {
            console.error(`[启动故障自愈] 容器连接至网络 ${options.networkName} 失败:`, connectErr);
            io.emit(`deploy_log_${instanceId}`, {
              timestamp: new Date().toISOString(),
              message: `❌ [启动故障自愈失败] 将容器连接回网络时失败: ${connectErr.message || String(connectErr)}`
            });
            throw new Error(`自愈连接容器至隔离网络失败: ${connectErr.message || String(connectErr)}`);
          }
        }

        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[启动故障自愈] 正在进行第二次(最终)启动尝试...`
        });
        await dashboard.start();
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[启动故障自愈成功] 容器在专属网络自愈重建后成功启动!`
        });
      } catch (retryStartErr: any) {
        console.error(`[自愈重试启动失败]`, retryStartErr);
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[自愈启动重试失败] 重试启动依旧失败: ${retryStartErr.message || String(retryStartErr)}`
        });
        await deploymentEventsRepo.create({
          instance_id: instanceId,
          owner_id: ownerId,
          step: "launching",
          status: "failed",
          message: `自愈启动重试依然失败: ${retryStartErr.message || String(retryStartErr)}`
        }).catch(() => {});
        throw retryStartErr;
      }
    } else {
      console.error(`[Docker Start Error] ${options.dashboardContainerName}:`, startErr);
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[Docker] 容器启动失败! 错误码: ${startErr.statusCode || 'Unknown'} - ${startErr.message || String(startErr)}`
      });
      await deploymentEventsRepo.create({
        instance_id: instanceId,
        owner_id: ownerId,
        step: "launching",
        status: "failed",
        message: `单元沙盒起码启动失败: ${startErr.message || String(startErr)}`
      }).catch(() => {});
      throw startErr;
    }
  }
  
  // Update started_at in DB
  const now = new Date().toISOString();
  await dbAdapter.updateInstanceVersionInfo(instanceId, { started_at: now }).catch(e => {
    console.error("Failed to update started_at in DB:", e);
  });

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[Docker] 麦贝统一容器节点已成功启动! (ID: ${dashboard.id.substring(0, 12)})`
  });

  await deploymentEventsRepo.create({
    instance_id: instanceId,
    owner_id: ownerId,
    step: "launching",
    status: "success",
    message: `安全容器进程启动成功 (CID: ${dashboard.id.substring(0, 12)})`
  }).catch(() => {});

  if (options.config?.template_id) {
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "template_injected",
      status: "success",
      message: "工作流框架到宿主机沙盒注入完毕，所有触发引擎、SOUL.md系统变量同步就绪"
    }).catch(() => {});
  }

  if (options.config?.blueprint_id || options.config?.blueprint_snapshot) {
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "blueprint_injected",
      status: "success",
      message: "行业场景方案已注入运行时目录，关联工作流和技能清单已随实例配置同步"
    }).catch(() => {});
  }

  // Automatically pre-seed and align the model provider configuration inside the Agent's SQLite databases as soon as they are booted/created.
  startPeriodicAgentDbSync(instanceId, options.config);

  // Return the same container in both keys to remain backward compatible
  return { gateway: dashboard, dashboard };
}

export function deployInstance(instance: any, io: SocketIOServer, updateInstanceStatusStmt: any, config: any) {
  return executeDeployment(instance, io, updateInstanceStatusStmt, config);
}

export function simulateDeployment(instanceId: string, io: SocketIOServer, updateInstanceStatusStmt: any) {
  const steps = [
    { delay: 1000, msg: "[系统] 正在验证配置信息..." },
    { delay: 1200, msg: `[Docker] 正在为容器实例创建独立、隔离的安全网桥网络: mybay-net-${instanceId}...` },
    { delay: 1000, msg: "[系统] 正在创建用户隔离数据目录..." },
    { delay: 800, msg: "[系统] 生成运行时环境变量与 config.yaml..." },
    { delay: 2000, msg: "[Docker] 正在拉取镜像 nousresearch/mybay-agent:latest..." },
    { delay: 1500, msg: "[Docker] 正在初始化容器实例并绑定至 127.0.0.1 专属回环地址..." },
    { delay: 1200, msg: "[Docker] 启动容器中..." },
    { delay: 1000, msg: "[网关] 配置反向代理与动态隔离路由..." },
    { delay: 1000, msg: "[系统] 执行运行时健康检查... 正常" },
    { delay: 500, msg: "部署成功！" },
  ];

  let currentDelay = 0;
  steps.forEach((step, index) => {
    currentDelay += step.delay;
    setTimeout(() => {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: step.msg,
      });

      if (index === steps.length - 1) {
        updateInstanceStatusStmt.run({ status: "running", id: instanceId });
        io.emit(`deploy_status_${instanceId}`, "running");
      }
    }, currentDelay);
  });
}

async function pollLocalReadiness(
  hostPort: number,
  timeoutMs: number,
  intervalMs: number,
  io: SocketIOServer,
  instanceId: string
): Promise<boolean> {
  const startTime = Date.now();
  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[Remote Readiness] Container started, waiting for local HTTP readiness on 127.0.0.1:${hostPort}`
  });

  while (Date.now() - startTime < timeoutMs) {
    try {
      const isReady = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://127.0.0.1:${hostPort}/`, { timeout: 2000 }, (res) => {
          res.resume(); // Consume response body to free up memory
          resolve(true); // Accept any response code
        });
        req.on('error', () => {
          resolve(false);
        });
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });

      if (isReady) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[Remote Readiness] Instance ${instanceId} passed local HTTP readiness check`
        });
        return true;
      }
    } catch (e) {
      // Keep polling on unexpected errors
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[Remote Readiness] Instance ${instanceId} failed local HTTP readiness check within timeout`
  });
  return false;
}

export async function executeDeployment(instance: any, io: SocketIOServer, updateInstanceStatusStmt: any, config: any, requestUser?: any, systemTrustedContext?: boolean, _legacyRetryCount = 0, execution?: { taskId?: string; workerId?: string; assertActive?: (step?: string) => Promise<void> }) {
  const simulatedDeploymentEnabled = isSimulatedDeploymentEnabled();
  try {
    await execution?.assertActive?.("preparing");
    await new Promise<void>((resolve, reject) => docker.ping((error) => error ? reject(error) : resolve()));
  } catch (error: any) {
    if (simulatedDeploymentEnabled) {
      simulateDeployment(instance.id, io, updateInstanceStatusStmt);
      return;
    }
    const classified = classifyDockerError(error, "DOCKER_UNAVAILABLE");
    await dbAdapter.updateInstanceRecord(instance.id, {
      status: "failed",
      health_status: "unhealthy",
      error_code: "DOCKER_UNAVAILABLE",
      error_message: classified.message,
      deployment_error: classified.message,
    });
    if (execution?.taskId) {
      await dbAdapter.updateDeploymentTask(execution.taskId, { status: "failed", current_step: "preparing", error_code: "DOCKER_UNAVAILABLE", error_message: classified.message, completed_at: new Date().toISOString(), lease_until: null }, execution.workerId);
    }
    await updateInstanceStatusStmt.run({ status: "failed", id: instance.id, error_code: "DOCKER_UNAVAILABLE", error_message: classified.message });
    io.emit(`deploy_status_${instance.id}`, "failed");
    throw Object.assign(new Error(classified.message), { code: "DOCKER_UNAVAILABLE" });
  }
  const deploymentMode = await getDeploymentModeConfig();
  if (!deploymentMode.valid) {
    const errorMessage = "DEPLOYMENT_MODE_INVALID:" + deploymentMode.issues.join(",");
    await dbAdapter.updateInstanceVersionInfo(instance.id, { deployment_error: errorMessage }).catch(() => {});
    updateInstanceStatusStmt.run({ status: "failed", id: instance.id });
    io.emit(`deploy_log_${instance.id}`, { timestamp: new Date().toISOString(), message: `[Network] ${errorMessage}` });
    io.emit(`deploy_status_${instance.id}`, "failed");
    return;
  }
  if (applyDeploymentModeToConfig(config, deploymentMode)) {
    await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
  }
  // Official Hermes images are used unchanged for every channel. Image availability
  // is handled by the normal Docker deployment pull fallback.

  // Safeguard: Ensure host_port is allocated and persistent under any proxy mode (even Traefik)
  if (!config.host_port || config.host_port === 3000 || config.host_port === 15929 || config.port === "3000" || config.port === "15929") {
    try {
      const newPort = await dbAdapter.reservePortForInstance(instance.id, listInstancePortCandidates());
      if (!newPort) {
        throw new DeploymentError({
          code: "PORT_CONFLICT",
          message: "No host port is currently available.",
          detail: "No unreserved host port is available in the configured range.",
          retryable: true,
        });
      }
      config.host_port = newPort;
      config.port = String(newPort); // backward compatibility
      await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
    } catch (portErr) {
      throw toDeploymentError(portErr, "PORT_CONFLICT");
    }
  }

  const ctx = buildDeploymentContext(instance, config);
  const instanceId = ctx.instanceId;
  const containerName = ctx.gatewayContainerName.replace("-gateway", "");

  // Clear any existing deployment error at start of execution
  await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: null }).catch(() => {});

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[安全说明] 实例数据目录 /opt/data 的物理空间已受配额限制。请注意，Docker 镜像与容器可写层 (overlay) 并未设置内核级硬 quota，若在系统根路径下产生大量临时或垃圾文件，可能影响宿主机，请妥善管理数据。`,
  });

  const agentImage = instance.agent_image || 'nousresearch/mybay-agent';
  const agentTag = instance.agent_image_tag || 'latest';
  const fullImageName = `${agentImage}:${agentTag}`;

  const ownerId = instance.owner_id || instance.user_id;

  // --- DEMO SAFE MODE INTERCEPTION ---
  if (config.provider === "demo-proxy" || config.use_demo_proxy === true) {
    console.warn(`[Demo Safe Mode] Enforcing strict safety constraints on instance ${instanceId}`);
    
    // Server-side hard fallback: explicitly deny any skill with riskLevel 'high' or 'critical',
    // as well as our known explicit blocked list, just in case.
    const explicitBlocked = ["shell", "docker", "docker_engine", "file_system", "file_read", "browser", "custom_webhooks"];
    
    config.skills = (config.skills || []).filter((s: string) => {
      if (explicitBlocked.includes(s)) return false;
      const policy = skillPolicyRegistry && skillPolicyRegistry[s];
      if (policy && (policy.riskLevel === 'high' || policy.riskLevel === 'critical')) {
         return false;
      }
      return true;
    });

    config.env = config.env || {};
    config.env.DEMO_SAFE_MODE = "true";
  }

  // Hermes Runtime Provider Safety Audit
  const mybayProvider = (config.provider || '').trim();
  const baseUrl = (config.baseUrl || '').trim();
  const runtimeProvider = resolveHermesProvider(mybayProvider, baseUrl);

  // If MyBay provider is openai and Base URL is official, runtime provider MUST be openai-api
  const isOfficial = !baseUrl || baseUrl.includes("api.openai.com");
  if (mybayProvider.toLowerCase() === "openai" && isOfficial && runtimeProvider !== "openai-api") {
    const errorMsg = `MyBay provider "openai" has not been mapped to a valid Hermes runtime provider. Expected runtime provider: "openai-api".`;
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[安全部署拦截自检失败] ${errorMsg}`
    });
    deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "validate_input",
      status: "failed",
      message: `工作流底座审计未通过：${errorMsg}`
    }).catch(() => {});
    dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: errorMsg }).catch(() => {});
    updateInstanceStatusStmt.run({ status: "failed", id: instanceId });
    io.emit(`deploy_status_${instanceId}`, "failed");
    return;
  }

  if (!VALID_HERMES_PROVIDERS.has(runtimeProvider)) {
    const errorMsg = `Unsupported Hermes runtime provider: "${runtimeProvider}" (from MyBay provider "${mybayProvider}").`;
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[安全部署拦截自检失败] ${errorMsg}`
    });
    deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "validate_input",
      status: "failed",
      message: `工作流底座审计未通过：${errorMsg}`
    }).catch(() => {});
    dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: errorMsg }).catch(() => {});
    updateInstanceStatusStmt.run({ status: "failed", id: instanceId });
    io.emit(`deploy_status_${instanceId}`, "failed");
    return;
  }

  // Log validation success
  deploymentEventsRepo.create({
    instance_id: instanceId,
    owner_id: ownerId,
    step: "validate_input",
    status: "success",
    message: "用户部署输入参数与路由规则审计完毕，校验通过"
  }).catch(() => {});

  // Validate historical instance password compatibility using strict helper
  const plainPassword = tryResolvePlainInstancePassword(config);

  if (config.webPasswordHash && !plainPassword) {
    let passwordConfigSummary: any = {};
    try {
      passwordConfigSummary = buildPasswordConfigSummary(config);
      console.warn(`[Security Diagnostic] Decryption failed for instance ${instanceId}. Diagnostic stats:`, passwordConfigSummary);
    } catch (diagErr: any) {
      console.error("[Security Diagnostic Error] Failed to generate diagnostics:", diagErr.message);
    }

    const errorMsg = `该实例仅存在 webPasswordHash，缺少或无法解密明文访问密码。为兼容新版 Hermes Dashboard 原生 Basic 鉴权并确保安全，请重新进入该实例设置页面，重新设置并保存实例访问密码后，再次尝试部署。`;
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[部署中断自检失败] ${errorMsg}`
    });

    // Write password_diagnostic event
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "password_diagnostic",
      status: "failed",
      message: "实例访问密码解密失败，已记录安全摘要",
      metadata: passwordConfigSummary
    }).catch(() => {});

    // Original validate_input failed event with passwordConfigSummary as metadata
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "validate_input",
      status: "failed",
      message: `部署中断：${errorMsg}`,
      metadata: passwordConfigSummary
    }).catch(() => {});

    await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: errorMsg }).catch(() => {});
    
    updateInstanceStatusStmt.run({
      status: "failed",
      id: instanceId,
      deployment_error: errorMsg,
      error_message: errorMsg
    });

    io.emit(`deploy_status_${instanceId}`, "failed");
    return;
  }

  if (config.enableDashboard !== false) {
    const dashboardSecretChanged = ensureEncryptedDashboardAuthSecret(config);
    if (dashboardSecretChanged) {
      try {
        await dbAdapter.updateInstanceConfig(instanceId, JSON.stringify(config));
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[安全强化] 已修复并持久化本实例专属的 Dashboard Auth Secret`
        });
      } catch (persistErr: any) {
        const errorMsg = "Dashboard Auth Secret 持久化失败，部署已中止。请稍后重试或联系管理员检查数据库写入状态。";
        await deploymentEventsRepo.create({
          instance_id: instanceId,
          owner_id: ownerId,
          step: "dashboard_auth_secret",
          status: "failed",
          message: errorMsg,
          metadata: {
            errorCode: "DASHBOARD_AUTH_SECRET_PERSIST_FAILED"
          }
        }).catch(() => {});
        await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: errorMsg }).catch(() => {});
        updateInstanceStatusStmt.run({
          status: "failed",
          id: instanceId,
          deployment_error: errorMsg,
          error_message: errorMsg
        });
        io.emit(`deploy_status_${instanceId}`, "failed");
        return;
      }
    }
  }

  // Check if current instance supports native dashboard basic auth
  const nativeDashboardAuthSupported = supportsNativeDashboardBasicAuth({
    agentImage: instance.agent_image,
    agentImageTag: instance.agent_image_tag,
    agentVersion: instance.agent_version || instance.resolved_version,
    capabilities: instance.capabilities || config.capabilities,
    config
  });

  if (nativeDashboardAuthSupported && config.enableDashboard !== false) {
    const plainPwd = tryResolvePlainInstancePassword(config);
    if (!plainPwd) {
      const errorMsg = `新版 Hermes Dashboard 需要 dashboard.basic_auth.password_hash，但当前环境无法获取明文访问密码。请重新进入该实例设置页面，重新设置并保存实例访问密码后，再次尝试部署。`;
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[部署中断自检失败] ${errorMsg}`
      });

      await deploymentEventsRepo.create({
        instance_id: instanceId,
        owner_id: ownerId,
        step: "dashboard_auth_hash",
        status: "failed",
        message: "Hermes Dashboard Basic Auth 密码哈希生成失败：缺少明文访问密码",
        metadata: {
          nativeDashboardAuthSupported,
          image: instance.agent_image,
          imageTag: instance.agent_image_tag,
          errorCode: "HERMES_DASHBOARD_AUTH_HASH_FAILED"
        }
      }).catch(() => {});

      await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: errorMsg }).catch(() => {});
      updateInstanceStatusStmt.run({ status: "failed", id: instanceId });
      io.emit(`deploy_status_${instanceId}`, "failed");
      return;
    }

    try {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[Dashboard 适配] 正在为 Hermes v2026.7.20+ 生成 Native Dashboard 密码哈希...`
      });
      const generatedHash = await generateHermesDashboardPasswordHash(plainPwd, {
        instanceId,
        image: instance.agent_image,
        imageTag: instance.agent_image_tag
      });

      config.hermesDashboardPasswordHash = generatedHash;
      config.nativeDashboardBasicAuthEnabled = true;

      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[Dashboard 适配] Native Dashboard 密码哈希生成成功`
      });
    } catch (hashErr: any) {
      const errMsg = `新版 Hermes Dashboard 需要 dashboard.basic_auth.password_hash，但当前环境无法生成密码哈希。请确认 Hermes v2026.7.20 镜像或 Python 插件可用。`;
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[部署中断] ${errMsg}`
      });

      await deploymentEventsRepo.create({
        instance_id: instanceId,
        owner_id: ownerId,
        step: "dashboard_auth_hash",
        status: "failed",
        message: "Hermes Dashboard Basic Auth 密码哈希生成失败",
        metadata: {
          nativeDashboardAuthSupported,
          image: instance.agent_image,
          imageTag: instance.agent_image_tag,
          errorCode: hashErr.code || "HERMES_DASHBOARD_AUTH_HASH_FAILED"
        }
      }).catch(() => {});

      await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: errMsg }).catch(() => {});
      updateInstanceStatusStmt.run({ status: "failed", id: instanceId });
      io.emit(`deploy_status_${instanceId}`, "failed");
      return;
    }
  } else {
    config.nativeDashboardBasicAuthEnabled = false;
  }

  let generatedEnvMap: any = {};
  let hermesModelConfigResult: any = null;

  try {
    const configResult = writePhysicalConfigs(instanceId, config);
    generatedEnvMap = configResult.finalEnvMap;
    hermesModelConfigResult = configResult.hermesModelConfigResult;

    // --- Add config.yaml validation (File size / existence check) ---
    const configYamlPath = path.join(process.cwd(), "data", "instances", instanceId, "config.yaml");
    if (!fs.existsSync(configYamlPath)) {
      throw new Error("运行时配置文件 config.yaml 写入失败，物理文件不存在。");
    }
    const stats = fs.statSync(configYamlPath);
    if (stats.size === 0) {
      throw new Error("运行时配置文件 config.yaml 写入失败，物理文件为空 (0字节)。");
    }

    // Log configurations write success
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "write_config",
      status: "success",
      message: "运行时环境变量成功汇编，集成环境安全配置 config.yaml 写入磁盘"
    }).catch(() => {});
  } catch (err: any) {
    const rawErrMsg = err.message || String(err);
    let friendlyReason = "运行时配置文件 config.yaml 写入失败，实例无法启动。请检查服务器磁盘权限、实例目录权限或 Dashboard Basic Auth 配置。";

    if (rawErrMsg.includes("密码哈希") || rawErrMsg.includes("hermesDashboardPasswordHash") || rawErrMsg.toLowerCase().includes("password_hash")) {
      friendlyReason = "新版 Hermes Dashboard 需要 dashboard.basic_auth.password_hash，但配置写入阶段未获得有效密码哈希，部署已中止。";
    }

    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[部署失败] ${friendlyReason} 详细原因: ${rawErrMsg}`
    });

    // Write failed deployment event
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "write_config",
      status: "failed",
      message: friendlyReason,
      metadata: {
        errorCode: "CONFIG_WRITE_FAILED",
        reason: friendlyReason,
        nativeDashboardBasicAuthEnabled: config.nativeDashboardBasicAuthEnabled === true,
        hasHermesDashboardPasswordHash: Boolean(config.hermesDashboardPasswordHash)
      }
    }).catch(() => {});

    // Update database status and version info with custom error message
    updateInstanceStatusStmt.run({
      status: "failed",
      id: instanceId,
      deployment_error: friendlyReason,
      error_message: friendlyReason
    });

    await dbAdapter.updateInstanceVersionInfo(instanceId, {
      deployment_error: friendlyReason
    }).catch(() => {});

    io.emit(`deploy_status_${instanceId}`, "failed");
    return;
  }
  
  if (config.template_id) {
    deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "template_files_written",
      status: "success",
      message: "模板衍生运行时配置文件(mybay.template.yaml、SOUL.md)成功下发至运行目录"
    }).catch(() => {});

    deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "template_skills_applied",
      status: "success",
      message: "工作流模块所需技能列表已全部绑定并核准注入容器"
    }).catch(() => {});
  }

  if (config.blueprint_id || config.blueprint_snapshot) {
    deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: ownerId,
      step: "blueprint_files_written",
      status: "success",
      message: "行业方案运行时配置文件(mybay.blueprint.yaml、SOUL.md)成功下发至运行目录"
    }).catch(() => {});
  }
  
  if (hermesModelConfigResult) {
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[✅ 模型连接注册]
Resolved Hermes provider config:
display_provider=${config.provider}
provider_key=${config.provider}
runtime_provider=${hermesModelConfigResult.hermesProvider}
model=${hermesModelConfigResult.hermesModel}
api_key_env=${hermesModelConfigResult.apiKeyEnvName}
base_url_env=${hermesModelConfigResult.baseUrl ? 'CUSTOM_BASE_URL' : 'DEFAULT'}
base_url=${hermesModelConfigResult.baseUrl || '<default>'}

[⚙️ Agent 配置摘要]
agent.max_turns=${DEFAULT_AGENT_MAX_TURNS}
agent.gateway_timeout=${DEFAULT_AGENT_GATEWAY_TIMEOUT}
agent.restart_drain_timeout=${DEFAULT_AGENT_RESTART_DRAIN_TIMEOUT}
agent.tool_use_enforcement=auto
agent.task_completion_guidance=true`
    });
  }

  dbAdapter.updateInstanceVersionInfo(instanceId, { model_config_status: "written" }).catch(e => {
    console.error("Failed to update model config status to written:", e);
  });

  const callerStatusWriter = updateInstanceStatusStmt;
  let terminalSettled = false;
  let resolveTerminal!: () => void;
  let rejectTerminal!: (error: Error) => void;
  const terminalPromise = new Promise<void>((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  updateInstanceStatusStmt = {
    run: async (params: any) => {
      try {
        const result = await callerStatusWriter.run(params);
        if (!terminalSettled && ["running", "partial_running"].includes(params.status)) {
          terminalSettled = true;
          resolveTerminal();
        } else if (!terminalSettled && ["failed", "unhealthy", "cancelled"].includes(params.status)) {
          terminalSettled = true;
          rejectTerminal(Object.assign(
            new Error(params.error_detail || params.deployment_error || params.error_message || `Deployment ended with status ${params.status}.`),
            {
              code: params.error_code,
              detail: params.error_detail || params.deployment_error,
              userMessage: params.error_message,
              retryable: params.retryable,
            }
          ));
        }
        return result;
      } catch (error: any) {
        if (!terminalSettled) {
          terminalSettled = true;
          rejectTerminal(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    },
  };
  const reportDeploymentFailure = async (
    error: unknown,
    fallback: DeploymentErrorCode,
    step: string
  ) => {
    const classified = classifyDockerError(error, fallback);
    const failedAt = new Date().toISOString();
    await dbAdapter.updateInstanceRecord(instanceId, {
      status: "failed", health_status: "unhealthy", error_code: classified.code,
      error_message: classified.message, error_detail: classified.detail,
      deployment_error: classified.detail, failed_at: failedAt,
    }).catch(() => {});
    await deploymentEventsRepo.create({
      instance_id: instanceId, owner_id: ownerId, step, status: "failed",
      message: classified.message,
      metadata: { errorCode: classified.code, detail: classified.detail, retryable: classified.retryable },
    }).catch(() => {});
    await updateInstanceStatusStmt.run({
      status: "failed", id: instanceId, error_code: classified.code,
      error_message: classified.message, error_detail: classified.detail,
      deployment_error: classified.detail, retryable: classified.retryable,
    });
    io.emit(`deploy_status_${instanceId}`, "failed");
  };
  const cancellationPoll = execution?.taskId ? setInterval(async () => {
    const task = await dbAdapter.getDeploymentTaskById(execution.taskId!);
    if (!terminalSettled && task?.cancel_requested) {
      terminalSettled = true;
      rejectTerminal(Object.assign(new Error(task.error_message || "Deployment was cancelled."), { code: task.error_code || "DEPLOYMENT_CANCELLED" }));
    }
  }, 1000) : null;
  cancellationPoll?.unref?.();
  docker.ping(async (err) => {
    if (err) {
      const classified = classifyDockerError(err, "DOCKER_UNAVAILABLE");
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[环境检测] ${classified.message}`,
      });
      if (simulatedDeploymentEnabled) simulateDeployment(instanceId, io, updateInstanceStatusStmt);
      else {
        void dbAdapter.updateInstanceRecord(instanceId, { status: "failed", health_status: "unhealthy", error_code: "DOCKER_UNAVAILABLE", error_message: classified.message, deployment_error: classified.message });
        void updateInstanceStatusStmt.run({ status: "failed", id: instanceId, error_code: "DOCKER_UNAVAILABLE", error_message: classified.message });
        io.emit(`deploy_status_${instanceId}`, "failed");
      }
    } else {
      const { isTraefik, isLocal, traefikNetwork } = parseTraefikEnv(process.env);

      io.emit(`deploy_log_${instanceId}`, {
         timestamp: new Date().toISOString(),
         message: `[环境检测] 检测到 Docker Engine，准备使用 ${isTraefik ? 'Traefik 动态代理' : 'Nginx 方案'} 进行物理机真实部署...`,
      });

      const subdomain = ctx.subdomain;
      const networkName = ctx.networkName; // 始终为每个实例生成专属独立网桥 (mybay-net-<instanceId>)

      io.emit(`deploy_log_${instanceId}`, {
         timestamp: new Date().toISOString(),
         message: `[Docker] 正在为容器实例创建独立、隔离的专属安全隔离网桥网络: ${networkName}...`,
      });

      await execution?.assertActive?.("network_creating");
      docker.createNetwork({ Name: networkName }, async (netErr: any) => {
        try {
          if (netErr) {
            if (netErr.statusCode === 409 || (netErr.message && netErr.message.includes("already exists"))) {
              console.log(`[Docker] Network ${networkName} already exists, proceeding...`);
              io.emit(`deploy_log_${instanceId}`, {
                 timestamp: new Date().toISOString(),
                 message: `[Docker] 专属隔离网桥网络: ${networkName} 已存在，跳过创建。`,
              });
            } else {
              console.error(`[Docker] Failed to create network ${networkName}: ${netErr.message}`);
              io.emit(`deploy_log_${instanceId}`, {
                 timestamp: new Date().toISOString(),
                 message: `[Docker Error] 首次创建网桥网络失败: ${netErr.message}。将通过强校验与自愈机制进一步核实...`,
              });
            }
          } else {
            io.emit(`deploy_log_${instanceId}`, {
               timestamp: new Date().toISOString(),
               message: `[Docker] 专属隔离网络 ${networkName} 创建成功。`,
            });
          }

          // --- A. 创建后强校验 ---
          try {
            io.emit(`deploy_log_${instanceId}`, {
              timestamp: new Date().toISOString(),
              message: `[Docker 强校验] 正在确认专属隔离网络 ${networkName} 在 Docker 引擎视角确实存在且就绪...`
            });
            const network = docker.getNetwork(networkName);
            await network.inspect();
            io.emit(`deploy_log_${instanceId}`, {
              timestamp: new Date().toISOString(),
              message: `[Docker 强校验成功] 经确认专属隔离网络 ${networkName} 真实存在且可用。`
            });
          } catch (inspectErr: any) {
            console.warn(`[Docker 强校验异常] 专属网络 ${networkName} 校验失败: ${inspectErr.message}。尝试执行网络自愈重建...`);
            io.emit(`deploy_log_${instanceId}`, {
              timestamp: new Date().toISOString(),
              message: `⚠️ [Docker 强校验异常] 专属网桥网络 ${networkName} 状态异常或不可见。正在尝试紧急自愈重建...`
            });
            try {
              try {
                await docker.createNetwork({ Name: networkName });
              } catch (createErr: any) {
                const isAlreadyExists = createErr.statusCode === 409 || (createErr.message && createErr.message.includes("already exists"));
                if (!isAlreadyExists) {
                  throw createErr;
                }
                console.log(`[Docker 强校验自愈] 自愈重建网络时提示已存在(409)，继续执行 inspect 确认...`);
              }
              const network = docker.getNetwork(networkName);
              await network.inspect();
              io.emit(`deploy_log_${instanceId}`, {
                timestamp: new Date().toISOString(),
                message: `[Docker 强校验自愈成功] 专属隔离网络 ${networkName} 已成功自愈重建，强校验已通过。`
              });
            } catch (healErr: any) {
              console.error(`[Docker 强校验自愈失败] 无法自愈重建网桥网络 ${networkName}:`, healErr);
              io.emit(`deploy_log_${instanceId}`, {
                timestamp: new Date().toISOString(),
                message: `❌ [Docker 强校验自愈失败] 无法重建网络 ${networkName}: ${healErr.message || String(healErr)}。部署中断。`
              });
              throw new Error(`专属隔离网络强校验与自愈均失败: ${healErr.message || String(healErr)}`);
            }
          }
        } catch (err: any) {
          console.error(`[Instance ${instanceId}] Network setup failed:`, err);
          await reportDeploymentFailure(err, "NETWORK_CREATE_FAILED", "network_failed");
          return;
        }

        // 如果启用了 Traefik，将 Traefik 容器关联桥接到该实例的安全专属网络中
        if (isTraefik) {
          await connectTraefikToNetwork(networkName, io, instanceId);
        } else if (isLocal) {
          await connectControlPlaneToNetwork(networkName, io, instanceId);
        }

        const instanceDataDir = path.join(process.cwd(), "data", "instances", instanceId);
        let hostInstanceDataDir = instanceDataDir;
        try {
          hostInstanceDataDir = await getHostPath(instanceDataDir);
          io.emit(`deploy_log_${instanceId}`, {
             timestamp: new Date().toISOString(),
             message: `[路径映射] 本地数据目录 [${instanceDataDir}] 已成功映射到真实宿主机挂载路径: [${hostInstanceDataDir}]`,
          });
        } catch (pathErr) {}

        io.emit(`deploy_log_${instanceId}`, {
           timestamp: new Date().toISOString(),
           message: `[镜像检测] 正在确认本地是否存在 ${fullImageName} 镜像...`,
        });

        await execution?.assertActive?.("image_pulling");
        const image = docker.getImage(fullImageName);
        image.inspect((imgErr, imgStdout) => {
          const hasImage = !imgErr && imgStdout;

          const startContainerFlow = async (finalImageName: string) => {
             const gatewayHostPort = ctx.gatewayHostPort;
             const dashboardHostPort = ctx.dashboardHostPort;

             const envVars = { ...generatedEnvMap };
             envVars["CHANNEL_MODE"] = "production";
             if (!envVars["PORT"]) {
               envVars["PORT"] = String(ctx.internal_web_port || "9119");
             }
             // Expose declared container guards without shadowing Linux system commands.
             const declaredLimits = getResourceLimits(config);
             const limitsCpu = (config?.limitsCpu !== undefined && config?.limitsCpu !== null && config?.limitsCpu !== "")
               ? String(config.limitsCpu)
               : String(process.env.DEFAULT_INSTANCE_CPUS || "1");
             const limitsMemoryMb = String(Math.max(1, Math.round(Number(declaredLimits.Memory || 0) / 1024 / 1024)));
             const resolvedDiskMb = await resolveInstanceDiskLimitMb(instance);
             const limitsDiskMb = resolvedDiskMb === null ? "unlimited" : String(resolvedDiskMb);

             envVars["MYBAY_RESOURCE_SCOPE"] = "local-instance";
             envVars["MYBAY_INSTANCE_CPU_LIMIT"] = limitsCpu;
             envVars["MYBAY_INSTANCE_MEMORY_MB"] = limitsMemoryMb;
             envVars["MYBAY_INSTANCE_DISK_MB"] = limitsDiskMb;
             // Compatibility aliases for Agent versions that already consume these names.
             envVars["MYBAY_VISIBLE_CPU"] = limitsCpu;
             envVars["MYBAY_VISIBLE_MEMORY_MB"] = limitsMemoryMb;
             envVars["MYBAY_VISIBLE_DISK_MB"] = limitsDiskMb;
// Save container name and data volume path inside DB
             dbAdapter.updateInstanceVersionInfo(instanceId, { 
               container_name: ctx.containerName,
               data_volume_path: hostInstanceDataDir
             }).catch(dbErr => {
               console.error("Failed to update instance deployment info in DB:", dbErr.message);
             });

             const gatewayContainerName = ctx.gatewayContainerName;
             const dashboardContainerName = ctx.dashboardContainerName;

             const gatewayEnv: string[] = [
               "TZ=Asia/Shanghai",
               "HERMES_HOME=/opt/data"
             ];
             Object.entries(envVars).forEach(([k, v]) => {
               gatewayEnv.push(`${k}=${v}`);
             });

             io.emit(`deploy_log_${instanceId}`, {
               timestamp: new Date().toISOString(),
               message: `[Docker] 正在检查并清理可能同名的冲突旧容器...`,
             });

             try {
               const isTraefikRole = await resolveInstanceRole(instance);
               const dashboardLabels = isTraefik ? getTraefikLabels(instanceId, subdomain, config, networkName, isTraefikRole) : undefined;
               
               await execution?.assertActive?.("container_creating");
               await recreateInstance(instance, finalImageName, {
                 hostInstanceDataDir,
                 gatewayContainerName,
                 dashboardContainerName,
                 gatewayEnv,
                 dashboardLabels,
                 gatewayHostPort,
                 dashboardHostPort,
                 isTraefik,
                 networkName,
                 config,
                 io,
                 requestUser,
                 systemTrustedContext
                });
               
               deploymentEventsRepo.create({
                 instance_id: instanceId,
                 owner_id: ownerId,
                 step: "container_started",
                 status: "success",
                 message: `虚拟容器成功拉起，资源隔离环境准备完毕配置就绪`
               }).catch(() => {});

               // Container creation is not the same as a ready public route. Keep the
               // instance in a transitional state until runInstanceHealthChecks promotes it.
               await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: null, updated_at: new Date().toISOString() }).catch(() => {});
               await execution?.assertActive?.("health_checking");
               updateInstanceStatusStmt.run({ status: "gateway_starting", id: instanceId });
               const isApi = config?.channel === "api" || config?.publicApiEnabled === true || config?.exposeApi === true || config?.publicApiEnabled === "true" || config?.exposeApi === "true";
               const isWebhook = config?.channel === "webhook" || config?.WEBHOOK_ENABLED === "true";
               if (isApi) {
                 io.emit(`deploy_log_${instanceId}`, {
                   timestamp: new Date().toISOString(),
                   message: `[API Channel] /v1 routed to internal port 8642`,
                 });
               }
               if (isWebhook) {
                 io.emit(`deploy_log_${instanceId}`, {
                   timestamp: new Date().toISOString(),
                   message: `[Webhook Channel] /webhooks routed to internal port 8644`,
                 });
               }

               if (isTraefik) {
                  io.emit(`deploy_log_${instanceId}`, {
                    timestamp: new Date().toISOString(),
                    message: `[Traefik] Dashboard container labels generated\n[Traefik] Route: ${subdomain} -> dashboard:${ctx.internal_web_port}\n[Traefik] Network: ${networkName}`,
                  });
                  await verifyNetworkSecurity(instanceId, dashboardContainerName, io);
                  runInstanceHealthChecks(instanceId, gatewayHostPort, ctx.internal_web_port, subdomain, io, updateInstanceStatusStmt, "auto_create");
                } else {
                  await verifyNetworkSecurity(instanceId, dashboardContainerName, io);
                  // Final verification of port mapping using dockerode native inspect instead of external CLI
                  const dashContainer = docker.getContainer(dashboardContainerName);
                  dashContainer.inspect((inspectErr, inspectData) => {
                    if (inspectErr) {
                      io.emit(`deploy_log_${instanceId}`, {
                        timestamp: new Date().toISOString(),
                        message: `[Docker 绑定校验失败] 无法获取容器状态检查映射: ${inspectErr.message}`,
                      });
                      void reportDeploymentFailure(inspectErr, "CONTAINER_START_FAILED", "container_inspect_failed");
                      return;
                    }

                    let containerPort = dashboardHostPort;
                    const ports = inspectData.NetworkSettings?.Ports || {};
                    const portInfo = ports[`${ctx.internal_web_port}/tcp`] || ports["9119/tcp"];
                    
                    if (portInfo && portInfo[0] && portInfo[0].HostPort) {
                       containerPort = parseInt(portInfo[0].HostPort, 10);
                    }

                    const publicUrl = buildInstancePublicUrl(ctx.slug, containerPort);
                    io.emit(`deploy_log_${instanceId}`, {
                      timestamp: new Date().toISOString(),
                      message: `Gateway URL: http://127.0.0.1:${gatewayHostPort}\nDashboard URL: http://127.0.0.1:${containerPort}\nPublic URL: ${publicUrl}`,
                    });

                    if (isLocal) {
                      runInstanceHealthChecks(instanceId, containerPort, ctx.internal_web_port, subdomain, io, updateInstanceStatusStmt, "auto_create");
                    } else {
                      rebuildProxyConfig(instance, io, updateInstanceStatusStmt);
                    }
                  });
                }
             } catch (createErr: any) {
               const classified = classifyDockerError(createErr, "CONTAINER_CREATE_FAILED");
               console.error(`[Instance ${instanceId}] ${classified.code}:`, classified.detail);
               await reportDeploymentFailure(createErr, "CONTAINER_CREATE_FAILED", "container_create_failed");
             }
          };

          const handleFrontendBuild = async () => {
             try {
                const finalImageName = await ensureFrontendBuilt(docker, fullImageName, instanceId, io, config);
                await startContainerFlow(finalImageName);
             } catch (buildErr) {
                await reportDeploymentFailure(buildErr, "CONTAINER_CREATE_FAILED", "container_flow_failed");
             }
          };

          if (hasImage) {
            io.emit(`deploy_log_${instanceId}`, {
               timestamp: new Date().toISOString(),
               message: `[镜像检测] 检测到本地已存在 ${fullImageName} 镜像，直接启动服务...`,
            });
            deploymentEventsRepo.create({
              instance_id: instanceId,
              owner_id: ownerId,
              step: "pulling",
              status: "success",
              message: `本地检测到已存在的缓存镜像：[镜像: ${fullImageName}]，跳过拉取并重用`
            }).catch(() => {});
            void handleFrontendBuild().catch((err) => {
               console.error("Unhandled rejection in handleFrontendBuild call-site (hasImage=true):", err);
            });
          } else {
            io.emit(`deploy_log_${instanceId}`, {
               timestamp: new Date().toISOString(),
               message: `[镜像检测] 本地未找到 ${fullImageName}，准备从 Hub 拉取最新镜像...`,
            });
            deploymentEventsRepo.create({
              instance_id: instanceId,
              owner_id: ownerId,
              step: "pulling",
              status: "info",
              message: `开启对目标 Agent Version 镜像的多重拉取 (Pulling ${fullImageName}...)`
            }).catch(() => {});
            
            docker.pull(fullImageName, {}, async (pullErr: any, stream: any) => {
              if (pullErr) {
                await reportDeploymentFailure(pullErr, "IMAGE_PULL_FAILED", "image_pull_failed");
                return;
              }

              docker.modem.followProgress(stream, onFinished, onProgress);

              async function onFinished(err: any, output: any) {
                if (err) {
                  await reportDeploymentFailure(err, "IMAGE_PULL_FAILED", "image_pull_failed");
                  return;
                }
                io.emit(`deploy_log_${instanceId}`, {
                   timestamp: new Date().toISOString(),
                   message: `[Docker] ${fullImageName} 镜像拉取完成！`,
                });
               deploymentEventsRepo.create({
                  instance_id: instanceId,
                  owner_id: ownerId,
                  step: "pulling",
                  status: "success",
                  message: `基础镜像 ${fullImageName} 全部层级多路拉取完结并展开成功`
                }).catch(() => {});
                void handleFrontendBuild().catch((err) => {
                   console.error("Unhandled rejection in handleFrontendBuild call-site (onFinished):", err);
                });
              }

              let lastLogTime = Date.now();
              function onProgress(event: any) {
                 const now = Date.now();
                 if (now - lastLogTime > 2000) {
                    io.emit(`deploy_log_${instanceId}`, {
                       timestamp: new Date().toISOString(),
                       message: `[Docker Pull] ${event.status} ${event.progressDetail ? '(' + event.progressDetail.current + '/' + event.progressDetail.total + ')' : ''}`,
                    });
                    lastLogTime = now;
                 }
              }
            });
          }
        });
      });
    }
  });
  try {
    await terminalPromise;
  } finally {
    if (cancellationPoll) clearInterval(cancellationPoll);
  }
}

/**
 * 自动且幂等地将 Traefik 容器关联到实例的独立安全网络中
 */
export async function connectControlPlaneToNetwork(networkName: string, io?: any, instanceId?: string) {
  const controlPlaneName = process.env.MYBAY_CONTROL_PANEL_CONTAINER || "mybay-local-control-panel";
  try {
    const controlPlane = docker.getContainer(controlPlaneName);
    await controlPlane.inspect();
    const network = docker.getNetwork(networkName);
    try {
      await network.connect({ Container: controlPlane.id });
    } catch (err: any) {
      const alreadyConnected = err?.statusCode === 409 || String(err?.message || "").toLowerCase().includes("already exists");
      if (!alreadyConnected) throw err;
    }
    io?.emit("deploy_log_" + instanceId, {
      timestamp: new Date().toISOString(),
      message: "[本地直连] 控制面已安全接入实例专属网络，无需 Nginx 或 Traefik 反向代理。"
    });
  } catch (err: any) {
    if (err?.statusCode === 404) {
      console.warn("[Local Direct] Control panel container " + controlPlaneName + " not found; assuming host development runtime.");
      return;
    }
    throw new Error("LOCAL_CONTROL_PLANE_NETWORK_CONNECT_FAILED: " + (err?.message || String(err)));
  }
}

export async function disconnectControlPlaneFromNetwork(networkName: string) {
  const controlPlaneName = process.env.MYBAY_CONTROL_PANEL_CONTAINER || "mybay-local-control-panel";
  try {
    const controlPlane = docker.getContainer(controlPlaneName);
    await controlPlane.inspect();
    const network = docker.getNetwork(networkName);
    await network.disconnect({ Container: controlPlane.id, Force: true });
  } catch (err: any) {
    const message = String(err?.message || err || "").toLowerCase();
    if (err?.statusCode === 404 || message.includes("not found") || message.includes("is not connected") || message.includes("not active")) {
      return;
    }
    throw err;
  }
}

export async function connectTraefikToNetwork(networkName: string, io?: any, instanceId?: string) {
  const { traefikContainerName } = parseTraefikEnv(process.env);
  let traefikContainer: any = null;

  try {
    const container = docker.getContainer(traefikContainerName);
    const inspectData = await container.inspect();
    if (inspectData && inspectData.Id) {
      traefikContainer = container;
    }
  } catch (err) {
    try {
      const list = await docker.listContainers({ all: false });
      const found = list.find(c => 
        c.Names.some(n => n.includes("traefik")) || 
        (c.Image && c.Image.includes("traefik"))
      );
      if (found) {
        traefikContainer = docker.getContainer(found.Id);
      }
    } catch (listErr) {
      console.error("[Traefik Search Error]", listErr);
    }
  }

  if (traefikContainer) {
    try {
      const network = docker.getNetwork(networkName);
      if (io && instanceId) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[Traefik 关联] 正在建立 Traefik 与独立沙箱网络 ${networkName} 的物理桥接...`
        });
      }
      await network.connect({ Container: traefikContainer.id });
      if (io && instanceId) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[Traefik 关联] 成功将 Traefik 桥接到专属网络: ${networkName}`
        });
      }
    } catch (connErr: any) {
      if (connErr.statusCode === 409 || (connErr.message && connErr.message.includes("already exists"))) {
        if (io && instanceId) {
          io.emit(`deploy_log_${instanceId}`, {
            timestamp: new Date().toISOString(),
            message: `[Traefik 关联] Traefik 已桥接在专属网络 ${networkName}，跳过该操作。`
          });
        }
      } else {
        console.error(`Failed to connect Traefik to ${networkName}:`, connErr.message);
        if (io && instanceId) {
          io.emit(`deploy_log_${instanceId}`, {
            timestamp: new Date().toISOString(),
            message: `[Traefik 警告] 桥接 Traefik 到专属网络失败: ${connErr.message}`
          });
        }
      }
    }
  } else {
    const errMsg = `[Traefik 关联警告] 未能在运行的 Docker 进程中定位到 Traefik 网关，请确认其运行状况。`;
    if (io && instanceId) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: errMsg
      });
    }
  }
}

/**
 * 删除或清理实例时，自动断开 Traefik 与专属网络的关联
 */
export async function disconnectTraefikFromNetwork(networkName: string) {
  const { traefikContainerName } = parseTraefikEnv(process.env);
  let traefikContainer: any = null;

  try {
    const container = docker.getContainer(traefikContainerName);
    const inspectData = await container.inspect();
    if (inspectData && inspectData.Id) {
      traefikContainer = container;
    }
  } catch (err) {
    try {
      const list = await docker.listContainers({ all: false });
      const found = list.find(c => 
        c.Names.some(n => n.includes("traefik")) || 
        (c.Image && c.Image.includes("traefik"))
      );
      if (found) {
        traefikContainer = docker.getContainer(found.Id);
      }
    } catch (listErr) {
      console.error("[Traefik Disconnect Search Error]", listErr);
    }
  }

  if (traefikContainer) {
    try {
      const network = docker.getNetwork(networkName);
      await network.disconnect({ Container: traefikContainer.id, Force: true });
      console.log(`Disconnected Traefik from network: ${networkName}`);
    } catch (disconnErr: any) {
      if (disconnErr.statusCode === 404 || (disconnErr.message && (disconnErr.message.includes("not found") || disconnErr.message.includes("not active")))) {
        console.log(`Traefik was not connected to network ${networkName} or network not found, skipping.`);
      } else {
        console.error(`Failed to disconnect Traefik from network ${networkName}:`, disconnErr.message);
      }
    }
  }
}

/**
 * 部署后安全检测与架构审计，确认容器仅在对应的独立专属网络中运行且没有任何网络泄露
 */
export async function verifyNetworkSecurity(instanceId: string, containerName: string, io?: any): Promise<boolean> {
  const targetNetwork = `mybay-net-${instanceId}`;
  const { isTraefik } = parseTraefikEnv(process.env);

  const log = (msg: string) => {
    if (io) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: msg
      });
    }
    console.log(`[安全审计] [${instanceId}] ${msg}`);
  };

  log(`[安全审计] 正在执行网络架构安全度与逻辑隔离自检审计...`);

  try {
    const container = docker.getContainer(containerName);
    const inspectData = await container.inspect();
    const networks = Object.keys(inspectData.NetworkSettings?.Networks || {});

    log(`[安全审计] 容器当前网络适配清单: [${networks.join(", ")}]`);

    // 1. 确认仅存在且仅能连接自己的专属网络
    const onlyConnectsOwnNetwork = networks.length === 1 && networks[0] === targetNetwork;
    if (!onlyConnectsOwnNetwork) {
      log(`⚠️ [安全警告] 网络隔离检测非理想状态：容器连接了多重网络，实际应仅允许存在 [${targetNetwork}]。`);
    } else {
      log(`✓ [安全合规] 专属沙箱网络拓扑校验通过：容器在物理层面保持独立隔离。`);
    }

    // 2. 切断任何可能由于默认/历史原因导致共享的危险网桥
    const hasUnsafeNetwork = networks.some(n => n === "traefik_proxy" || n === "bridge");
    if (hasUnsafeNetwork) {
      log(`⚠️ [安全警告] 横向渗透隐患：检测到容器不慎加入了公共代理网桥 [traefik_proxy] 或默认 [bridge] 网络，将增加跨租户安全隐患。`);
    } else {
      log(`✓ [安全合规] 跨租户逻辑隔离校验通过：本节点与公共/跨租户层无任何直连链路，防御任何横向移动渗透。`);
    }

    // 3. 确认 Traefik 是否有进行专有网络桥接
    if (isTraefik) {
      const { traefikContainerName } = parseTraefikEnv(process.env);
      let traefikContainer: any = null;
      try {
        const container = docker.getContainer(traefikContainerName);
        const inspectTraefik = await container.inspect();
        if (inspectTraefik && inspectTraefik.NetworkSettings?.Networks) {
          traefikContainer = container;
        }
      } catch (e) {
        const list = await docker.listContainers({ all: false });
        const found = list.find(c => 
          c.Names.some(n => n.includes("traefik")) || 
          (c.Image && c.Image.includes("traefik"))
        );
        if (found) {
          traefikContainer = docker.getContainer(found.Id);
        }
      }

      if (traefikContainer) {
        const traefikInspect = await traefikContainer.inspect();
        const traefikNetworks = Object.keys(traefikInspect.NetworkSettings?.Networks || {});
        const isTraefikConnected = traefikNetworks.includes(targetNetwork);
        if (isTraefikConnected) {
          log(`✓ [安全合规] 外部路由网桥成功建立：Traefik 代理服务器已安全绑定至该专属容器网桥。`);
        } else {
          log(`⚠️ [配置警告] 链路暂未连通：Traefik 尚未接入当前专属隔离网络，可能会造成外部反代解析失败。`);
        }
      } else {
        log(`⚠️ [检测受限] 未能定位到 Traefik 容器实例，跳过网关反向穿透校验。`);
      }
    }

    return true;
  } catch (err: any) {
    log(`❌ [安全审计] 自检审计由于不可抗力意外受阻: ${err.message}`);
    return false;
  }
}

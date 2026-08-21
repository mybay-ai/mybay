import { docker } from "./lib/docker";
import path from "path";
import fs from "fs";
import { Server as SocketIOServer } from "socket.io";
import { dbAdapter } from "./db";
import { buildDeploymentContext } from "./deploymentContext";
import { writePhysicalConfigs } from "./configWriter";
import { getHostPath, buildDockerHostConfig, createGatewayContainer, createDashboardContainer, ensureFrontendBuilt } from "./dockerDeployment";
import { getTraefikLabels } from "./proxy/traefik";
import { parseTraefikEnv } from "./infrastructure/traefik/traefikConfig";
import { runInstanceHealthChecks } from "./healthCheck";
import { rebuildProxyConfig } from "./proxy/nginx";
import { resolveInstanceRole } from "./utils/instanceRole";

import { globalTaskSemaphore } from "./utils";
import { supportsFeishu } from "./utils/hermesCapabilities";
import { sortHermesVersionsDescending } from "../shared/version";
import {
  INSTANCE_OPERATION_IN_PROGRESS,
  instanceOperationCoordinator,
  type InstanceOperation,
} from "./services/instances/instanceOperationCoordinator";

type UpgradeOperationResult = { success: boolean; error?: string };

async function withInstanceUpgradeOperation(
  instanceId: string,
  operation: Extract<InstanceOperation, "upgrade" | "rollback">,
  work: () => Promise<UpgradeOperationResult>,
): Promise<UpgradeOperationResult> {
  const acquisition = instanceOperationCoordinator.tryAcquire(instanceId, operation);
  if (acquisition.acquired === false) {
    return {
      success: false,
      error: `${INSTANCE_OPERATION_IN_PROGRESS}: another instance operation is already in progress (${acquisition.active.operation}).`,
    };
  }

  try {
    return await work();
  } finally {
    instanceOperationCoordinator.release(acquisition.lease);
  }
}

const activeUpgrades = new Set<string>();

export async function getUpgradeLogs(instanceId: string) {
  // Return audit logs specifically related to upgrades
  const logs = await dbAdapter.getAuditLogs(instanceId);
  return logs.filter((log: any) => log.action?.includes("upgrade") || log.action?.includes("rollback") || log.action === "upgrade_progress" || log.action === "rollback_progress");
}

async function rollbackInstanceUnlocked(
  instanceId: string,
  userId: string,
  role: string,
  io: SocketIOServer
): Promise<{ success: boolean; error?: string }> {
  if (activeUpgrades.has(instanceId)) {
    return { success: false, error: "该实例上已有正在运行的任务，请稍后再试。" };
  }
  const instance = await dbAdapter.getInstanceById(instanceId);
  if (!instance) {
    return { success: false, error: "实例未找到。" };
  }
  if (instance.user_id !== userId && role !== 'admin') {
    return { success: false, error: "越权操作：您没有权限操作此实例。" };
  }
  const targetTag = instance.previous_image_tag || "latest";
  
  activeUpgrades.add(instanceId);
  try {
    const res = await upgradeInstanceFlow(instance, targetTag, userId, io, true, { id: userId, role });
    activeUpgrades.delete(instanceId);
    return res;
  } catch (err: any) {
    activeUpgrades.delete(instanceId);
    return { success: false, error: err.message || String(err) };
  }
}

export async function rollbackInstance(
  instanceId: string,
  userId: string,
  role: string,
  io: SocketIOServer
): Promise<UpgradeOperationResult> {
  return withInstanceUpgradeOperation(instanceId, "rollback", () =>
    rollbackInstanceUnlocked(instanceId, userId, role, io));
}

export function isFeishuInstance(instance: any): boolean {
  if (!instance) return false;
  let config: any = {};
  if (instance.config_json) {
    try {
      config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : instance.config_json;
    } catch (e) {}
  }

  // 1. Check channel === "feishu" / "lark"
  const channel = config.channel;
  const isChannelFeishu = 
    channel === "feishu" || 
    channel === "lark" || 
    (Array.isArray(channel) && channel.some((ch: any) => ["feishu", "lark"].includes(String(ch).toLowerCase())));

  // 3. Check skills contains feishu or lark skill
  const hasFeishuSkill = 
    Array.isArray(config.skills) && 
    config.skills.some((s: string) => 
      ["feishu", "lark", "feishu_adapter", "lark_adapter"].includes(String(s).toLowerCase())
    );

  return !!(isChannelFeishu || hasFeishuSkill);
}

export function isVersionCompatibleWithFeishu(v: any): boolean {
  return supportsFeishu(v);
}

export async function resolveLatestTag(isFeishu: boolean): Promise<string | null> {
  const versions = sortHermesVersionsDescending(
    await dbAdapter.getMyBayVersions(),
    (version: any) => version.version || version.image_tag || version.tag || ""
  );
  const compatible = isFeishu ? versions.filter(isVersionCompatibleWithFeishu) : versions;
  const selected = compatible.find((version: any) => version.is_latest === 1 || version.is_latest === true)
    || compatible.find((version: any) => !version.is_prerelease)
    || compatible[0];
  return selected ? (selected.version || selected.image_tag || selected.tag) : null;
}

export async function validateUpgradeTag(
  instanceId: string,
  targetTag: string
): Promise<{ success: boolean; error?: string; code?: string; resolvedTag?: string }> {
  const instance = await dbAdapter.getInstanceById(instanceId);
  if (!instance) {
    return { success: false, error: "实例未找到。", code: "INSTANCE_NOT_FOUND" };
  }

  const isFeishu = isFeishuInstance(instance);
  let resolvedTag = targetTag;
  let vObj: any = null;

  const versions = await dbAdapter.getMyBayVersions();

  if (targetTag === "latest") {
    const resolved = await resolveLatestTag(isFeishu);
    if (!resolved) {
      if (isFeishu) {
        return { 
          success: false, 
          error: "升级已被拦截：当前实例启用了飞书/Lark，但未能在管理控制台的版本库中找到任何支持 Feishu 能力的镜像版本。请前往版本管理同步或手动创建飞书兼容版！", 
          code: "INCOMPATIBLE_AGENT_VERSION" 
        };
      } else {
        return { 
          success: false, 
          error: "升级已被拦截：未能在版本库中找到任何可用的镜像版本。", 
          code: "NO_VERSIONS_AVAILABLE" 
        };
      }
    }
    resolvedTag = resolved;
    vObj = versions.find((v: any) => v.version === resolvedTag);
    if (!vObj) {
      vObj = versions.find((v: any) => v.image_tag === resolvedTag || v.tag === resolvedTag);
    }
  } else {
    vObj = versions.find((version: any) =>
      version.version === targetTag || version.image_tag === targetTag || version.tag === targetTag
    );
    resolvedTag = vObj ? (vObj.version || vObj.image_tag || vObj.tag) : targetTag;
  }

  if (!vObj) {
    return {
      success: false,
      error: `目标升级版本 [${resolvedTag}] 在版本库中未找到。`,
      code: "VERSION_NOT_FOUND"
    };
  }

  if (isFeishu) {
    const isCompatible = isVersionCompatibleWithFeishu(vObj);
    if (!isCompatible) {
      return {
        success: false,
        error: `升级已被拦截：当前实例启用了飞书/Lark，而目标升级版本 [${resolvedTag}] 不支持 Feishu 能力体系（缺少 lark-oapi、aiohttp、websockets 依赖，这会导致通信信道立即失效）。请选用支持飞书的专属版本！`,
        code: "INCOMPATIBLE_AGENT_VERSION"
      };
    }
  }

  return { success: true, resolvedTag };
}

export async function validateBulkUpgrade(
  instanceIds: string[],
  targetTag: string
): Promise<{ success: boolean; error?: string; code?: string }> {
  for (const id of instanceIds) {
    const res = await validateUpgradeTag(id, targetTag);
    if (!res.success) {
      return {
        success: false,
        error: `批量升级已被拦截，实例升级校验发生异常：${res.error}`,
        code: res.code
      };
    }
  }
  return { success: true };
}

async function upgradeInstanceUnlocked(
  instanceId: string,
  targetTag: string,
  userId: string,
  role: string,
  io: SocketIOServer
): Promise<{ success: boolean; error?: string }> {
  if (activeUpgrades.has(instanceId)) {
    return { success: false, error: "该实例上已有正在运行的升级/回滚任务，请勿重复操作。" };
  }

  const instance = await dbAdapter.getInstanceById(instanceId);
  if (!instance) {
    return { success: false, error: "实例未找到。" };
  }

  if (instance.user_id !== userId && role !== 'admin') {
    return { success: false, error: "越权操作：您没有权限升级此实例。" };
  }

  // Ensure robust validation run inside background loop too
  const isFeishu = isFeishuInstance(instance);
  let resolvedTag = targetTag;
  const versions = await dbAdapter.getMyBayVersions();
  let vObj: any = null;

  if (targetTag === "latest") {
    const resolved = await resolveLatestTag(isFeishu);
    if (!resolved) {
      return { success: false, error: isFeishu ? "升级中断：未找到任何支持飞书能力的镜象版本。" : "未找到可用版本。" };
    }
    resolvedTag = resolved;
  } else {
    vObj = versions.find((version: any) =>
      version.version === targetTag || version.image_tag === targetTag || version.tag === targetTag
    );
    if (!vObj || (isFeishu && !isVersionCompatibleWithFeishu(vObj))) {
      return { success: false, error: "The selected official Hermes version is not compatible with this instance." };
    }
    resolvedTag = vObj.version || vObj.image_tag || vObj.tag;
  }

  activeUpgrades.add(instanceId);
  try {
    const res = await upgradeInstanceFlow(instance, resolvedTag, userId, io, false, { id: userId, role });
    activeUpgrades.delete(instanceId);
    return res;
  } catch (err: any) {
    activeUpgrades.delete(instanceId);
    return { success: false, error: err.message || String(err) };
  }
}

export async function upgradeInstance(
  instanceId: string,
  targetTag: string,
  userId: string,
  role: string,
  io: SocketIOServer
): Promise<UpgradeOperationResult> {
  return withInstanceUpgradeOperation(instanceId, "upgrade", () =>
    upgradeInstanceUnlocked(instanceId, targetTag, userId, role, io));
}

async function upgradeInstanceFlow(
  instance: any,
  targetTag: string,
  userId: string,
  io: SocketIOServer,
  isDirectRollback = false,
  requestUser?: any
): Promise<{ success: boolean; error?: string }> {
  const instanceId = instance.id;
  const previousTag = instance.agent_image_tag || "latest";

  const isFeishu = isFeishuInstance(instance);
  const versions = await dbAdapter.getMyBayVersions();
  let vObj: any = null;

  if (!vObj) {
    vObj = versions.find((v: any) => v.version === targetTag && (isFeishu ? isVersionCompatibleWithFeishu(v) : true));
  }
  if (!vObj) {
    vObj = versions.find((v: any) => (v.image_tag === targetTag || v.tag === targetTag) && (isFeishu ? isVersionCompatibleWithFeishu(v) : true));
  }
  if (!vObj) {
    vObj = versions.find((v: any) => v.version === targetTag);
  }
  if (!vObj) {
    vObj = versions.find((v: any) => v.image_tag === targetTag || v.tag === targetTag);
  }

  const agentImage = vObj?.image || instance.agent_image || process.env.MY_BAY_IMAGE || "nousresearch/hermes-agent";
  const imageTag = vObj?.image_tag || vObj?.tag || targetTag;
  const targetImageFull = `${agentImage}:${imageTag}`;

  // 1. Mark status as upgrading
  await dbAdapter.updateInstanceVersionInfo(instanceId, {
    status: "upgrading",
    upgrade_status: "upgrading",
    last_upgrade_at: new Date().toISOString(),
    previous_image_tag: previousTag
  });
  io.emit("instances_updated", { id: instanceId, status: "upgrading" });

  const logAction = isDirectRollback ? "rollback" : "upgrade";
  const logUpgrade = async (msg: string) => {
    console.log(`[${logAction.toUpperCase()}][${instanceId}] ${msg}`);
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: msg
    });
    await dbAdapter.insertAuditLog({
      instance_id: instanceId,
      action: `${logAction}_progress`,
      user_id: userId,
      timestamp: new Date().toISOString(),
      details: msg
    });
  };

  await logUpgrade(`[${logAction === "upgrade" ? "升级开始" : "回滚开始"}] 正在为您开始实例：${instance.name} 的镜像调度，目标镜像: ${targetImageFull}`);

  // Step 2. Pull target image
  try {
    let shouldPull = true;

    if (vObj?.source === "local_docker") {
      await logUpgrade(`[拉取镜像] 检测到目标版本来源为本机构建/本地 Docker，跳过远程拉取，直接使用本地缓存。`);
      shouldPull = false;
    } else {
      try {
        const localImages = await docker.listImages({ all: false });
        const exists = localImages.some(img => 
          img.RepoTags && img.RepoTags.includes(targetImageFull)
        );
        if (exists) {
          await logUpgrade(`[拉取镜像] 检测到目标镜像已在本机缓存，跳过远程拉取。`);
          shouldPull = false;
        }
      } catch (err: any) {
        console.warn(`[Upgrade] Failed to inspect local images: ${err.message}. Will proceed with pull if needed.`);
      }
    }

    if (shouldPull) {
      await logUpgrade(`[拉取镜像] 本机未找到目标镜像，正在进入全局排队序列并拉取服务层依赖...`);
      const release = await globalTaskSemaphore.acquire();
      try {
        await new Promise<void>((resolve, reject) => {
          docker.pull(targetImageFull, {}, (pullErr: any, stream: any) => {
            if (pullErr) return reject(pullErr);
            docker.modem.followProgress(
              stream,
              (err: any) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        });
      } finally {
        release();
      }
      await logUpgrade(`[拉取镜像] 镜像包 ${targetImageFull} 拉取/检查完成。`);
    } else {
      await logUpgrade(`[拉取镜像] 本地镜像 ${targetImageFull} 检查完成，准备开启部署。`);
    }
  } catch (pullErr: any) {
    const errMsg = `拉取 Docker 新镜像失败: ${pullErr.message || String(pullErr)}`;
    await logUpgrade(`[拉取镜像] ❌ 失败: ${errMsg}`);
    await rollbackFlow(instance, previousTag, errMsg, userId, io);
    return { success: false, error: errMsg };
  }

  // Step 3. Prepare config mapping & variables
  const config = JSON.parse(instance.config_json);
  const ctx = buildDeploymentContext(instance, config);
  const gatewayContainerName = ctx.gatewayContainerName;
  const dashboardContainerName = ctx.dashboardContainerName;

  const { finalEnvMap: envVars } = writePhysicalConfigs(instanceId, config);
  const gatewayEnv: string[] = [
    "TZ=Asia/Shanghai",
    "HERMES_HOME=/opt/data"
  ];
  Object.entries(envVars).forEach(([k, v]) => {
    gatewayEnv.push(`${k}=${v}`);
  });

  const { isTraefik, traefikNetwork } = parseTraefikEnv(process.env);
  const networkName = ctx.networkName; // 始终为每个实例生成专属独立网桥 (mybay-net-<instanceId>)
  const subdomain = ctx.subdomain;
  const gatewayHostPort = ctx.gatewayHostPort;
  const dashboardHostPort = ctx.dashboardHostPort;
  const isTraefikRole = await resolveInstanceRole(instance);
  const dashboardLabels = isTraefik ? getTraefikLabels(instanceId, subdomain, config, networkName, isTraefikRole) : undefined;

  const instanceDataDir = path.join(process.cwd(), "data", "instances", instanceId);
  let hostInstanceDataDir = instanceDataDir;
  try {
    hostInstanceDataDir = await getHostPath(instanceDataDir);
  } catch (pathErr) {}

  // Step 4. Get old containers rename targets
  const oldGateSuffix = `-bak-${Date.now()}`;
  const oldGateName = `${gatewayContainerName}${oldGateSuffix}`;
  const oldDashName = `${dashboardContainerName}${oldGateSuffix}`;

  const gateContainer = docker.getContainer(gatewayContainerName);
  const dashContainer = docker.getContainer(dashboardContainerName);

  // Ensure frontend is built before proceeding - Perform this BEFORE stopping old containers
  let finalUpgradeImage;
  try {
    finalUpgradeImage = await ensureFrontendBuilt(docker, targetImageFull, instanceId, io);
  } catch (buildErr: any) {
    const errMsg = `构建升级镜像失败 (targetImageFull: ${targetImageFull}, instanceId: ${instanceId}): ${buildErr.message || buildErr}`;
    await logUpgrade(`[升级错误] ❌ ${errMsg}`);
    
    // We explicitly do not call rollbackFlow because old containers were not stopped yet.
    // We just mark the upgrade as failed and revert the status to 'running' (assuming it was running before).
    await dbAdapter.updateInstanceVersionInfo(instanceId, {
      status: "running",
      upgrade_status: "failed",
      upgrade_error: errMsg
    });
    
    io.emit("instances_updated", { id: instanceId, status: "running" });
    await logUpgrade(`[升级终止] 旧容器未受影响，实例版本保持不变。`);
    
    return { success: false, error: errMsg };
  }

  // Stop and rename old containers
  await logUpgrade(`[容灾备份] 正在优雅停用并重命名当前的容器实例以便实现无缝物理回滚...`);
  
  let gateExisted = false;
  let dashExisted = false;

  try {
    const existingGate = docker.getContainer(gatewayContainerName);
    const gateInfo = await existingGate.inspect().catch(() => null);
    if (gateInfo) {
      const { dbAdapter } = require("./db");
      await dbAdapter.insertAuditLog({
        instance_id: instanceId,
        action: "stop_container",
        user_id: "system",
        timestamp: new Date().toISOString(),
        details: `upgradeManager backup triggered Docker stop for ${gatewayContainerName}`
      }).catch(() => {});
      await existingGate.stop({ t: 10 }).catch(() => {});
      await existingGate.rename({ name: oldGateName });
      gateExisted = true;
      await logUpgrade(`[容灾备份] 旧版 Gateway 容器重命名成功: ${oldGateName}`);
    }
  } catch (err: any) {
    await logUpgrade(`[容灾备份] 旧版 Gateway 容器可能不存在或重命名失败 (${err.message})。`);
  }

  try {
    const existingDash = docker.getContainer(dashboardContainerName);
    const dashInfo = await existingDash.inspect().catch(() => null);
    if (dashInfo) {
      const { dbAdapter } = require("./db");
      await dbAdapter.insertAuditLog({
        instance_id: instanceId,
        action: "stop_container",
        user_id: "system",
        timestamp: new Date().toISOString(),
        details: `upgradeManager backup triggered Docker stop for ${dashboardContainerName}`
      }).catch(() => {});
      await existingDash.stop({ t: 10 }).catch(() => {});
      await existingDash.rename({ name: oldDashName });
      dashExisted = true;
      await logUpgrade(`[容灾备份] 旧版 Dashboard 容器重命名成功: ${oldDashName}`);
    }
  } catch (err: any) {
    await logUpgrade(`[容灾备份] 旧版 Dashboard 容器可能不存在或重命名失败 (${err.message})。`);
  }

  // Step 4.5 Ensure isolated network is created and Traefik connected if active
  await logUpgrade(`[逻辑网隔离] 正在初始化实例专属安全隔离网络并检查网关动态绑定：${networkName}...`);
  await new Promise<void>((resolveNet) => {
    docker.createNetwork({ Name: networkName }, async (netErr: any) => {
      if (isTraefik) {
        const { connectTraefikToNetwork } = await import("./dockerDeployment");
        await connectTraefikToNetwork(networkName, io, instanceId);
      }
      resolveNet();
    });
  });

  // Step 5. Recreate new containers with the target version
  await logUpgrade(`[创建新节点] 正在构建并载入统一的一体化麦贝容器...`);
  
  let nextCreatedGate: any;
  let nextCreatedDash: any;

  try {
    const hostConfig = await buildDockerHostConfig("single", {
      networkName,
      gatewayHostPort: gatewayHostPort,
      dashboardHostPort: dashboardHostPort,
      hostInstanceDataDir,
      isTraefik,
      instance,
      config,
      requestUser
    });

    nextCreatedDash = await createDashboardContainer(docker, {
      Image: finalUpgradeImage,
      name: dashboardContainerName,
      Env: [
        ...gatewayEnv,
        "PORT=9119",
        "GATEWAY_HEALTH_URL=http://127.0.0.1:8642"
      ],
      Labels: dashboardLabels,
      HostConfig: hostConfig
    });

    await nextCreatedDash.start();
    await logUpgrade(`[创建新节点] 统一运行 of 麦贝容器启动成功！`);

    // Perform network security audit checks
    try {
      const { verifyNetworkSecurity } = await import("./dockerDeployment");
      await verifyNetworkSecurity(instanceId, dashboardContainerName, {
        emit: (evtName: string, data: any) => {
          io.emit(evtName, data);
          if (data && data.message) {
            logUpgrade(`[物理安全审计] ${data.message}`).catch(() => {});
          }
        }
      });
    } catch (secErr: any) {
      console.error("Network security check failed to execute:", secErr);
    }

    // Update started_at in DB
    const startNow = new Date().toISOString();
    await dbAdapter.updateInstanceVersionInfo(instanceId, { started_at: startNow }).catch(e => {
      console.error("Failed to update started_at in DB during upgrade:", e);
    });

    // Keep variables consistent for downstream checks and rollback
    nextCreatedGate = nextCreatedDash;

  } catch (deployErr: any) {
    const errMsg = `部署新容器失败: ${deployErr.message || String(deployErr)}`;
    await logUpgrade(`[创建新节点] ❌ 失败: ${errMsg}`);
    
    // Clean up newly created failed containers if they exist
    if (nextCreatedGate) await nextCreatedGate.remove({ force: true }).catch(() => {});
    if (nextCreatedDash) await nextCreatedDash.remove({ force: true }).catch(() => {});

    // Trigger rollback flow
    await rollbackFlow(instance, previousTag, errMsg, userId, io, oldGateName, oldDashName, gateExisted, dashExisted);
    return { success: false, error: errMsg };
  }

  // Step 6. Perform health check on the new version
  await logUpgrade(`[健康自检] 正在测试新容器节点的端口可用性以及链路通信质量...`);
  try {
    const healthResult = await new Promise<{ success: boolean; err?: string }>((resolve) => {
      setTimeout(async () => {
        try {
          const inspectDash = await nextCreatedDash.inspect();
          const inspectGate = await nextCreatedGate.inspect();

          if (inspectDash.State.Running && inspectGate.State.Running) {
            resolve({ success: true });
          } else {
            resolve({ success: false, err: "服务端口测阻失败或新版容器发生意外崩溃退出" });
          }
        } catch (e: any) {
          resolve({ success: false, err: e.message });
        }
      }, 5000); // 5 sec startup grace
    });

    if (!healthResult.success) {
      throw new Error(healthResult.err);
    }

    await logUpgrade(`[健康自检] ✅ 恭喜！各项端口测压通过，服务健康度：优！`);

    // Clean up temporary old backup containers
    await logUpgrade(`[深度提纯] 正在安全的擦除和回收历史未启用的暂存容器物理资源...`);
    if (gateExisted && oldGateName) {
      await docker.getContainer(oldGateName).remove({ force: true }).catch(() => {});
    }
    if (dashExisted && oldDashName) {
      await docker.getContainer(oldDashName).remove({ force: true }).catch(() => {});
    }

    // Direct proxy refresh to ensure pathing/URL matches perfect
    if (!isTraefik) {
      await rebuildProxyConfig(instance, io, {
        run: async () => {}
      });
    }

    // Resolve runtime version and save to DB
    let resolvedVer = targetTag;
    if (targetTag === "latest") {
      try {
        const latestRow = await dbAdapter.getLatestMyBayVersion();
        if (latestRow) {
          resolvedVer = latestRow.version;
        }
      } catch (err) {
        console.error("Failed to query latest version for resolving 'latest':", err);
      }
    }

    // Save success metadata to DB
    await dbAdapter.updateInstanceVersionInfo(instanceId, {
      status: "running",
      agent_image: agentImage,
      agent_image_tag: imageTag,
      agent_version: resolvedVer,
      resolved_version: resolvedVer,
      upgrade_status: "success",
      upgrade_error: null,
      container_name: dashboardContainerName,
      data_volume_path: hostInstanceDataDir,
      traefik_labels: isTraefik ? JSON.stringify(dashboardLabels) : null
    });
    io.emit("instances_updated", { id: instanceId, status: "running" });

    await logUpgrade(`[执行完成] 🎉 实例 ${instance.name} 已彻底成功调度至镜像 ${targetImageFull}！所有前端访问、端口以及数据资产保持完好且零丢失！`);

  } catch (healthErr: any) {
    const errMsg = `容器健康自检阻断：${healthErr.message || String(healthErr)}`;
    await logUpgrade(`[健康自检] ❌ ${errMsg}`);

    if (nextCreatedGate) await nextCreatedGate.remove({ force: true }).catch(() => {});
    if (nextCreatedDash) await nextCreatedDash.remove({ force: true }).catch(() => {});

    await rollbackFlow(instance, previousTag, errMsg, userId, io, oldGateName, oldDashName, gateExisted, dashExisted);
    return { success: false, error: errMsg };
  }

  return { success: true };
}

async function rollbackFlow(
  instance: any,
  originalTag: string,
  upgradeError: string,
  userId: string,
  io: SocketIOServer,
  oldGateName?: string,
  oldDashName?: string,
  gateExisted = false,
  dashExisted = false
) {
  const instanceId = instance.id;
  const config = JSON.parse(instance.config_json);
  const ctx = buildDeploymentContext(instance, config);
  const gatewayContainerName = ctx.gatewayContainerName;
  const dashboardContainerName = ctx.dashboardContainerName;

  const logRollback = async (msg: string) => {
    console.log(`[ROLLBACK][${instanceId}] ${msg}`);
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: msg
    });
    await dbAdapter.insertAuditLog({
      instance_id: instanceId,
      action: "rollback_progress",
      user_id: userId,
      timestamp: new Date().toISOString(),
      details: msg
    });
  };

  await logRollback(`[回滚介入] ⚠️ 服务在升级期间遭受意外瓶颈，正在执行原子化零数据丢失回滚至原版本: ${originalTag}...`);

  try {
    // 强制清理可能已经创建但失败/卡死的新容器，释放命名空间防止回滚重命名失败
    await Promise.all([
      docker.getContainer(gatewayContainerName).remove({ force: true }).catch(() => {}),
      docker.getContainer(dashboardContainerName).remove({ force: true }).catch(() => {})
    ]);

    if (gateExisted && oldGateName) {
      const oldGate = docker.getContainer(oldGateName);
      await oldGate.rename({ name: gatewayContainerName }).catch((e: any) => {
         console.warn(`Rename back failed for gateway - target probably already exists: ${e.message}`);
      });
      await oldGate.start().catch((e: any) => {
        console.error(`Failed to restart old gateway container:`, e);
      });
      const rollbackStartNow = new Date().toISOString();
      await dbAdapter.updateInstanceVersionInfo(instanceId, { started_at: rollbackStartNow }).catch(() => {});
      await logRollback(`[物理回滚] 原 Gateway 旧版容器已重命名还原并启动成功。`);
    } else {
      await logRollback(`[回滚初始化] 未能探测到原旧版实例镜像, 正在从 ${originalTag} 重新拉起 Gateway 物理节点...`);
    }

    if (dashExisted && oldDashName) {
      const oldDash = docker.getContainer(oldDashName);
      await oldDash.rename({ name: dashboardContainerName }).catch(() => {});
      await oldDash.start().catch((e: any) => {
        console.error(`Failed to restart old dashboard container:`, e);
      });
      await logRollback(`[物理回滚] 原 Dashboard 旧版容器已重命名还原并启动成功。`);
    } else {
      await logRollback(`[回滚初始化] 未能探测到原旧版实例镜像, 正在从 ${originalTag} 重新拉起 Dashboard 物理节点...`);
    }

    // Reload reverse proxy
    const { isTraefik: rollbackIsTraefik } = parseTraefikEnv(process.env);
    if (!rollbackIsTraefik) {
      await rebuildProxyConfig(instance, io, { run: async () => {} });
    }

    await dbAdapter.updateInstanceVersionInfo(instanceId, {
      status: "running",
      upgrade_status: "failed",
      upgrade_error: upgradeError
    });
    io.emit("instances_updated", { id: instanceId, status: "running" });

    await logRollback(`[回滚成功] ✅ 恭喜！链路崩溃防护隔离完成！服务已被完整恢复在先前稳定版本 [${originalTag}]！原前端解析与凭据保持完备！`);

  } catch (rollbackErr: any) {
    const backupCritical = `致命故障：容器回滚出现瓶颈。可能发生了容器名冲突或其他严重异常，建议前往实例设置尝试手工一键“重构反代反流/重新部署”。错误原因: ${rollbackErr.message || String(rollbackErr)}`;
    await logRollback(`[回滚致命错误] ❌ ${backupCritical}`);
    await dbAdapter.updateInstanceVersionInfo(instanceId, {
      status: "failed",
      upgrade_status: "failed",
      upgrade_error: `${upgradeError} | Rollback failed: ${rollbackErr.message}`
    });
    io.emit("instances_updated", { id: instanceId, status: "failed" });
  }
}

export async function bulkUpgrade(
  instanceIds: string[],
  targetTag: string,
  userId: string,
  role: string,
  io: SocketIOServer
): Promise<{ [id: string]: { success: boolean; error?: string } }> {
  const limit = 2; // Maximum concurrent upgrades
  const results: { [id: string]: { success: boolean; error?: string } } = {};
  const queue = [...instanceIds];

  const work = async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      try {
        const res = await upgradeInstance(id, targetTag, userId, role, io);
        results[id] = res;
      } catch (err: any) {
        results[id] = { success: false, error: err.message || String(err) };
      }
    }
  };

  const workers = Array.from({ length: Math.min(limit, queue.length) }, () => work());
  await Promise.all(workers);

  return results;
}

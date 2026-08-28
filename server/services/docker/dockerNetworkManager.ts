import { docker } from "../../lib/docker";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";

async function findTraefikContainer() {
  const { traefikContainerName } = parseTraefikEnv(process.env);
  try {
    const container = docker.getContainer(traefikContainerName);
    const inspectData = await container.inspect();
    if (inspectData?.Id) return container;
  } catch {
    try {
      const list = await docker.listContainers({ all: false });
      const found = list.find((candidate) =>
        candidate.Names.some((name) => name.includes("traefik")) || candidate.Image?.includes("traefik"),
      );
      if (found) return docker.getContainer(found.Id);
    } catch (error) {
      console.error("[Traefik Search Error]", error);
    }
  }
  return null;
}

export async function connectControlPlaneToNetwork(networkName: string, io?: any, instanceId?: string) {
  const controlPlaneName = process.env.MYBAY_CONTROL_PANEL_CONTAINER || "mybay-local-control-panel";
  try {
    const controlPlane = docker.getContainer(controlPlaneName);
    await controlPlane.inspect();
    try {
      await docker.getNetwork(networkName).connect({ Container: controlPlane.id });
    } catch (error: any) {
      const alreadyConnected = error?.statusCode === 409 || String(error?.message || "").toLowerCase().includes("already exists");
      if (!alreadyConnected) throw error;
    }
    io?.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: "[本地直连] 控制面已安全接入实例专属网络，无需 Nginx 或 Traefik 反向代理。",
    });
  } catch (error: any) {
    if (error?.statusCode === 404) {
      console.warn(`[Local Direct] Control panel container ${controlPlaneName} not found; assuming host development runtime.`);
      return;
    }
    throw new Error(`LOCAL_CONTROL_PLANE_NETWORK_CONNECT_FAILED: ${error?.message || String(error)}`);
  }
}

export async function disconnectControlPlaneFromNetwork(networkName: string) {
  const controlPlaneName = process.env.MYBAY_CONTROL_PANEL_CONTAINER || "mybay-local-control-panel";
  try {
    const controlPlane = docker.getContainer(controlPlaneName);
    await controlPlane.inspect();
    await docker.getNetwork(networkName).disconnect({ Container: controlPlane.id, Force: true });
  } catch (error: any) {
    const message = String(error?.message || error || "").toLowerCase();
    if (error?.statusCode === 404 || message.includes("not found") || message.includes("is not connected") || message.includes("not active")) return;
    throw error;
  }
}

export async function connectTraefikToNetwork(networkName: string, io?: any, instanceId?: string) {
  const traefikContainer = await findTraefikContainer();
  if (!traefikContainer) {
    io?.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: "[Traefik 关联警告] 未能在运行的 Docker 进程中定位到 Traefik 网关，请确认其运行状况。",
    });
    return;
  }

  try {
    if (io && instanceId) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[Traefik 关联] 正在建立 Traefik 与独立沙箱网络 ${networkName} 的物理桥接...`,
      });
    }
    await docker.getNetwork(networkName).connect({ Container: traefikContainer.id });
    if (io && instanceId) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[Traefik 关联] 成功将 Traefik 桥接到专属网络: ${networkName}`,
      });
    }
  } catch (error: any) {
    if (error.statusCode === 409 || error.message?.includes("already exists")) {
      if (io && instanceId) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[Traefik 关联] Traefik 已桥接在专属网络 ${networkName}，跳过该操作。`,
        });
      }
      return;
    }
    console.error(`Failed to connect Traefik to ${networkName}:`, error.message);
    if (io && instanceId) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[Traefik 警告] 桥接 Traefik 到专属网络失败: ${error.message}`,
      });
    }
  }
}

export async function disconnectTraefikFromNetwork(networkName: string) {
  const traefikContainer = await findTraefikContainer();
  if (!traefikContainer) return;
  try {
    await docker.getNetwork(networkName).disconnect({ Container: traefikContainer.id, Force: true });
    console.log(`Disconnected Traefik from network: ${networkName}`);
  } catch (error: any) {
    if (error.statusCode === 404 || error.message?.includes("not found") || error.message?.includes("not active")) {
      console.log(`Traefik was not connected to network ${networkName} or network not found, skipping.`);
    } else {
      console.error(`Failed to disconnect Traefik from network ${networkName}:`, error.message);
    }
  }
}

export async function verifyNetworkSecurity(instanceId: string, containerName: string, io?: any): Promise<boolean> {
  const targetNetwork = `mybay-net-${instanceId}`;
  const { isTraefik } = parseTraefikEnv(process.env);
  const log = (message: string) => {
    io?.emit(`deploy_log_${instanceId}`, { timestamp: new Date().toISOString(), message });
    console.log(`[安全审计] [${instanceId}] ${message}`);
  };

  log("[安全审计] 正在执行网络架构安全度与逻辑隔离自检审计...");
  try {
    const inspectData = await docker.getContainer(containerName).inspect();
    const networks = Object.keys(inspectData.NetworkSettings?.Networks || {});
    log(`[安全审计] 容器当前网络适配清单: [${networks.join(", ")}]`);
    if (networks.length === 1 && networks[0] === targetNetwork) {
      log("✓ [安全合规] 专属沙箱网络拓扑校验通过：容器在物理层面保持独立隔离。");
    } else {
      log(`⚠️ [安全警告] 网络隔离检测非理想状态：容器连接了多重网络，实际应仅允许存在 [${targetNetwork}]。`);
    }
    if (networks.some((network) => network === "traefik_proxy" || network === "bridge")) {
      log("⚠️ [安全警告] 横向渗透隐患：检测到容器不慎加入了公共代理网桥 [traefik_proxy] 或默认 [bridge] 网络，将增加跨租户安全隐患。");
    } else {
      log("✓ [安全合规] 跨租户逻辑隔离校验通过：本节点与公共/跨租户层无任何直连链路，防御任何横向移动渗透。");
    }
    if (isTraefik) {
      const traefikContainer = await findTraefikContainer();
      if (traefikContainer) {
        const traefikInspect = await traefikContainer.inspect();
        const traefikNetworks = Object.keys(traefikInspect.NetworkSettings?.Networks || {});
        log(traefikNetworks.includes(targetNetwork)
          ? "✓ [安全合规] 外部路由网桥成功建立：Traefik 代理服务器已安全绑定至该专属容器网桥。"
          : "⚠️ [配置警告] 链路暂未连通：Traefik 尚未接入当前专属隔离网络，可能会造成外部反代解析失败。");
      } else {
        log("⚠️ [检测受限] 未能定位到 Traefik 容器实例，跳过网关反向穿透校验。");
      }
    }
    return true;
  } catch (error: any) {
    log(`❌ [安全审计] 自检审计由于不可抗力意外受阻: ${error.message}`);
    return false;
  }
}

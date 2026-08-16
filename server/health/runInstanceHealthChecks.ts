import fs from "fs";
import path from "path";
import Docker from "dockerode";
import { Server as SocketIOServer } from "socket.io";
import { buildDeploymentContext } from "../deploymentContext";
import { providerRegistry } from "../../shared/providerRegistry";
import { validateYamlConfigContent } from "../providerEnv";
import { dbAdapter } from "../db";
import { decrypt } from "../crypto";
import { deploymentEventsRepo } from "../repositories/deploymentEventsRepo";
import { buildInstancePublicUrl } from "../utils/publicUrl";
import { requestTraefikInternal } from "../utils/traefikInternalRequest";
import { getTraefikRouterName, parseTraefikEnv } from "../infrastructure/traefik/traefikConfig";
import {
  checkContainerPortListening,
  checkFrontendConfigDiagnostic,
  checkFrontendMissingBuild,
  checkHostPortHttp,
  checkMyBayProcessRunning,
  detectDuplicateRunningContainers,
  getContainerLogTail,
  getContainerState,
} from "./containerProbe";
import {
  checkHostHeaderProxy,
  checkHostHeaderProxyDetails,
  checkTraefikRoute,
  checkTraefikRouteDetails,
  verifyTraefikLabels,
} from "./traefikProbe";
import {
  checkRecentSessionsForAppliedModel,
  queryEndpoint,
  sanitizeErrorMsg,
  shouldRunFunctionalChatProbe,
  testHermesModelCallable,
  verifyHermesModelApplied,
} from "./modelProbe";
import { probeGatewayReadiness } from "./gatewayReadiness";
import { resolveFinalHealthStatus, shouldCheckDashboardProxy } from "./finalHealthPolicy";

const docker = new Docker();
const activeHealthChecks = new Map<string, Promise<any>>();

export function clearInstanceHealthCheckCache(instanceId: string) {
  activeHealthChecks.delete(instanceId);
}

async function safeUpdateInstanceStatus(updateInstanceStatusStmt: any, id: string, status: string) {
  if (!updateInstanceStatusStmt) return;
  if (typeof updateInstanceStatusStmt.run === 'function') {
    await updateInstanceStatusStmt.run({ status, id }).catch(() => {});
  } else if (typeof updateInstanceStatusStmt === 'function') {
    await updateInstanceStatusStmt(id, status).catch(() => {});
  } else {
    await dbAdapter.updateInstanceStatus(id, status).catch(() => {});
  }
}

export async function runInstanceHealthChecks(instanceId: string, gatewayHostPort: number, containerPort: number, subdomain: string, io: SocketIOServer, updateInstanceStatusStmt: any, triggerSource: string = "unknown") {
  if (activeHealthChecks.has(instanceId)) {
    // If a health check is already running for this instance, return the existing promise
    return activeHealthChecks.get(instanceId);
  }

  const healthCheckPromise = (async () => {
    let sourceFriendly = "未知来源触发";
    if (triggerSource === "manual") sourceFriendly = "收到用户手动请求";
    else if (triggerSource === "auto_create") sourceFriendly = "实例创建后自动自检";
    else if (triggerSource === "auto_retry") sourceFriendly = "失败后的自动重试";
    else if (triggerSource === "reconciler") sourceFriendly = "后台巡检触发";
    else if (triggerSource === "websocket_reconnect") sourceFriendly = "前端重连触发";
    
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[系统] ${sourceFriendly}。正在执行全链路反代与端口健康状态检测... (最长等待 180 秒)`,
    });

  // Verify multiple running containers mounting the same data directory
  const hasDuplicate = await detectDuplicateRunningContainers(instanceId);
  if (hasDuplicate) {
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[安全检测警告] 🚨 同一实例数据目录被多个容器同时使用，可能导致 s6-log lock 冲突。`
    });
  }

  // Retrieve instance details
  let instance: any = null;
  let username = "";
  let plainPassword = "";
  let configObj: any = {};
  try {
    instance = await dbAdapter.getInstanceById(instanceId);
    if (instance && instance.config_json) {
      configObj = JSON.parse(instance.config_json);
      username = configObj.username || "";
      if (configObj.password) {
        plainPassword = decrypt(configObj.password);
      }
    }
  } catch (e: any) {
    console.error("Failed to fetch instance details for healthcheck:", e.message);
  }

  // Clear any existing deployment error at start of health check
  await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: null }).catch(() => {});

  let expectedProvider = "";
  let expectedModel = "";
  let enabledChannels: string[] = [];
  if (instance) {
    expectedProvider = instance.model_provider || "";
    expectedModel = instance.model_name || "";
    expectedProvider = expectedProvider || configObj.provider || "";
    expectedModel = expectedModel || configObj.model || "";
    if (Array.isArray(configObj.channel)) {
      enabledChannels = configObj.channel.map((c: string) => c.toLowerCase());
    } else if (typeof configObj.channel === 'string') {
      enabledChannels = [configObj.channel.toLowerCase()];
    }
  }

  const externalList = [
    "feishu", "lark", "telegram", "discord", "qq", "qq_bot", "slack", 
    "webhook", "api", "wecom", "dingtalk", "whatsapp", "wechat_mp", "wechat"
  ];
  const hasExternalChannel = enabledChannels.some(ch => externalList.includes(ch));
  const mustChatReady = !hasExternalChannel;

  const ctx = buildDeploymentContext(instance || { id: instanceId });
  const dashboardContainerName = ctx.dashboardContainerName;
  const internal_web_port = ctx.internal_web_port;
  const host_port = ctx.host_port || gatewayHostPort || 15929;
  const dashboardAccessEnabled = ctx.enableDashboard !== false;

  const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true" || process.env.MYBAY_RUN_DB_INTEGRATION_TESTS === "true";
  await new Promise(r => setTimeout(r, isTestEnv ? 10 : 4000));

  let dashboardRunning = false;
  let dashboardPortListening = false;
  let currentStatus = "deploying";
  let lastGatewayReady = false;
  let lastChatReady = false;
  let cachedAuthReady = false;
  let authCheckAttempts = 0;
  let bestHealth = {
    running: false,
    portListening: false,
    authOk: false,
    uiOk: false,
    gatewayOk: false,
    chatOk: false
  };

  // Wait up to 180 seconds, checking every 3 seconds (60 attempts)
  for (let i = 0; i < 60; i++) {
    const containerState = await getContainerState(dashboardContainerName);
    const mybayProcessRunning = await checkMyBayProcessRunning(dashboardContainerName);
    const portReady = dashboardAccessEnabled
      ? await checkContainerPortListening(dashboardContainerName, internal_web_port)
      : true;
    const hostPortReady = dashboardAccessEnabled ? await checkHostPortHttp(host_port) : true;

    const logsTail = await getContainerLogTail(dashboardContainerName, 30);
    const { isTraefik } = parseTraefikEnv(process.env);
    // 1. Check Traefik/Proxy route with authentication
    let authRes: { success: boolean; url: string; statusCode: string };
    if (!dashboardAccessEnabled) {
      authRes = { success: true, url: "Dashboard access disabled", statusCode: "DISABLED" };
    } else if (isTraefik) {
      authRes = await checkTraefikRouteDetails(subdomain, username, plainPassword);
    } else {
      authRes = await checkHostHeaderProxyDetails(subdomain, username, plainPassword, host_port);
    }

    const authOk = authRes.success;
    const authStatusCode = authRes.statusCode;

    // 2. Check Traefik/Proxy route WITHOUT authentication (to verify basic auth middleware)
    let unauthStatusCode = "N/A";
    let basicAuthOk = true; 
    const hasBasicAuth = dashboardAccessEnabled && !!(username && plainPassword);
    if (hasBasicAuth) {
      let unauthRes: { success: boolean; url: string; statusCode: string };
      if (isTraefik) {
        unauthRes = await checkTraefikRouteDetails(subdomain);
      } else {
        unauthRes = await checkHostHeaderProxyDetails(subdomain, undefined, undefined, host_port);
      }
      unauthStatusCode = unauthRes.statusCode;
      basicAuthOk = unauthStatusCode.includes("401");
    }

    // 3. Probe gateway status inside container
    const gatewayProbe = await probeGatewayReadiness(docker.getContainer(dashboardContainerName), instanceId, logsTail, enabledChannels);
    lastGatewayReady = gatewayProbe.gateway_ready;
    const transportReady = !!gatewayProbe.chat_ready;

    // 4. Probe API auth status with models endpoint
    let authReady = cachedAuthReady;
    if (transportReady && !cachedAuthReady) {
      const backoffInterval = Math.min(5, Math.pow(2, authCheckAttempts));
      const shouldCheckAuth = (i === 0 || i % backoffInterval === 0);
      if (shouldCheckAuth) {
        authCheckAttempts++;
        const rawApiKey = configObj.hermesApiKey || configObj.chatApiKey || configObj.apiKey || configObj.API_SERVER_KEY || configObj.API_KEY;
        const apiKeyToUse = rawApiKey ? decrypt(rawApiKey) : "";
        const readinessRes = await requestTraefikInternal({
          instanceId,
          method: "GET",
          path: "/v1/models",
          apiKey: apiKeyToUse,
          timeoutMs: 3000,
        });
        if (readinessRes.ok && readinessRes.json && readinessRes.json.object === "list" && Array.isArray(readinessRes.json.data)) {
          authReady = true;
          cachedAuthReady = true;
        }
      }
    }

    lastChatReady = transportReady && authReady;

    // Update bestHealth snapshot
    if (containerState.Running) bestHealth.running = true;
    if (portReady) bestHealth.portListening = true;
    if (basicAuthOk) bestHealth.authOk = true;
    if (authOk) bestHealth.uiOk = true;
    if (gatewayProbe.gateway_ready) bestHealth.gatewayOk = true;
    if (lastChatReady) bestHealth.chatOk = true;

    // Diagnostics formatting (throttled output to prevent verbose noise)
    const isProgressPulseLoop = (i === 0 || i % 5 === 0);
    if (isProgressPulseLoop) {
      let checkLog = `[健康自检] 监测进度并且输出状态 (${i + 1}/60):
- 容器名: ${dashboardContainerName}
- Docker 状态: ${containerState.Status} (Running: ${containerState.Running ? '是' : '否'}, OOMKilled: ${containerState.OOMKilled ? '是' : '否'}, ExitCode: ${containerState.ExitCode})
- mybay 进程 (诊断): ${mybayProcessRunning ? '✅ 运行中' : '❌ 未找到 (可能后台运行或改名)'}
- 容器 9119 端口连接: ${portReady ? '✅ 监听中' : '❌ 未监听 (waiting_web_port)'}
- 宿主反代端口 127.0.0.1:${host_port}: ${hostPortReady ? '✅ 正常' : '❌ 未就绪'}
- 代理 Host 校验 URL: ${authRes.url}
- 对话工作台 8642 端口 (transport_ready): ${transportReady ? '✅ 正常' : '❌ 未就绪'}`;

      if (configObj) {
        const rawApiKey = configObj.hermesApiKey || configObj.chatApiKey || configObj.apiKey || configObj.API_SERVER_KEY || configObj.API_KEY;
        if (rawApiKey) {
          checkLog += `\n- 对话工作台内部路由与鉴权 (auth_ready): ${authReady ? '✅ 正常' : '❌ 未就绪'}`;
        } else {
          checkLog += `\n- 对话工作台内部路由与鉴权 (auth_ready): ⚠️ 密钥未配置`;
        }
      }

      if (hasBasicAuth) {
        checkLog += `\n- 权限认证层安全检测: ${basicAuthOk ? '✅ 已拦截并返回 401 提示' : '❌ 未生效 (状态码: ' + unauthStatusCode + ')'}
- 带鉴权界面联通测试: ${authStatusCode} (${authOk ? '✅ 已联通' : '❌ 还在同步过程中'})`;
      } else {
        checkLog += `\n- 无状态公开通道测试: ${authStatusCode} (${authOk ? '✅ 畅通' : '❌ 未就绪'})`;
      }

      if (isTraefik && (authStatusCode.includes("404") || unauthStatusCode.includes("404"))) {
        const labelsVerify = await verifyTraefikLabels(docker, dashboardContainerName, instanceId);
        checkLog += `\n- Traefik 路由状态: ⚠️ 网关返回 404，路由未同步。自检结果: ${labelsVerify.success ? 'Labels 正常 (' + labelsVerify.diagnostics + ')' : 'Labels 异常 (' + labelsVerify.error + ')'}`;
      }

      checkLog += `\n\n[最近日志快照]:
${logsTail || '(暂无日志)'}
==================================================`;

      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: checkLog,
      });
    }

    // Save/update gateway metadata fields dynamically in loop
    try {
      const dbInstance = await dbAdapter.getInstanceById(instanceId).catch(() => null);
      if (dbInstance) {
        const existingMetadata = dbInstance.metadata || {};
        const updatedMetadata = {
          ...existingMetadata,
          gateway_status: gatewayProbe.gateway_status,
          gateway_ready: gatewayProbe.gateway_ready,
          gateway_checked_at: gatewayProbe.checked_at,
          gateway_error: gatewayProbe.gateway_error,
          gateway_services: gatewayProbe.gateway_services,
          configured_channels: gatewayProbe.configured_channels,
          connected_channels: gatewayProbe.connected_channels,
          channel_status: gatewayProbe.channel_status
        };
        const isReadyNow = gatewayProbe.gateway_ready && (mustChatReady ? !!lastChatReady : true);
        await dbAdapter.updateInstanceVersionInfo(instanceId, {
          metadata: updatedMetadata,
          health_status: isReadyNow ? "healthy" : "unhealthy",
          last_health_check_at: gatewayProbe.checked_at,
          ready_at: isReadyNow ? gatewayProbe.checked_at : (dbInstance.ready_at || null),
          error_message: gatewayProbe.gateway_error || null
        }).catch(() => {});
      }
    } catch (metadataErr) {}

    // 1. Check for interactive CLI mode boot error
    if (logsTail.includes("Warning: Input is not a terminal") && logsTail.includes("Goodbye!")) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[内核异常] 🚨 探测到系统运行异常：容器以交互式 麦贝 CLI 模式启动，非 TTY 环境下自动退出。请改为 gateway/server 长驻模式。`,
      });
      const ttyError = "容器以交互式 CLI 模式启动并在非 TTY 环境下自动退出";
      await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: ttyError }).catch(() => {});
      await deploymentEventsRepo.create({
        instance_id: instanceId,
        owner_id: instance?.owner_id || instance?.user_id,
        step: "failed",
        status: "unhealthy",
        message: `部署失败：${ttyError}`
      }).catch(() => {});
      await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, "unhealthy");
      io.emit(`deploy_status_${instanceId}`, "unhealthy");
      return;
    }

    // 2. Early exit criteria: If internal port is listening AND UI is responding (authenticated if needed) AND gateway is truly ready!
    const uiIsReady = dashboardAccessEnabled ? authOk : true;
    const chatConditionOk = mustChatReady ? !!lastChatReady : true;
    if (containerState.Running && portReady && uiIsReady && gatewayProbe.gateway_ready && chatConditionOk) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[健康自检] 🚀 检测到后端服务与 ${dashboardAccessEnabled ? 'UI、' : ''}网关已完全就绪！正在提前结束自检。`,
      });
      // We set these for the final summary code block below
      dashboardRunning = true;
      dashboardPortListening = true;
      break;
    }

    // 3. Exit early if container dead / exited
    const isDeadOrOOM = !containerState.Running || containerState.Dead || containerState.OOMKilled || (containerState.Status === "exited" && containerState.ExitCode !== 0);
    if (isDeadOrOOM) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[健康自检] 检测到容器处于非运行状态 (State: ${containerState.Status}). 自检提前失败!`,
      });
      break;
    }

    // 4. Status updates (Fine-grained state transitions matching User Request)
    let refinedStatus = "container_starting";
    let statusDetail = "容器正在初始化并启动服务树...";

    if (!containerState.Running) {
      if (containerState.Status === "exited" && containerState.ExitCode !== 0) {
        refinedStatus = "unhealthy";
        statusDetail = `容器运行异常，退出代码: ${containerState.ExitCode}`;
      } else {
        refinedStatus = "container_starting";
        statusDetail = "虚拟机实例构建完毕，正在唤醒守护网口启动服务容器...";
      }
    } else {
      if (!portReady) {
        refinedStatus = "container_starting";
        if (logsTail.includes("lark-oapi") || logsTail.includes("pip install") || logsTail.includes("Running pip")) {
          statusDetail = "正在热加载第三方依赖库 (lark-oapi / edge-tts)... 这通常会在实例首次启动时发生";
        } else if (logsTail.includes("tirith") || logsTail.includes("pip install tirith")) {
          statusDetail = "正在构建安全验证环境密钥 (tirith)... 请稍候";
        } else {
          statusDetail = "等待 9119 控制台端口就绪... 可能正在进行首次运行预热";
          if (logsTail.toLowerCase().includes("temporary failure in name resolution") || logsTail.toLowerCase().includes("failed to resolve") || logsTail.toLowerCase().includes("dns_open.feishu.cn: fail")) {
            statusDetail = "容器 DNS 解析失败 (open.feishu.cn)，请检查系统环境变量 MYBAY_CONTAINER_DNS 是否配置正确。";
          }
        }
      } else {
        refinedStatus = "dashboard_ready";
        statusDetail = "控制台端口 9119 已就绪，正在准备初始化网关进程...";

        const missingFrontend = dashboardAccessEnabled
          ? await checkFrontendMissingBuild(dashboardContainerName, containerPort)
          : false;
        if (missingFrontend) {
          const diagnostic = await checkFrontendConfigDiagnostic(dashboardContainerName);
          const diagMsg = diagnostic ? ` [诊断建议: ${diagnostic}]` : "";
          
          io.emit(`deploy_log_${instanceId}`, {
            timestamp: new Date().toISOString(),
            message: `[内核异常] 🚨 探测到前端依赖缺失: 该基础镜像未包含 frontend 编译产物 (dist) 或路径配置错误。${diagMsg}`,
          });
          await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, "frontend_missing_build");
          io.emit(`deploy_status_${instanceId}`, "frontend_missing_build");
          return;
        }

        if (isTraefik && gatewayProbe.gateway_ready && (authStatusCode.includes("404") || unauthStatusCode.includes("404"))) {
          const labelsVerify = await verifyTraefikLabels(docker, dashboardContainerName, instanceId);
          if (!labelsVerify.success) {
            io.emit(`deploy_log_${instanceId}`, {
              timestamp: new Date().toISOString(),
              message: `[内核异常] 🚨 Traefik 路由配置异常: ${labelsVerify.error}。由于反代标签缺失或错误，实例将无法通过域名访问。请检查配置或重新部署。`,
            });
            const statusToSet = labelsVerify.errorCode || "unhealthy";
            await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, statusToSet);
            io.emit(`deploy_status_${instanceId}`, statusToSet);
            return;
          }
        }

        if (gatewayProbe.gateway_status === "starting") {
          refinedStatus = "gateway_starting";
          statusDetail = gatewayProbe.gateway_error || "控制台就绪，发现网关服务已拉起，正在同步反代配置...";
        } else if (gatewayProbe.gateway_ready) {
          if (!chatConditionOk) {
            refinedStatus = "gateway_starting";
            statusDetail = "控制台与网关已就绪，正在等待对话/API端口 8642 启动监听...";
          } else if (isTraefik && (authRes.statusCode.includes("404") || unauthStatusCode.includes("404"))) {
            refinedStatus = "gateway_syncing";
            statusDetail = "网关路由同步中...";
          } else {
            refinedStatus = "running";
            statusDetail = "服务已全部就绪！";
          }
        } else if (gatewayProbe.gateway_status === "unhealthy" || gatewayProbe.gateway_status === "error") {
          refinedStatus = "unhealthy";
          statusDetail = `网关异常: ${gatewayProbe.gateway_error || "无法加载网关服务"}`;
        }
      }
    }

    if (refinedStatus !== currentStatus) {
      currentStatus = refinedStatus;
      await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, refinedStatus).catch(() => {});
      io.emit(`deploy_status_${instanceId}`, refinedStatus);
      
      const isRealFailureStatus = refinedStatus === "unhealthy" || refinedStatus === "failed" || refinedStatus === "frontend_missing_build";
      if (isRealFailureStatus) {
        await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: statusDetail }).catch(() => {});
      } else {
        await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: null }).catch(() => {});
      }

      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[迁移就绪] 👉 变更为 [${refinedStatus}] (${statusDetail})`,
      });
    }

    await new Promise(r => setTimeout(r, isTestEnv ? 10 : 3000));
  }

    // Use bestHealth if the last check failed due to transient issues, 
    // but if it broke early we already set dashboardRunning = true.
    const bestChatOk = mustChatReady ? bestHealth.chatOk : true;
    if (!dashboardRunning && bestHealth.running && bestHealth.portListening && bestHealth.uiOk && bestHealth.gatewayOk && bestChatOk) {
      dashboardRunning = true;
      dashboardPortListening = true;
    }

    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[健康自检] 180s 自检环节结束: 容器状态: ${dashboardRunning ? 'running' : 'unhealthy'} (端口 ${internal_web_port} 监听: ${dashboardPortListening ? '是' : '否'}, 网关平台就绪: ${lastGatewayReady ? '是' : '否'})`,
    });

  if (!dashboardRunning || !dashboardPortListening) {
    const errorLogsTail = await getContainerLogTail(dashboardContainerName, 50);
    
    // Check for s6-overlay PID limit exhaustion
    const isForkError = errorLogsTail && (
      errorLogsTail.includes("Cannot fork") ||
      errorLogsTail.includes("unable to fork") ||
      errorLogsTail.includes("unable to spawn subprocess") ||
      errorLogsTail.includes("Resource temporarily unavailable") ||
      errorLogsTail.includes("BlockingIOError: [Errno 11]")
    );

    if (isForkError) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[健康自检] 状态: unhealthy -> ⚠️ 容器 PID / 进程数限制过低或宿主机 PID 资源不足，导致 s6-overlay 无法启动或 fork 子进程失败。\n\n下面是容器最后 50 行运行日志:\n\n${errorLogsTail}\n\n请尝试提高实例的进程数限制，或联系管理员检查宿主机资源。`
      });
      const portError = "容器 PID 限制过低导致 s6 无法启动 (Fork Error)";
      await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: portError }).catch(() => {});
      await deploymentEventsRepo.create({
        instance_id: instanceId,
        owner_id: instance?.owner_id || instance?.user_id,
        step: "failed",
        status: "unhealthy",
        message: portError
      }).catch(() => {});
      await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, "unhealthy");
      io.emit(`deploy_status_${instanceId}`, "unhealthy");
      return;
    }

    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[健康自检] 状态: unhealthy -> 麦贝服务最终未能就绪，已超时。下面是容器最后 50 行运行日志:\n\n${errorLogsTail || '(无日志输出)'}\n\n请根据日志或配置属性查错。`,
    });
    const portError = mustChatReady && !bestHealth.chatOk 
      ? "麦贝服务对话端口 8642 最终未能正常就绪（180s超时）"
      : "麦贝服务端口最终未能正常就绪（180s超时）";
    await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: portError }).catch(() => {});
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: instance?.owner_id || instance?.user_id,
      step: "failed",
      status: "unhealthy",
      message: `部署不健康（已超时）：${portError}`
    }).catch(() => {});
    await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, "unhealthy");
    io.emit(`deploy_status_${instanceId}`, "unhealthy");
    return;
  }

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[健康自检] 正在激活单容器模型及持久化层深度安全审计与交叉验证...`,
  });

  const dashContainer = docker.getContainer(dashboardContainerName);
  let checkedProvider = "";
  try {
    const dashInspect = await dashContainer.inspect();
    const envs = dashInspect.Config.Env || [];
    
    // Check PROVIDER / MODEL / BASE_URL env vars
    const hasProvider = envs.some((e: string) => e.startsWith("PROVIDER="));
    const hasModel = envs.some((e: string) => e.startsWith("MODEL="));
    const hasBaseUrl = envs.some((e: string) => e.startsWith("BASE_URL="));
    
    const foundProv = envs.find((e: string) => e.startsWith("PROVIDER="));
    if (foundProv) {
      checkedProvider = foundProv.substring("PROVIDER=".length).toLowerCase();
    }

    let regKey = checkedProvider;
    if (checkedProvider === "custom") {
      regKey = "custom-openai-compatible";
    }
    const conf = providerRegistry[regKey];
    
    let apiKeyExists = false;
    let apiKeyName = "API_KEY";
    if (conf && conf.envPrefix) {
      apiKeyName = `${conf.envPrefix}_API_KEY`;
      apiKeyExists = envs.some((e: string) => e.startsWith(`${apiKeyName}=`));
    } else {
      apiKeyExists = envs.some((e: string) => e.startsWith("API_KEY="));
    }

    const provEnvMsg = `PROVIDER=${hasProvider ? '✅' : '❌'}, MODEL=${hasModel ? '✅' : '❌'}, BASE_URL=${hasBaseUrl ? '✅' : '❌'}, 对应密钥(${apiKeyName})=${apiKeyExists ? '✅' : '❌'}`;

    if (hasProvider && hasModel && apiKeyExists) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测] 1. 容器核心模型环境变量校验完美通过！\n- ${provEnvMsg}`
      });
    } else {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测警告] 1. 唯一运行容器存在部分模型环境变量缺失：\n- ${provEnvMsg}`
      });
    }
  } catch (e: any) {
    console.error("Environment verification inspection failed:", e.message);
  }

  try {
    const envPath = path.join(process.cwd(), "data", "instances", instanceId, ".env");
    if (fs.existsSync(envPath)) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测] 2. 磁盘持久化 .env 文件成功写入。`
      });
    }
  } catch (e) {}

  try {
    const yamlPath = path.join(process.cwd(), "data", "instances", instanceId, "config.yaml");
    if (fs.existsSync(yamlPath)) {
      const yamlContent = fs.readFileSync(yamlPath, "utf-8");
      const validation = validateYamlConfigContent(yamlContent);
      
      if (validation.success) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[安全检测] 3. config.yaml 架构审计通过。`
        });
      } else {
        const errorMsg = validation.message || "config.yaml 格式校验未通过";
        const isActuallyRunning = dashboardRunning && dashboardPortListening;
        
        if (isActuallyRunning) {
          io.emit(`deploy_log_${instanceId}`, {
            timestamp: new Date().toISOString(),
            message: `[安全检测警告] 3. config.yaml 发现潜在风险: ${errorMsg}。但由于 Web UI 已正常就绪，部署将继续。`
          });
        } else {
          io.emit(`deploy_log_${instanceId}`, {
            timestamp: new Date().toISOString(),
            message: `[安全检测自检失败] 3. config.yaml 校验失败: ${errorMsg}。立即标记部署为 failed 状态。`
          });
          await dbAdapter.updateInstanceVersionInfo(instanceId, { deployment_error: `config.yaml 校验失败: ${errorMsg}` }).catch(() => {});
          await deploymentEventsRepo.create({
            instance_id: instanceId,
            owner_id: instance?.owner_id || instance?.user_id,
            step: "failed",
            status: "failed",
            message: `部署失败：config.yaml 校验失败 (${errorMsg})`
          }).catch(() => {});
          await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, "failed");
          io.emit(`deploy_status_${instanceId}`, "failed");
          return;
        }
      }
    }
  } catch (e: any) {
    console.error("YAML config audit error:", e.message);
  }

  // 4. Model Config Consistency Verification (Requirement 8)
  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[安全检测] 4. 开始对实际加载的模型进行一致性双重检验... (预设 Provider: ${expectedProvider || '未指定'}, Model: ${expectedModel || '未指定'})`,
  });

  const container = docker.getContainer(dashboardContainerName);
  const modelVerifyRes = await verifyHermesModelApplied(container, internal_web_port, expectedProvider, expectedModel);

  // Initialize status metrics early
  let isContainerRunningVal = "running";
  let isProxyStatusVal = "unknown";
  
  // Update container state tracking dynamically
  await dbAdapter.updateInstanceVersionInfo(instanceId, {
    container_status: isContainerRunningVal,
  }).catch(() => {});

  let modelConfigStatus = "pending";
  let modelConfigError: string | null = null;
  let modelRuntimeStatus = "idle";
  let modelRuntimeError: string | null = null;
  let modelRuntimeDetails: string | null = null;

  // Perform a runtime sessions table scan fallback
  const sessionMatch = checkRecentSessionsForAppliedModel(instanceId, expectedProvider, expectedModel);
  if (sessionMatch.success && sessionMatch.lastSession) {
    modelConfigStatus = "verified_by_runtime_session";
    modelRuntimeStatus = "callable";
    const ls = sessionMatch.lastSession;
    modelRuntimeDetails = `已通过真实 Feishu/API 会话调用验证成功。最近一次调用详情: [模型: ${ls.model}, 渠道: ${ls.provider}, 输入 Token: ${ls.input_tokens}, 输出 Token: ${ls.output_tokens}, 客户端: ${ls.source}]`;
    
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[安全检测 - 运行期审计通过] ✨ 发现符合条件的真实调用会话历史记录！无需通过 API 读取直接认证状态。状态更新为 verified_by_runtime_session/callable`
    });
  }

  if (modelVerifyRes.ok) {
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[安全检测已通过] 4. Hermes 模型加载校验完美结合！(详情: ${modelVerifyRes.message})`
    });
    
    if (modelConfigStatus !== "verified_by_runtime_session") {
      modelConfigStatus = "verified";
    }

    // 5. Runtime callable check (functional_ready check)
    const shouldProbeFunctional = shouldRunFunctionalChatProbe();
    if (shouldProbeFunctional) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测] 5. 检测到 MYBAY_DEPLOY_FUNCTIONAL_CHAT_PROBE=true，正在发起活动端点 LLM 连通性真实请求测试 (LLM Ping Check)...`
      });

      const rawApiKey = configObj.hermesApiKey || configObj.chatApiKey || configObj.apiKey || configObj.API_SERVER_KEY || configObj.API_KEY;
      const apiKeyToUse = rawApiKey ? decrypt(rawApiKey) : "";

      const callableRes = await testHermesModelCallable(container, apiKeyToUse);
      if (callableRes.success) {
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[模型连通测试通过] ✨ 恭喜！模型已成功响应回复，链路畅通。状态升级为 [callable]！\n- 详情: ${callableRes.message}`
        });
        modelRuntimeStatus = "callable";
      } else {
        const sanitizedError = sanitizeErrorMsg(callableRes.message);
        io.emit(`deploy_log_${instanceId}`, {
          timestamp: new Date().toISOString(),
          message: `[模型测试说明] ⚠️ 链路测试未能成功连通。该报错不影响系统运行状态，但检测到调用故障，可能是 key 额度/有效性或 Base URL 设置有误。\n- 提示: ${sanitizedError}`
        });
        modelRuntimeError = `模型通信连通警告: ${sanitizedError}`;
      }
    } else {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测] 5. 已跳过高成本真实对话连通测试 (functional_ready)。`
      });
      modelRuntimeStatus = "skipped";
    }
  } else {
    // Handling 401 unauthenticated probe cases (Requirement 1 & 8)
    if (modelVerifyRes.isAuthRequired || modelVerifyRes.actualProvider === "unauthorized") {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测提示] 4. 主系统接口探针在读取后台活动模型时遭遇 401 未认证。这表明 MyBay 配置正常注入，而 Hermes Dashboard 本身启用了接口权限控制，不影响客户端真实调用与转发。`
      });
      if (modelConfigStatus !== "verified_by_runtime_session") {
        modelConfigStatus = "verification_auth_required";
        modelConfigError = "Hermes active model API requires authentication; MyBay wrote env/config but cannot verify active provider/model through dashboard API.";
      }
    } else {
      // Just flag mismatched but do NOT crash deployment
      const configErrorMsg = `Hermes model config check result: expected ${expectedProvider}/${expectedModel}, got ${modelVerifyRes.actualProvider}/${modelVerifyRes.actualModel}`;
      const sanitizedErrorMsg = sanitizeErrorMsg(configErrorMsg);
      
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测自检提示] 🚨 探测到的活动模型/厂商 (${modelVerifyRes.actualProvider}/${modelVerifyRes.actualModel}) 与预设配置不一致。\n- 信息: ${modelVerifyRes.message}`
      });
      if (modelConfigStatus !== "verified_by_runtime_session") {
        modelConfigStatus = "mismatched";
        modelConfigError = sanitizedErrorMsg;
      }
    }
  }

  // 4b. Perform model list options check (Requirement 2)
  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[安全检测] 4b. 探测 /api/model/options 模型备选列表接口就绪性...`
  });
  
  let modelOptionsStatus = "success";
  let modelOptionsError: string | null = null;
  
  try {
    const optUrl = `http://127.0.0.1:${internal_web_port}/api/model/options`;
    const optRes = await queryEndpoint(container, optUrl);
    if (!optRes || optRes.statusCode >= 400) {
      modelOptionsStatus = "failed";
      modelOptionsError = `Failed to list model options (HTTP Code: ${optRes ? optRes.statusCode : '无响应'})`;
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[安全检测说明] ⚠️ /api/model/options 返回 ${optRes ? optRes.statusCode : '无响应'}，模型列表不可载，但此项加载失败不影响主模型实际调用。`
      });
    }
  } catch (optErr: any) {
    modelOptionsStatus = "failed";
    modelOptionsError = optErr.message;
  }

  // Save split status results cleanly to database (Requirement 3)
  await dbAdapter.updateInstanceVersionInfo(instanceId, {
    model_config_status: modelConfigStatus,
    model_config_error: modelConfigError,
    model_options_status: modelOptionsStatus,
    model_options_error: modelOptionsError,
    model_runtime_status: modelRuntimeStatus,
    model_runtime_error: modelRuntimeError,
    model_runtime_details: modelRuntimeDetails
  }).catch(() => {});

  const { isTraefik } = parseTraefikEnv(process.env);
  const deploymentCheck = triggerSource === "auto_create" || triggerSource === "auto_retry";
  const finalChatReady = mustChatReady ? (lastChatReady || bestHealth.chatOk) : true;
  const finalGatewayReady = lastGatewayReady || bestHealth.gatewayOk;

  if (!shouldCheckDashboardProxy(dashboardAccessEnabled)) {
    const finalStatus = resolveFinalHealthStatus({
      dashboardAccessEnabled,
      gatewayReady: finalGatewayReady,
      chatRequired: mustChatReady,
      chatReady: finalChatReady,
      deploymentCheck,
    });
    const runtimeReady = finalStatus === "running";
    await dbAdapter.updateInstanceVersionInfo(instanceId, {
      proxy_status: "disabled",
      deployment_error: runtimeReady ? null : "运行时网关未能完成就绪检查",
    }).catch(() => {});
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: instance?.owner_id || instance?.user_id,
      step: "health_check",
      status: finalStatus,
      message: runtimeReady
        ? "Dashboard 未启用，已跳过 Dashboard 公网路由检查；运行时网关检查通过"
        : "Dashboard 未启用，但运行时网关未能完成就绪检查",
    }).catch(() => {});
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: runtimeReady
        ? `[健康自检] 状态: running -> Dashboard 未启用，跳过 Dashboard 公网路由检查；运行时网关已就绪。`
        : `[健康自检] 状态: ${finalStatus} -> Dashboard 未启用，但运行时网关尚未就绪。`,
    });
    await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, finalStatus);
    io.emit(`deploy_status_${instanceId}`, finalStatus);
    return;
  }

  io.emit(`deploy_log_${instanceId}`, {
    timestamp: new Date().toISOString(),
    message: `[健康自检] 所有的底层模型验证已完毕，正在启动 Host Route Proxy Check...`,
  });

  let proxyCheckPassed = false;
  if (isTraefik) {
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[健康自检] 正在对 Traefik 动态代理生效状态进行动态网络路由联通检测...`,
    });
    proxyCheckPassed = await checkTraefikRoute(subdomain);
  } else {
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[健康自检] 正在对宿主 Nginx 反代生效状态进行联通检测...`,
    });
    proxyCheckPassed = await checkHostHeaderProxy(subdomain);
  }

  isProxyStatusVal = proxyCheckPassed ? "ready" : "failed";
  await dbAdapter.updateInstanceVersionInfo(instanceId, {
    proxy_status: isProxyStatusVal
  }).catch(() => {});

  if (proxyCheckPassed) {
    const finalStatus = resolveFinalHealthStatus({
      dashboardAccessEnabled,
      proxyCheckPassed,
      gatewayReady: finalGatewayReady,
      chatRequired: mustChatReady,
      chatReady: finalChatReady,
      deploymentCheck,
    });
    const publicUrl = buildInstancePublicUrl(subdomain, host_port);
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: isTraefik
        ? `[Health check passed] Traefik 动态联通路由测试以 Host: ${subdomain} 正常直达！`
        : `[Proxy check passed] Host header 反代测试通过！说明宿主机已成功重载 Nginx 并对外服务。`,
    });
    io.emit(`deploy_log_${instanceId}`, {
      timestamp: new Date().toISOString(),
      message: `[健康自检] 状态: ${finalStatus} -> 实例公网反代通道正常 (${publicUrl})。${lastGatewayReady ? '平台通道已连接完成！' : '等待平台通道连接...'}`,
    });
    await dbAdapter.updateInstanceVersionInfo(instanceId, {
      deployment_error: finalStatus === "unhealthy" ? "公网路由已就绪，但运行时网关未能完成就绪检查" : null,
    }).catch(() => {});
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: instance?.owner_id || instance?.user_id,
      step: "health_check",
      status: finalStatus,
      message: `公网路由通道测试成功 (${publicUrl})`
    }).catch(() => {});
    await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, finalStatus);
    io.emit(`deploy_status_${instanceId}`, finalStatus);
  } else {
    const finalStatus = resolveFinalHealthStatus({
      dashboardAccessEnabled,
      proxyCheckPassed,
      gatewayReady: finalGatewayReady,
      chatRequired: mustChatReady,
      chatReady: finalChatReady,
      deploymentCheck,
    });
    if (isTraefik) {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[健康自检] 状态: dashboard_ready -> 麦贝统一容器已运行且端口就绪，但 Traefik 代理通道暂时未通过。极可能是外部 Nginx wildcard 反代、DNS、或 traefik_proxy 网桥网络还未就绪。请手动检查后重试。`
      });
    } else {
      io.emit(`deploy_log_${instanceId}`, {
        timestamp: new Date().toISOString(),
        message: `[健康自检] 状态: dashboard_ready -> 麦贝统一容器本地端口正常可访，但是宿主 Nginx 语法、Wildcard 或重载未生效。请在此页面点击“重新检测”或手动配置重启宿主 Nginx。`
      });
    }
    await deploymentEventsRepo.create({
      instance_id: instanceId,
      owner_id: instance?.owner_id || instance?.user_id,
      step: "health_check",
      status: finalStatus,
      message: "容器端点自测通过，但是公网路由还在就位中"
    }).catch(() => {});
    if (finalStatus === "unhealthy") {
      await dbAdapter.updateInstanceVersionInfo(instanceId, {
        deployment_error: "Dashboard 公网路由未能通过健康检查",
      }).catch(() => {});
    }
    await safeUpdateInstanceStatus(updateInstanceStatusStmt, instanceId, finalStatus);
    io.emit(`deploy_status_${instanceId}`, finalStatus);
  }
  })();
  
  activeHealthChecks.set(instanceId, healthCheckPromise);
  try {
    await healthCheckPromise;
  } finally {
    activeHealthChecks.delete(instanceId);
  }
}

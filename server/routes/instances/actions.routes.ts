import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv, getTraefikRouterName, getTraefikAuthMiddlewareName } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import https from "https";
import http from "http";
import { sanitizeConfig, sanitizeErrorMessage } from "../../utils/sanitizer";
import { supportsNativeDashboardBasicAuth } from "../../utils/hermesVersionCapabilities";
import path from "path";
import { executeDeployment, buildDeploymentContext } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { RouterDependencies, invalidateContainerStatsCache } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt, decrypt, tryResolvePlainInstancePassword, isEncryptionKeyConfigured, getEncryptionKeyFingerprint } from "../../crypto";
import bcrypt from "bcryptjs";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { rebuildProxyConfig } from "../../deployment"; // Used maybe? Assumed in configWriter
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";
import { resolveInstanceDiskLimitMb, formatDiskLimitLabel } from "../../services/instances/instanceStorageQuotaService";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../../utils/ip";
import { ensureEncryptedDashboardAuthSecret } from "../../utils/dashboardAuthSecret";
import { tasksRepo } from "../../repositories/tasksRepo";
import { evaluateInstanceWorkflowReadiness } from "../../services/workflowReadinessService";
import { executeTaskInBackground } from "../../workers/taskRunner";
import { isTemplateWorkflowsEnabled } from "../../utils/templateWorkflowsFeature";

const instanceActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // max 30 control actions per 15 mins
  keyGenerator: (req: any) => `inst_action:ip:${getClientIp(req)}:user:${req.user?.id || 'anon'}`,
  message: { error: "操作过于频繁，请稍候再试。" }
});

export function createActionsRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.post("/:id/action", authenticateToken, instanceActionLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const { action } = req.body;
      const validActions = ["start", "stop", "restart", "rebuild_proxy", "redeploy", "restore"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }

      if (action === "restore") {
        if (!instance.archived) {
          return res.status(400).json({ error: "Bad Request", message: "实例并未归档，无需恢复。" });
        }
      }

      if (action === "start" || action === "restart") {
         const diskLimitMb = await resolveInstanceDiskLimitMb(instance);
         if (diskLimitMb !== null) {
            let instanceDir = instance.data_volume_path;
            if (!instanceDir || !fs.existsSync(instanceDir)) {
               instanceDir = path.join(process.cwd(), "data", "instances", String(instance.id));
            }
            const usedBytes = await getDirectorySizeBytes(instanceDir).catch(() => null);
            const STORAGE_LIMIT_BYTES = diskLimitMb * 1024 * 1024;
            const RECOVERY_THRESHOLD_BYTES = STORAGE_LIMIT_BYTES * 0.95;
            
            if (usedBytes !== null && usedBytes > RECOVERY_THRESHOLD_BYTES) {
               const recoveryLabel = formatDiskLimitLabel(Math.round(diskLimitMb * 0.95));
               return res.status(403).json({
                  error: "容量超额拦截",
                  message: `当前实例数据目录用量尚未降至安全阈值 (${recoveryLabel}) 以下，为保护宿主机资源，无法启动容器。请在“浏览实例文件”中清理垃圾文件后重试。`
               });
            }
         }

         // Proactively clear caches
         try {
            const { clearInstanceHealthCheckCache } = await import("../../healthCheck");
            invalidateContainerStatsCache(req.params.id);
            clearInstanceHealthCheckCache(req.params.id);
         } catch (cacheErr) {}

         // Proactively clear storageExceeded flag and physical errors in DB
         try {
            let currentConfig: any = {};
            try {
               currentConfig = typeof instance.config_json === 'string' 
                 ? JSON.parse(instance.config_json) 
                 : (instance.config_json || {});
            } catch (e) {}
            
            if (currentConfig.storageExceeded) {
               currentConfig.storageExceeded = false;
               await dbAdapter.updateInstanceConfig(req.params.id, JSON.stringify(currentConfig)).catch(() => {});
            }

            await dbAdapter.updateInstancePhysicalState(req.params.id, {
               physical_status: 'running',
               physical_error: null,
               last_reconciled_at: new Date().toISOString()
            }).catch(() => {});
         } catch (configErr) {}
      }

      if (action !== "restore") {
        await dbAdapter.insertAuditLog({
          instance_id: req.params.id,
          action,
          user_id: req.user.id,
          timestamp: new Date().toISOString(),
          details: `Performed ${action} action`
        });
      }

      if (action === "redeploy" || action === "restore") {
        const config = JSON.parse(instance.config_json);
        const isWeb = config.channel === "web" || !config.channel;
        if (isWeb) {
          const plainPass = tryResolvePlainInstancePassword(config);
          if (!plainPass || !config.webPasswordHash || !config.dashboardAuthSecret || !config.hermesDashboardAuthSecret) {
            return res.status(400).json({
              error: "PASSWORD_MISSING",
              message: "面板访问密码不可用，实例无法完成 Dashboard 登录配置。请重置访问密码后重新部署。"
            });
          }
        }

        if (action === "restore") {
          await dbAdapter.unarchiveInstance(instance.id);
          instance.archived = false;

          await dbAdapter.insertAuditLog({
            instance_id: req.params.id,
            action: "restore",
            user_id: req.user.id,
            timestamp: new Date().toISOString(),
            details: `Restored instance from archive`
          }).catch(err => console.error("Failed to insert restore audit log:", err));

          io.emit("instances_updated", { id: instance.id, archived: false, status: "deploying", action: "restore" });
        }

        await dbAdapter.updateInstanceVersionInfo(req.params.id, { deployment_error: null, updated_at: new Date().toISOString() }).catch(() => {});
        await wrappedUpdateStatus.run({ status: "deploying", id: req.params.id });

        // Keep the registered official Hermes image. Normal deployment will pull it on demand.
        const ctx = buildDeploymentContext(instance);
        io.emit(`deploy_log_${instance.id}`, { timestamp: new Date().toISOString(), message: "[系统] 正在清理旧容器准备重新部署..." });
        const { cleanOldContainersOfInstance } = await import("../../deployment");
        cleanOldContainersOfInstance(instance.id, io).then(() => {
          executeDeployment(instance, io, wrappedUpdateStatus, config, req.user);
        }).catch((err) => {
          console.error("Clean old containers failed:", err);
          executeDeployment(instance, io, wrappedUpdateStatus, config, req.user);
        });
        return res.json({ success: true, status: "deploying" });
      }

      if (action === "start" || action === "restart") {
        const { isTraefik } = parseTraefikEnv(process.env);
        if (isTraefik) {
          try {
             const ctx = buildDeploymentContext(instance);
             const dashContainer = docker.getContainer(ctx.dashboardContainerName);
             const inspectData = await dashContainer.inspect();
             const config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
             
             // Check environment variables for legacy Basic Auth settings
             const envList = inspectData.Config.Env || [];

             const hasNewDashboardAuthEnv =
               envList.some((envStr: string) => envStr.startsWith("HERMES_DASHBOARD_BASIC_AUTH_USERNAME=")) &&
               (
                 envList.some((envStr: string) => envStr.startsWith("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=")) ||
                 envList.some((envStr: string) => envStr.startsWith("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH="))
               );

             const hasLegacyInsecureEnv =
               envList.some((envStr: string) => envStr.startsWith("HERMES_DASHBOARD_INSECURE="));

             const hasOldProvidersOnly =
               envList.some((envStr: string) => envStr.startsWith("HERMES_DASHBOARD_AUTH_PROVIDERS=")) &&
               !hasNewDashboardAuthEnv;

             let shouldSelfHeal = false;
             let reasonMessage = "";

             if (hasLegacyInsecureEnv || hasOldProvidersOnly) {
                shouldSelfHeal = true;
                reasonMessage = "[系统] 检测到实例容器仍使用旧版 Hermes Dashboard 认证环境，正在执行自愈重建链路...";
                console.log(`[Action Routes] Instance ${instance.id} legacy env detected. Recreating on start/restart...`);
             }

             if (config.webPasswordHash && !shouldSelfHeal) {
                const { getTraefikRouterName, getTraefikAuthMiddlewareName } = await import("../../infrastructure/traefik/traefikConfig");
                const routerName = getTraefikRouterName(String(instance.id));
                const authMiddlewareName = getTraefikAuthMiddlewareName(routerName);
                const labelKey = `traefik.http.middlewares.${authMiddlewareName}.forwardauth.address`;
                const actualLabelValue = inspectData.Config.Labels ? inspectData.Config.Labels[labelKey] : undefined;

                const hasLegacyPattern = !!(
                  actualLabelValue && (
                    actualLabelValue.includes("hermes-console-blue") || 
                    actualLabelValue.includes("hermes-console-green") || 
                    actualLabelValue.includes("hermes-saas-console")
                  )
                );
                const consoleInternalUrl = process.env.INSTANCE_AUTH_INTERNAL_URL || process.env.CONTROL_PLANE_INTERNAL_URL;
                const expectedLabelValue = consoleInternalUrl ? `${consoleInternalUrl}/api/public/instances/auth-check` : undefined;
                const isMismatch = !!(expectedLabelValue && actualLabelValue && actualLabelValue !== expectedLabelValue);
                const isMissingLabel = !actualLabelValue;

                if (hasLegacyPattern || isMismatch || isMissingLabel) {
                   shouldSelfHeal = true;
                   let reasonDetail = "";
                   if (hasLegacyPattern) reasonDetail = "hasLegacyPattern";
                   else if (isMismatch) reasonDetail = "isMismatch";
                   else if (isMissingLabel) reasonDetail = "isMissingLabel";

                   reasonMessage = `[系统] 检测到开启轻量登录保护的实例缺失或使用了过期的代理标签 (ForwardAuth 异常: ${reasonDetail})，正在执行自愈重建链路...`;
                   console.log(`[Action Routes] Instance ${instance.id} ForwardAuth issue (${reasonDetail}). Relabeling/Recreating on start/restart...`);
                }
             }

             if (shouldSelfHeal) {
                await wrappedUpdateStatus.run({ status: action === "restart" ? "restarting" : "deploying", id: req.params.id });
                io.emit(`deploy_log_${instance.id}`, { timestamp: new Date().toISOString(), message: reasonMessage });
                executeDeployment(instance, io, wrappedUpdateStatus, config, req.user);
                return res.json({ success: true, status: action === "restart" ? "restarting" : "deploying" });
             }
          } catch (e) {
             // Container might not exist or other errors, ignore and let normal flow handle it
          }
        }
      }

      if (action === "start" || action === "restart" || action === "rebuild_proxy") {
         await dbAdapter.updateInstanceVersionInfo(req.params.id, { deployment_error: null }).catch(() => {});
      }

      if (action === "rebuild_proxy") {
         const { isTraefik: rebuildIsTraefik, isLocal: rebuildIsLocal } = parseTraefikEnv(process.env);
         if (rebuildIsTraefik) {
            if (rebuildIsLocal) {
            await wrappedUpdateStatus.run({ status: "deploying", id: req.params.id });
            const { runInstanceHealthChecks } = await import("../../deployment");
            const ctx2 = buildDeploymentContext(instance);
            runInstanceHealthChecks(ctx2.instanceId, ctx2.gatewayHostPort, ctx2.dashboardHostPort, ctx2.subdomain, io, wrappedUpdateStatus, "manual");
            return res.json({ success: true, status: "deploying", mode: "local" });
         }
         await wrappedUpdateStatus.run({ status: "deploying", id: req.params.id });
            io.emit(`deploy_log_${instance.id}`, { timestamp: new Date().toISOString(), message: "[系统] 当前处于 Traefik 动态路由代理模式，无需配置 Nginx 静态服务。正在触发全链路容器/路由自检程序..." });
            if (action === "start" || action === "restart") {
              const config = JSON.parse(instance.config_json || "{}");
              startPeriodicAgentDbSync(req.params.id, config);
            }
            const { runInstanceHealthChecks } = await import("../../deployment");
            const ctx2 = buildDeploymentContext(instance);
            runInstanceHealthChecks(ctx2.instanceId, ctx2.gatewayHostPort, ctx2.dashboardHostPort, ctx2.subdomain, io, wrappedUpdateStatus, "manual");
            return res.json({ success: true, status: "deploying" });
         }

         await wrappedUpdateStatus.run({ status: "deploying", id: req.params.id });
         const { rebuildProxyConfig } = await import("../../deployment");
         rebuildProxyConfig(instance, io, wrappedUpdateStatus);
         return res.json({ success: true, status: "deploying" });
      }

      const transientStatus = action === "restart" ? "restarting" : action === "start" ? "deploying" : "stopped";

      const ctx = buildDeploymentContext(instance);
      const dashContainer = docker.getContainer(ctx.dashboardContainerName);

      const performAction = async (actionName: string) => {
         if (actionName === "start") {
           await dashContainer.start();
         } else if (actionName === "stop") {
           await dashContainer.stop();
           await dbAdapter.insertAuditLog({ instance_id: req.params.id, action: "stop_container", user_id: req.user.id, timestamp: new Date().toISOString(), details: `User triggered manual stop container` }).catch(()=>console.error);
         } else if (actionName === "restart") {
           await dashContainer.restart();
           await dbAdapter.insertAuditLog({ instance_id: req.params.id, action: "restart_container", user_id: req.user.id, timestamp: new Date().toISOString(), details: `User triggered manual restart container` }).catch(()=>console.error);
         }
      };

      await performAction(action);
      if (action === "stop") {
        await wrappedUpdateStatus.run({ status: "stopped", id: req.params.id });
        io.emit(`deploy_status_${req.params.id}`, "stopped");
      } else if (action === "start" || action === "restart") {
        const startNow = new Date().toISOString();
        await dbAdapter.updateInstanceVersionInfo(req.params.id, { started_at: startNow }).catch(() => {});
        const config = JSON.parse(instance.config_json || "{}");
        startPeriodicAgentDbSync(req.params.id, config);
        await wrappedUpdateStatus.run({ status: transientStatus, id: req.params.id });
        const { runInstanceHealthChecks } = await import("../../deployment");
        runInstanceHealthChecks(ctx.instanceId, ctx.gatewayHostPort, ctx.dashboardHostPort, ctx.subdomain, io, wrappedUpdateStatus, "manual");
      }
      
      res.json({ success: true, status: transientStatus });
    } catch (e: any) {
      console.error("[Instance Action Error]", e);
      res.status(500).json({
        error: "INSTANCE_ACTION_FAILED",
        code: "INSTANCE_ACTION_FAILED",
        message: "实例操作未能完成，请检查容器运行状态后重试。"
      });
    }
  });

  router.post("/:id/health-check", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const triggerSource = req.body?.trigger_source || "manual";

      const ctx = buildDeploymentContext(instance);

      const wrappedUpdateStatus = {
        run: async (params: {status: string, id: string}) => {
          await dbAdapter.updateInstanceStatus(params.id, params.status);
          io.emit("instances_updated", { id: params.id, status: params.status });
        }
      };

      const { runInstanceHealthChecks } = await import("../../deployment");
      runInstanceHealthChecks(ctx.instanceId, ctx.gatewayHostPort, ctx.dashboardHostPort, ctx.subdomain, io, wrappedUpdateStatus, triggerSource);

      res.json({ success: true, message: "Health check triggered successfully." });
    } catch (e: any) {
      console.error("[Actions API] Health check error:", e);
      res.status(500).json({ error: "服务器内部异常，健康检查失败" });
    }
  });

  router.get("/:id/healthz", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const instance: any = await dbAdapter.getInstanceById(id);
      if (!instance) return res.status(404).json({ success: false, error: "Instance not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin' && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }

      const ctx = buildDeploymentContext(instance);
      let containerRunning = false;
      let containerStatusStr = "unknown";
      let containerLabels: { [key: string]: string } | null = null;

      {        try {
          const container = docker.getContainer(ctx.containerName);
          const state = await container.inspect();
          containerRunning = state.State.Running;
          containerStatusStr = state.State.Status;
          containerLabels = state.Config.Labels || null;
        } catch (e) {}
      }

      let configObj: any = {};
      try {
        if (instance.config_json) {
          configObj = JSON.parse(instance.config_json);
        }
      } catch (e) {}

      let debugObj: any = null;
      if (req.user.role === 'admin') {
        {
          const routerName = getTraefikRouterName(id);
          const authMiddlewareName = getTraefikAuthMiddlewareName(routerName);
          const labelKey = `traefik.http.middlewares.${authMiddlewareName}.forwardauth.address`;
          const actualLabelValue = containerLabels ? containerLabels[labelKey] : undefined;

          const isProtected = !!configObj.webPasswordHash;

          const hasLegacyPattern = !!(
            actualLabelValue && (
              actualLabelValue.includes("hermes-console-blue") || 
              actualLabelValue.includes("hermes-console-green") || 
              actualLabelValue.includes("hermes-saas-console")
            )
          );
          const consoleInternalUrl = process.env.INSTANCE_AUTH_INTERNAL_URL || process.env.CONTROL_PLANE_INTERNAL_URL;
          const expectedLabelValue = consoleInternalUrl ? `${consoleInternalUrl}/api/public/instances/auth-check` : undefined;
          const isMismatch = !!(expectedLabelValue && actualLabelValue && actualLabelValue !== expectedLabelValue);
          const isMissingLabel = isProtected && !actualLabelValue;
          const isLegacyLabel = hasLegacyPattern || isMismatch || isMissingLabel;

          let legacyLabelReason = "未检测到异常";
          if (isLegacyLabel) {
            if (hasLegacyPattern) {
              legacyLabelReason = "检测到使用了过期的蓝绿部署内部主机名 (包含 hermes-console-blue, hermes-console-green 或 hermes-saas-console)";
            } else if (isMismatch) {
              legacyLabelReason = `检测到当前 forwardauth 目标地址与系统最新配置的主控内部服务地址不一致 (期望: ${expectedLabelValue}, 实际: ${actualLabelValue})`;
            } else if (isMissingLabel) {
              legacyLabelReason = "应有 ForwardAuth 标签但当前缺失，建议自愈重建";
            }
          } else {
            if (!isProtected) {
              legacyLabelReason = "实例未启用轻量登录保护，无 ForwardAuth 标签需求";
            } else if (actualLabelValue === expectedLabelValue) {
              legacyLabelReason = `完美匹配：当前 ForwardAuth 标签与系统最新主控配置一致 (${actualLabelValue})`;
            } else if (!consoleInternalUrl) {
              legacyLabelReason = "系统未配置 INSTANCE_AUTH_INTERNAL_URL 或 CONTROL_PLANE_INTERNAL_URL 环境变量";
            }
          }

          const recommendSelfHeal = isProtected && isLegacyLabel;

          debugObj = {
            containerLabels: containerLabels || null,
            forwardAuthAddress: actualLabelValue || null,
            isLegacyLabel,
            legacyLabelReason,
            isProtected,
            isRunning: containerRunning,
            recommendSelfHeal,
            expectedForwardAuthAddress: expectedLabelValue || null,
            sysInternalUrl: consoleInternalUrl || null
          };
        }
      }

      res.json({
        success: true,
        instanceId: id,
        remote_managed: false,
        status: instance.status,
        gateway_status: instance.gateway_status || (instance.status === "gateway_ready" || instance.status === "running" ? "running" : "unknown"),
        gateway_ready: instance.gateway_ready !== undefined ? !!instance.gateway_ready : (instance.status === "gateway_ready" || instance.status === "running"),
        gateway_checked_at: instance.gateway_checked_at || null,
        gateway_error: instance.gateway_error || null,
        gateway_services: instance.gateway_services || null,
        dashboard: {
          enabled: configObj.enableDashboard !== false,
          online: configObj.enableDashboard !== false && containerRunning && ["running", "partial_running", "dashboard_ready", "gateway_starting", "gateway_ready"].includes(instance.status),
          status: containerStatusStr,
          port: ctx.internal_web_port,
          isAuthConfigured: configObj.enableDashboard !== false && !!(
            configObj.webPasswordHash &&
            configObj.dashboardAuthSecret &&
            configObj.hermesDashboardAuthSecret &&
            tryResolvePlainInstancePassword(configObj)
          ),
          diagnostics: {
            hasPassword: !!configObj.password,
            hasWebPasswordHash: !!configObj.webPasswordHash,
            hasDashboardAuthSecret: !!configObj.dashboardAuthSecret,
            hasHermesDashboardAuthSecret: !!configObj.hermesDashboardAuthSecret,
            passwordParts: typeof configObj.password === 'string' ? configObj.password.split(':').length : 0,
            encryptionKeyConfigured: isEncryptionKeyConfigured(),
            fingerprint: getEncryptionKeyFingerprint(),
            nativeDashboardAuthSupported: supportsNativeDashboardBasicAuth({
              agentImage: instance.agent_image,
              agentImageTag: instance.agent_image_tag,
              agentVersion: instance.agent_version || instance.resolved_version,
              capabilities: instance.capabilities || configObj.capabilities,
              config: configObj
            }),
            hasHermesDashboardPasswordHash: !!configObj.hermesDashboardPasswordHash,
            agentImageTag: instance.agent_image_tag || null,
            errorCode: instance.deployment_error ? "HERMES_DASHBOARD_AUTH_PROVIDER_MISSING" : null
          }
        },
        gateway: {
          online: containerRunning && ["running", "gateway_ready"].includes(instance.status) && (instance.gateway_ready !== undefined ? !!instance.gateway_ready : true),
          status: instance.gateway_status || (instance.status === "gateway_ready" || instance.status === "running" ? "ready" : "starting"),
          port: ctx.host_port || ctx.gatewayHostPort || 15929
        },
        model: {
          expected_provider: instance.model_provider || configObj.provider || "",
          expected_model: instance.model_name || configObj.model || "",
          config_status: instance.model_config_status || "unknown",
          runtime_status: instance.model_runtime_status || "unknown",
          runtime_details: instance.model_runtime_details || ""
        },
        env: sanitizeConfig({
          internal_web_port: ctx.internal_web_port,
          host_port: ctx.host_port || ctx.gatewayHostPort || 15929,
          channel: configObj.channel || "default",
          skills: configObj.skills || [],
          max_turns: configObj.maxTurns || 12,
          gateway_timeout: configObj.gatewayTimeout || 3600
        }),
        debug: debugObj
      });
    } catch (err: any) {
      console.error("[Actions API] Logs reset error:", err);
      res.status(500).json({ success: false, error: "清除部署日志失败，服务器异常" });
    }
  });

  router.post("/:id/test-auth", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }
      
      const Protocol = instance.url.startsWith('https') ? https : http;
      const reqCall = Protocol.get(instance.url, (clientRes: any) => {
        res.json({ statusCode: clientRes.statusCode });
        clientRes.resume();
      }).on('error', (err: any) => {
        console.error("[Actions API] Demo proxy error:", err);
        res.json({ statusCode: 500, error: "网关请求异常" });
      });
      reqCall.setTimeout(5000, () => reqCall.destroy());
    } catch (e: any) {
      console.error("[Actions API] Outer demo proxy error:", e);
      res.status(500).json({ error: "服务器内部异常" });
    }
  });

  router.post("/:id/run-business-task", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    let instance: any = null;
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({
        code: "TEMPLATE_WORKFLOWS_DISABLED",
        error: "Template workflow tasks are disabled in this MyBay Open Source installation."
      });
    }
    let templateKey = "unknown";
    try {
      instance = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const configJson = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
      const { parseInstanceRuntimeContext } = await import("../../services/instanceRuntimeContext");
      
      const runtimeContext = parseInstanceRuntimeContext(
        instance,
        configJson,
        configJson.businessConfig || {}
      );
      templateKey = runtimeContext.templateKey;

      const executionInputs = {
        ...(configJson.template_inputs || {}),
        ...(runtimeContext.businessContext || {}),
        ...(req.body?.template_inputs || {})
      };
      const { readiness } = await evaluateInstanceWorkflowReadiness({
        instanceId: instance.id,
        instanceOverride: instance,
        configOverride: configJson,
        executionPayload: { template_inputs: executionInputs },
        templateId: templateKey
      });

      if (!readiness.ready) {
        await dbAdapter.insertAuditLog({
          instance_id: instance.id,
          action: "manual_business_task",
          user_id: req.user.id,
          timestamp: new Date().toISOString(),
          details: JSON.stringify({
            status: "config_required",
            templateKey,
            missingRequirements: readiness.missingRequirements,
            error: readiness.message
          })
        });
        return res.status(422).json({
          error: "WORKFLOW_CONFIG_REQUIRED",
          message: readiness.message,
          missing_requirements: readiness.missingRequirements
        });
      }

      const task = await tasksRepo.create({
        owner_id: instance.user_id,
        instance_id: instance.id,
        template_id: templateKey,
        title: req.body?.title || `${templateKey} 手动执行`,
        trigger_type: "manual_business_task",
        prompt: req.body?.prompt || null,
        status: "queued",
        input_payload: {
          template_slug: templateKey,
          template_inputs: executionInputs,
          business_context: runtimeContext.businessContext,
          requested_at: new Date().toISOString()
        }
      });
      if (!task?.id) throw new Error("Task creation did not return an id.");
      await dbAdapter.insertAuditLog({
        instance_id: instance.id,
        action: "manual_business_task",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: JSON.stringify({ status: "queued", templateKey, taskId: task.id })
      });
      executeTaskInBackground(task.id).catch((error) =>
        console.error(`[Actions API] Manual business task ${task.id} failed:`, error)
      );
      return res.status(202).json({ success: true, taskId: task.id, status: "queued" });
    } catch (e: any) {
      console.error("[Actions API] Run business task error:", e);
      if (instance) {
        await dbAdapter.insertAuditLog({
          instance_id: instance.id,
          action: "manual_business_task",
          user_id: req.user?.id || 'system',
          timestamp: new Date().toISOString(),
          details: JSON.stringify({
            status: "failed",
            error: e.message || "Unknown error",
            runType: "initial_competitor_scan",
            templateKey: templateKey
          })
        }).catch((err: any) => console.error("Failed to log failed business task:", err));
      }
      res.status(500).json({ error: "Server error", message: sanitizeErrorMessage(e.message) });
    }
  });

  router.get("/:id/business-runs", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const limit = parseInt(req.query.limit as string) || 5;
      const logs = await dbAdapter.getAuditLogs(instance.id);
      
      const runs = logs
        .filter((log: any) => log.action === "manual_business_task")
        .map((log: any) => {
          let parsedDetails: any = {};
          try {
            parsedDetails = JSON.parse(log.details);
          } catch (e) {
            parsedDetails = { error: "Parse failed" };
          }
          return {
            id: log.id,
            timestamp: log.timestamp || log.created_at,
            status: parsedDetails.status || "unknown",
            runType: parsedDetails.result?.runType || parsedDetails.runType || "unknown",
            result_json: parsedDetails.result || null,
            error: parsedDetails.error || null
          };
        })
        .slice(0, limit);

      res.json({ runs });
    } catch (e: any) {
      console.error("[Actions API] Get business runs error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.get("/:id/dashboard-credentials", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
      const isConfigured = !!(
        config.webPasswordHash &&
        config.dashboardAuthSecret &&
        config.hermesDashboardAuthSecret &&
        tryResolvePlainInstancePassword(config)
      );
      
      res.json({
        username: config.username || "admin",
        configured: isConfigured
      });
    } catch (e: any) {
      console.error("[Actions API] Get dashboard credentials error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/:id/reset-password", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });
      if (instance.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }

      const { password } = req.body;
      if (!password || typeof password !== "string" || password.trim() === "") {
        return res.status(400).json({ error: "密码不能为空" });
      }

      const config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
      
      // Update config with new password encrypted and hashed
      config.webPasswordHash = bcrypt.hashSync(password, 10);
      config.password = encrypt(password);
      delete config.dashboardAuthSecret;
      delete config.hermesDashboardAuthSecret;
      ensureEncryptedDashboardAuthSecret(config);

      await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));

      // Trigger automatic redeployment
      await wrappedUpdateStatus.run({ status: "deploying", id: instance.id });
      
      const { cleanOldContainersOfInstance } = await import("../../deployment");
      cleanOldContainersOfInstance(instance.id, io).then(() => {
        executeDeployment(instance, io, wrappedUpdateStatus, config, req.user);
      }).catch((err) => {
        console.error("Clean old containers failed during reset password:", err);
        executeDeployment(instance, io, wrappedUpdateStatus, config, req.user);
      });

      res.json({
        success: true,
        message: "密码重置成功，实例正在重新部署应用新密码...",
        username: config.username || "admin",
        password
      });
    } catch (e: any) {
      console.error("[Actions API] Reset password error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  return router;
}


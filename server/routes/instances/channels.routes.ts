import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext, rebuildProxyConfig } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { RouterDependencies } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt } from "../../crypto";
import bcrypt from "bcryptjs";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";
import { cancelChannelQrSession, getChannelQrSession, publicChannelQrSession, startChannelQrSession, type ChannelQrKind } from "../../utils/channelQrOnboarding";
import { getChannelCapabilities } from "../../../shared/channelRegistry";
import { ErrorCodes } from "../../../shared/errorCodes";
import { channelAuthEventsRepo, normalizeChannelAuthPlatform } from "../../repositories/channelAuthEventsRepo";

function canManageInstanceChannels(instance: any, user: any): boolean {
  const isOwner = instance.user_id === user.id || instance.owner_id === user.id;
  const isPrivileged = user.role === "admin" || user.role === "super_admin";
  return isOwner || isPrivileged;
}

function emitChannelAuthEventsChanged(io: any, instance: any) {
  const payload = { instanceId: instance.id };
  const ownerId = instance.user_id || instance.owner_id;
  if (ownerId) {
    io.to(`channel-auth:user:${ownerId}`).emit("channel_auth_events_changed", payload);
  }
  io.to("channel-auth:admins").emit("channel_auth_events_changed", payload);
}

export function createChannelsRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.post("/channel-onboarding/:channel/qr/start", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const channel = String(req.params.channel) as ChannelQrKind;
    if (!getChannelCapabilities(channel)?.supportsQr) {
      return res.status(400).json({ success: false, error: "QR_CHANNEL_UNSUPPORTED" });
    }
    const session = await startChannelQrSession(String(req.user.id), channel);
    return res.json({ success: true, session: publicChannelQrSession(session) });
  });

  router.get("/channel-onboarding/qr/:sessionId", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
    const session = getChannelQrSession(String(req.user.id), req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: "QR_SESSION_NOT_FOUND" });
    return res.json({ success: true, session: publicChannelQrSession(session) });
  });

  router.post("/channel-onboarding/qr/:sessionId/cancel", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
    const session = cancelChannelQrSession(String(req.user.id), req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: "QR_SESSION_NOT_FOUND" });
    return res.json({ success: true, session: publicChannelQrSession(session) });
  });

  router.post("/channel-auth-events/scan", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instances = await dbAdapter.getInstances(String(req.user.id), String(req.user.role));
      let captured = 0;
      const { getContainerLogTail } = await import("../../healthCheck");
      const { scanLogsForAuthEvents } = await import("../../utils/logParser");
      for (const instance of instances.filter((candidate: any) => canManageInstanceChannels(candidate, req.user))) {
        const isRunning = instance.status === "running" || instance.status === "partial_running" || instance.physical_status === "running";
        if (!isRunning) continue;
        try {
          const containerName = instance.container_name || `mybay-agent-${instance.id}`;
          const logs = await getContainerLogTail(containerName, 200);
          if (!logs) continue;
          const newEvents = await scanLogsForAuthEvents(instance.id, logs);
          if (newEvents.length > 0) {
            captured += newEvents.length;
            emitChannelAuthEventsChanged(io, instance);
          }
        } catch (scanError: any) {
          console.warn(`[Channels API] Failed to scan auth events for instance ${instance.id}:`, scanError?.message || scanError);
        }
      }
      res.json({ success: true, captured });
    } catch (e: any) {
      console.error("[Channels API] Global channel auth scan error:", e);
      res.status(500).json({ error: "\u626b\u63cf\u5f85\u6388\u6743\u4e8b\u4ef6\u5931\u8d25\uff0c\u670d\u52a1\u5668\u5185\u90e8\u5f02\u5e38", code: "CHANNEL_AUTH_SCAN_FAILED" });
    }
  });

  router.get("/channel-auth-events/pending", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instances = await dbAdapter.getInstances(String(req.user.id), String(req.user.role));
      const pendingGroups = await Promise.all(instances
        .filter((instance: any) => canManageInstanceChannels(instance, req.user))
        .map(async (instance: any) => {
          const events = await channelAuthEventsRepo.listByInstance(instance.id);
          return events
            .filter((event) => event.status === "pending")
            .map((event) => ({
              ...event,
              instance_name: instance.name || instance.display_name || instance.container_name || instance.id,
            }));
        }));
      const events = pendingGroups
        .flat()
        .sort((a, b) => String(b.last_seen_at || b.created_at).localeCompare(String(a.last_seen_at || a.created_at)));
      const { redactSecretsDeep } = require("../../utils/sanitizer");
      res.json(redactSecretsDeep(events));
    } catch (e: any) {
      console.error("[Channels API] Pending channel auth events error:", e);
      res.status(500).json({ error: "\u83b7\u53d6\u5f85\u6388\u6743\u4e8b\u4ef6\u5931\u8d25\uff0c\u670d\u52a1\u5668\u5185\u90e8\u5f02\u5e38", code: "CHANNEL_AUTH_PENDING_LIST_FAILED" });
    }
  });

  router.get("/:id/channel-auth-events", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (!canManageInstanceChannels(instance, req.user)) {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }
      const events = await channelAuthEventsRepo.listByInstance(req.params.id);
      const { redactSecretsDeep } = require("../../utils/sanitizer");
      res.json(redactSecretsDeep(events));
    } catch (e: any) {
      console.error("[Channels API] Channel status check error:", e);
      res.status(500).json({ error: "获取通道状态失败，服务器内部异常" });
    }
  });

  router.post("/:id/channel-auth-events/scan", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "实例不存在" });
      }
      if (!canManageInstanceChannels(instance, req.user)) {
        return res.status(403).json({ error: "没有该实例的管理权限" });
      }

      let logs = "";
      {
        const { getContainerLogTail } = require("../../healthCheck");
        const containerName = instance.container_name || `mybay-agent-${instance.id}`;
        logs = await getContainerLogTail(containerName, 300);
      }

      if (logs) {
        const { scanLogsForAuthEvents } = require("../../utils/logParser");
        await scanLogsForAuthEvents(instance.id, logs);
      }

      const events = await channelAuthEventsRepo.listByInstance(req.params.id);
      const { redactSecretsDeep } = require("../../utils/sanitizer");
      res.json(redactSecretsDeep(events));
    } catch (e: any) {
      console.error("[Channels API] Channel auth events scan error:", e);
      res.status(500).json({ error: "扫描授权事件失败，服务器内部异常" });
    }
  });

  router.post("/:id/channel-auth-events/:eventId/ignore", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }
      if (!canManageInstanceChannels(instance, req.user)) {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }
      const event = await channelAuthEventsRepo.getById(req.params.eventId);
      if (!event || event.instance_id !== instance.id) {
        return res.status(404).json({ error: "Channel authorization event not found", code: "CHANNEL_AUTH_EVENT_NOT_FOUND" });
      }
      const updated = await channelAuthEventsRepo.updateStatus(req.params.eventId, 'ignored', req.user.username);
      emitChannelAuthEventsChanged(io, instance);
      res.json({ success: true, event: updated });
    } catch (e: any) {
      console.error("[Channels API] Ignore event error:", e);
      res.status(500).json({ error: "忽略通道授权事件失败，服务器内部异常" });
    }
  });

  router.post("/:id/channel-auth-events/:eventId/approve", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // 1. Verify current user has admin/owner rights to manage the instance
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "实例不存在" });
      }
      if (!canManageInstanceChannels(instance, req.user)) {
        return res.status(403).json({ error: "没有该实例的管理权限" });
      }

      // 2. Fetch the corresponding event
      const event = await channelAuthEventsRepo.getById(req.params.eventId);
      if (!event || event.instance_id !== instance.id) {
        return res.status(404).json({ error: "通道授权申请事件不存在" });
      }

      // 3. Resolve existing config
      const config = JSON.parse(instance.config_json || "{}");
      
      const appendToAllowlist = (current: string | undefined | null, idToAppend: string): string => {
        if (!idToAppend || !idToAppend.trim()) return current || '';
        if (!current || !current.trim()) {
          return idToAppend.trim();
        }
        const items = current.split(",").map(i => i.trim()).filter(Boolean);
        if (items.includes(idToAppend.trim())) {
          return items.join(",");
        }
        items.push(idToAppend.trim());
        return items.join(",");
      };

      // 4. Unified logic to map Event fields to Channel config keys (applyChannelAllowlist)
      const platform = normalizeChannelAuthPlatform(event.platform);
      if (platform === "telegram") {
        if (event.external_user_id) {
          config.telegramAllowedUsers = appendToAllowlist(config.telegramAllowedUsers, event.external_user_id);
          // 确保 user_id 也加入到 telegramAllowedChats，因为在某些场景下，用户私聊的 chatId 就是 user_id
          config.telegramAllowedChats = appendToAllowlist(config.telegramAllowedChats, event.external_user_id);
        }
        if (event.external_chat_id) {
          config.telegramAllowedChats = appendToAllowlist(config.telegramAllowedChats, event.external_chat_id);
        }
        if (event.external_group_id) {
          config.telegramAllowedChats = appendToAllowlist(config.telegramAllowedChats, event.external_group_id);
        }
      } else if (platform === "feishu") {
        if (event.external_user_id) {
          config.feishuAllowedUsers = appendToAllowlist(config.feishuAllowedUsers, event.external_user_id);
        }
        if (event.external_chat_id) {
          config.feishuAllowedChats = appendToAllowlist(config.feishuAllowedChats, event.external_chat_id);
        }
        if (event.external_group_id) {
          config.feishuAllowedChats = appendToAllowlist(config.feishuAllowedChats, event.external_group_id);
        }
      } else if (platform === "discord") {
        if (event.external_user_id) {
          config.discordAllowedUsers = appendToAllowlist(config.discordAllowedUsers, event.external_user_id);
        }
        if (event.external_channel_id) {
          config.discordAllowedChannels = appendToAllowlist(config.discordAllowedChannels, event.external_channel_id);
        }
        if (event.external_chat_id) {
          config.discordAllowedChannels = appendToAllowlist(config.discordAllowedChannels, event.external_chat_id);
        }
        if (event.external_group_id) {
          config.discordAllowedGuilds = appendToAllowlist(config.discordAllowedGuilds, event.external_group_id);
        }
      } else if (platform === "slack") {
        if (event.external_user_id) {
          config.slackAllowedUsers = appendToAllowlist(config.slackAllowedUsers, event.external_user_id);
        }
        if (event.external_channel_id) {
          config.slackAllowedChannels = appendToAllowlist(config.slackAllowedChannels, event.external_channel_id);
        }
        if (event.external_chat_id) {
          config.slackAllowedChannels = appendToAllowlist(config.slackAllowedChannels, event.external_chat_id);
        }
      } else if (platform === "dingtalk") {
        if (event.external_user_id) {
          config.dingtalkAllowedUsers = appendToAllowlist(config.dingtalkAllowedUsers, event.external_user_id);
        }
        if (event.external_chat_id) {
          config.dingtalkAllowedChats = appendToAllowlist(config.dingtalkAllowedChats, event.external_chat_id);
        }
        if (event.external_group_id) {
          config.dingtalkAllowedChats = appendToAllowlist(config.dingtalkAllowedChats, event.external_group_id);
        }
      } else if (platform === "whatsapp") {
        if (event.external_user_id) {
          config.whatsappAllowedUsers = appendToAllowlist(config.whatsappAllowedUsers, event.external_user_id);
        }
        if (event.external_channel_id) {
          config.whatsappAllowedChannels = appendToAllowlist(config.whatsappAllowedChannels, event.external_channel_id);
        }
        if (event.external_chat_id) {
          config.whatsappAllowedChannels = appendToAllowlist(config.whatsappAllowedChannels, event.external_chat_id);
        }
      } else if (platform === "qq_bot") {
        if (event.external_user_id) {
          config.qqBotAllowedUsers = appendToAllowlist(config.qqBotAllowedUsers, event.external_user_id);
        }
        if (event.external_channel_id) {
          config.qqBotAllowedChannels = appendToAllowlist(config.qqBotAllowedChannels, event.external_channel_id);
        }
        if (event.external_chat_id) {
          config.qqBotAllowedChannels = appendToAllowlist(config.qqBotAllowedChannels, event.external_chat_id);
        }
        if (event.external_group_id) {
          config.qqBotAllowedGuilds = appendToAllowlist(config.qqBotAllowedGuilds, event.external_group_id);
        }
      } else if (platform === "wechat_mp") {
        if (event.external_user_id) {
          config.wechatMpAllowedUsers = appendToAllowlist(config.wechatMpAllowedUsers, event.external_user_id);
        }
        if (event.external_chat_id) {
          config.wechatMpAllowedChats = appendToAllowlist(config.wechatMpAllowedChats, event.external_chat_id);
        }
      } else if (platform === "wecom") {
        if (event.external_user_id) {
          config.wecomAllowedUsers = appendToAllowlist(config.wecomAllowedUsers, event.external_user_id);
        }
        if (event.external_chat_id) {
          config.wecomAllowedChats = appendToAllowlist(config.wecomAllowedChats, event.external_chat_id);
        }
        if (event.external_group_id) {
          config.wecomAllowedChats = appendToAllowlist(config.wecomAllowedChats, event.external_group_id);
        }
      } else if (platform === "weixin") {
        if (event.external_user_id) config.weixinAllowedUsers = appendToAllowlist(config.weixinAllowedUsers, event.external_user_id);
        if (event.external_chat_id) config.weixinAllowedChats = appendToAllowlist(config.weixinAllowedChats, event.external_chat_id);
        if (event.external_group_id) config.weixinAllowedChats = appendToAllowlist(config.weixinAllowedChats, event.external_group_id);
      } else if (platform === "webhook") {
        if (event.external_user_id) {
          config.webhookAllowedUsers = appendToAllowlist(config.webhookAllowedUsers, event.external_user_id);
        }
        if (event.external_channel_id) {
          config.webhookAllowedChannels = appendToAllowlist(config.webhookAllowedChannels, event.external_channel_id);
        }
      }

      // 5. Regenerate actual config & credentials environment on physical disk (.env, config.yaml, mybay.instance.yaml)
      const { writePhysicalConfigs } = await import("../../configWriter");
      const { hydrateA2ARuntimePeers } = await import("../../services/a2aRuntimeConfig");
      await hydrateA2ARuntimePeers(instance.id, config);
      const { finalEnvMap } = writePhysicalConfigs(instance.id, config);

      // 6. Connect to docker to signal reload
      const { docker } = await import("../../lib/docker");
      const containerName = `mybay-agent-${instance.id}`;
      const container = docker.getContainer(containerName);

      // Perform a direct config synchronization to ~/.hermes inside guest to cover both search scopes
      try {
        const syncCmd = await container.exec({
          Cmd: ["sh", "-c", "mkdir -p ~/.hermes && cp -f /opt/data/.env ~/.hermes/.env 2>/dev/null && cp -f /opt/data/config.yaml ~/.hermes/config.yaml 2>/dev/null || true"],
          AttachStdout: true,
          AttachStderr: true
        });
        const syncStream = await syncCmd.start({ Detach: false });
        await new Promise<void>((resolveSync) => {
          syncStream.on("data", () => {});
          syncStream.on("end", resolveSync);
          syncStream.on("error", () => resolveSync());
        });
      } catch (syncErr: any) {
        console.warn(`[SyncHermesHomeDirWarning] Failed to synchronize files to ~/.hermes inside container:`, syncErr.message);
      }

      // Signal service reload internally (graceful restart of gateway s6 runner service) without restarting the container
      const serviceName = "gateway";
      const possibleDirs = [
        `/run/service/${serviceName}-default`,
        `/var/run/s6/services/${serviceName}-default`,
        `/run/s6-rc/servicedirs/${serviceName}-default`,
        `/run/service/${serviceName}`,
        `/var/run/s6/services/${serviceName}`
      ];
      const possibleCmds = ["/command/s6-svc", "s6-svc"];
      
      let reloaded = false;
      let lastExecError = "未找到 gateway-default s6 服务目录";
      let probedPaths: string[] = [];

      // 1. Find valid service directory
      let validDir: string | null = null;
      for (const p of possibleDirs) {
        probedPaths.push(p);
        try {
          const checkDir = await container.exec({ 
            Cmd: ["sh", "-c", `[ -d "${p}" ] && echo "FOUND"`],
            AttachStdout: true,
            AttachStderr: true
          });
          const stream = await checkDir.start({ Detach: false });
          let output = "";
          await new Promise<void>(res => { 
            stream.on("data", (chunk: Buffer) => { output += chunk.toString(); }); 
            stream.on("end", () => res()); 
          });
          if (output.includes("FOUND")) {
            validDir = p;
            break;
          }
        } catch (e) {}
      }

      // 2. Perform reload/restart signal
      if (validDir) {
        for (const cmd of possibleCmds) {
          try {
            // Internal helper to try multiple signals
            const trySignal = async (sig: string) => {
              const execObj = await container.exec({
                Cmd: [cmd, sig, validDir],
                AttachStdout: true, AttachStderr: true
              });
              const stream = await execObj.start({ Detach: false });
              let execOutput = "";
              await new Promise<void>(r => { 
                stream.on("data", (chunk: Buffer) => { execOutput += chunk.toString(); }); 
                stream.on("end", () => r()); 
              });
              const inspect = await execObj.inspect();
              return { success: inspect.ExitCode === 0, code: inspect.ExitCode, output: execOutput };
            };

            // Signal priority: -h (SIGHUP; reload config if supported) -> -t (SIGTERM; graceful restart) -> -r (t-u combo)
            const resH = await trySignal("-h");
            if (resH.success) {
              reloaded = true;
              console.log(`[GracefulGatewayReload] HUP signal (-h) sent to ${validDir} via ${cmd}`);
              break;
            }

            const resT = await trySignal("-t");
            if (resT.success) {
              reloaded = true;
              console.log(`[GracefulGatewayRestart] TERM signal (-t) sent to ${validDir} via ${cmd}`);
              break;
            }

            const resR = await trySignal("-r");
            if (resR.success) {
              reloaded = true;
              console.log(`[GracefulGatewayRestart] Restart signal (-r) sent to ${validDir} via ${cmd}`);
              break;
            }

            lastExecError = `${cmd} execution failed on ${validDir} for signals -h, -t, -r. (Last exit code: ${resR.code})`;
          } catch (err: any) {
            console.error("[Channels API] Reload gateway error:", err);
            lastExecError = `执行 ${cmd} 异常`;
          }
        }
      } else {
        lastExecError = `无法定位有效的网关 s6 服务目录。探测路径: ${probedPaths.join(", ")}`;
      }

      if (!reloaded) {
        throw new Error(`网关重新加载服务失败: ${lastExecError}`);
      }

      // 7. Persist to DB (instances.config_json, instances.env_config, metadata)
      const existingMetadata = instance.metadata || {};
      const updatedMetadata = {
        ...existingMetadata,
        last_applied_allowlist_at: new Date().toISOString()
      };
      await dbAdapter.updateInstanceVersionInfo(instance.id, {
        config_json: config,
        env_config: finalEnvMap,
        metadata: updatedMetadata
      });

      // 8. Update authorization event status only upon absolute success
      await channelAuthEventsRepo.updateStatus(req.params.eventId, 'approved', req.user.username);
      const updatedEvent = await channelAuthEventsRepo.getById(req.params.eventId);
      emitChannelAuthEventsChanged(io, instance);

      // 9. Clear health cache and trigger background refresh so UI reflects new status immediately
      try {
        const { clearInstanceHealthCheckCache, runInstanceHealthChecks } = await import("../../deployment");
        clearInstanceHealthCheckCache(instance.id);
        
        // Trigger background refresh (fire and forget)
        const ctx2 = buildDeploymentContext(instance);
        const io = (req.app as any).get("io");
        const wrappedUpdateStatus = async (id: string, stat: string) => {
          await dbAdapter.updateInstanceStatus(id, stat);
        };
        runInstanceHealthChecks(instance.id, ctx2.host_port, ctx2.internal_web_port, ctx2.subdomain, io, wrappedUpdateStatus, "manual");
      } catch (diagErr) {
        console.error("[ApprovalRefreshError] Failed to trigger background health check:", diagErr);
      }

      // 10. Perform dynamic lightweight channel-only status check to provide immediate postCheck status
      let postCheckStatus: "checking" | "connected" | "pending" | "reload_required" | "failed" = "checking";
      let postCheckMessage = "已应用授权，正在重新检测通道状态...";
      let postCheckReason: string | undefined = undefined;
      let currentChannelStatus: any = {};

      if (instance.status === "running" || instance.health_status === "healthy") {
        try {
          const { probeGatewayReadiness, getContainerLogTail } = require("../../healthCheck");
          const { buildDeploymentContext } = require("../../deployment");
          const ctx = buildDeploymentContext(instance);
          const dashboardContainerName = ctx.dashboardContainerName;
          const { docker } = require("../../lib/docker");
          const container = docker.getContainer(dashboardContainerName);
          
          const state = await container.inspect().catch(() => null);
          if (state && state.State?.Running) {
            let enabledChannels: string[] = [];
            if (config) {
              if (Array.isArray(config.channel)) {
                enabledChannels = config.channel.map((c: string) => c.toLowerCase());
              } else if (typeof config.channel === 'string') {
                enabledChannels = [config.channel.toLowerCase()];
              }
            }
            
            const logsTail = await getContainerLogTail(dashboardContainerName, 300).catch(() => "");
            const gatewayProbe = await probeGatewayReadiness(container, instance.id, logsTail, enabledChannels);
            
            if (gatewayProbe && gatewayProbe.channel_status) {
              const updatedMetadata = {
                ...(instance.metadata || {}),
                gateway_status: gatewayProbe.gateway_status,
                gateway_ready: gatewayProbe.gateway_ready,
                gateway_checked_at: gatewayProbe.checked_at,
                gateway_error: gatewayProbe.gateway_error,
                gateway_services: gatewayProbe.gateway_services,
                configured_channels: gatewayProbe.configured_channels,
                connected_channels: gatewayProbe.connected_channels,
                channel_status: gatewayProbe.channel_status
              };
              await dbAdapter.updateInstanceVersionInfo(instance.id, {
                metadata: updatedMetadata,
                health_status: gatewayProbe.gateway_ready ? "healthy" : "unhealthy",
                last_health_check_at: gatewayProbe.checked_at,
                ready_at: gatewayProbe.gateway_ready ? gatewayProbe.checked_at : (instance.ready_at || null),
                error_message: gatewayProbe.gateway_error || null
              }).catch(() => {});
              
              currentChannelStatus = gatewayProbe.channel_status;
              const targetChannelStatus = currentChannelStatus[platform] || {};
              if (targetChannelStatus.status === "connected") {
                postCheckStatus = "connected";
                postCheckMessage = "通道已成功连接并激活";
              } else if (targetChannelStatus.status === "awaiting_authorization") {
                postCheckStatus = "pending";
                postCheckMessage = "已写入白名单，等待通道下一次消息确认";
              } else if (targetChannelStatus.status === "pending" && targetChannelStatus.botReachable) {
                postCheckStatus = "pending";
                postCheckMessage = "授权已生效，请在 Telegram 再发送一条消息完成通道确认";
                postCheckReason = "waiting_for_next_message";
              } else {
                postCheckStatus = "checking";
                postCheckMessage = `已应用授权，通道当前状态：${targetChannelStatus.reason || "检测中"}`;
              }
            }
          }
        } catch (probeErr: any) {
          console.warn("[ApprovePostCheckError] Lightweight probe failed during approve:", probeErr.message);
          postCheckStatus = "checking";
          postCheckMessage = "授权已保存，由于容器通讯异常，正在后台异步重新检测...";
        }
      } else {
        postCheckStatus = "reload_required";
        postCheckMessage = "实例未运行，已保存白名单，将在实例下次启动时生效";
      }

      const { sanitizeConfig } = require("../../utils/sanitizer");
      res.json({
        success: true,
        config: sanitizeConfig(config),
        event: updatedEvent || event,
        channel_status: currentChannelStatus,
        postCheck: {
          status: postCheckStatus,
          message: postCheckMessage,
          reason: postCheckReason
        }
      });
    } catch (e: any) {
      console.error("[Channels API] Gateway reload final error:", e);
      res.status(500).json({ error: "白名单写入 / 网关配置重载失败，服务器内部异常" });
    }
  });

  router.get("/:id/channel-status", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "实例不存在" });
      }
      if (!canManageInstanceChannels(instance, req.user)) {
        return res.status(403).json({ error: "没有该实例的管理权限" });
      }

      let metadata = instance.metadata || {};
      let channelStatus = metadata.channel_status || {};
      let gatewayReady = metadata.gateway_ready || false;
      let checkedAt = metadata.gateway_checked_at || new Date().toISOString();
      let connectedCount = metadata.connected_channels || 0;
      let totalCount = metadata.configured_channels || 0;

      // Try running a lightweight probe if container is running
      try {
        const { probeGatewayReadiness, getContainerLogTail } = require("../../healthCheck");
        const { buildDeploymentContext } = require("../../deployment");
        const ctx = buildDeploymentContext(instance);
        const dashboardContainerName = ctx.dashboardContainerName;
        const { docker } = require("../../lib/docker");
        const container = docker.getContainer(dashboardContainerName);
        
        const state = await container.inspect().catch(() => null);
        if (state && state.State?.Running) {
          let enabledChannels: string[] = [];
          if (instance.config_json) {
            try {
              const configObj = typeof instance.config_json === "string"
                ? JSON.parse(instance.config_json)
                : instance.config_json;
              if (Array.isArray(configObj.channel)) {
                enabledChannels = configObj.channel.map((c: string) => c.toLowerCase());
              } else if (typeof configObj.channel === 'string') {
                enabledChannels = [configObj.channel.toLowerCase()];
              }
            } catch (e) {}
          }
          
          const logsTail = await getContainerLogTail(dashboardContainerName, 300).catch(() => "");
          const gatewayProbe = await probeGatewayReadiness(container, instance.id, logsTail, enabledChannels);
          
          if (gatewayProbe && gatewayProbe.channel_status) {
            const updatedMetadata = {
              ...(instance.metadata || {}),
              gateway_status: gatewayProbe.gateway_status,
              gateway_ready: gatewayProbe.gateway_ready,
              gateway_checked_at: gatewayProbe.checked_at,
              gateway_error: gatewayProbe.gateway_error,
              gateway_services: gatewayProbe.gateway_services,
              configured_channels: gatewayProbe.configured_channels,
              connected_channels: gatewayProbe.connected_channels,
              channel_status: gatewayProbe.channel_status
            };
            await dbAdapter.updateInstanceVersionInfo(instance.id, {
              metadata: updatedMetadata,
              health_status: gatewayProbe.gateway_ready ? "healthy" : "unhealthy",
              last_health_check_at: gatewayProbe.checked_at,
              ready_at: gatewayProbe.gateway_ready ? gatewayProbe.checked_at : (instance.ready_at || null),
              error_message: gatewayProbe.gateway_error || null
            }).catch(() => {});
            
            channelStatus = gatewayProbe.channel_status;
            gatewayReady = gatewayProbe.gateway_ready;
            checkedAt = gatewayProbe.checked_at;
            connectedCount = gatewayProbe.connected_channels || 0;
            totalCount = gatewayProbe.configured_channels || 0;
          }
        }
      } catch (probeErr: any) {
        console.warn("[ChannelStatusAPI] Lightweight probe failed, falling back to db metadata:", probeErr.message);
      }

      res.json({
        success: true,
        channel_status: channelStatus,
        connectedCount,
        totalCount,
        gateway_ready: gatewayReady,
        checkedAt
      });
    } catch (e: any) {
      console.error("[Channels API] Channel status check error:", e);
      res.status(500).json({ error: "获取通道状态失败，服务器内部异常" });
    }
  });

  router.get("/:id/channel-acceptance", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: ErrorCodes.INSTANCE_NOT_FOUND, error: "实例不存在" });
    if (!canManageInstanceChannels(instance, req.user)) return res.status(403).json({ code: ErrorCodes.INSTANCE_CHANNEL_MANAGE_FORBIDDEN, error: "没有该实例的管理权限" });
    let config: any = {};
    try { config = JSON.parse(instance.config_json || "{}"); } catch {}
    return res.json({ success: true, acceptance: config.channelAcceptance || null, channel: config.channel || "web" });
  });

  router.post("/:id/channel-acceptance", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: ErrorCodes.INSTANCE_NOT_FOUND, error: "实例不存在" });
    if (!canManageInstanceChannels(instance, req.user)) return res.status(403).json({ code: ErrorCodes.INSTANCE_CHANNEL_MANAGE_FORBIDDEN, error: "没有该实例的管理权限" });
    if (req.body?.inboundConfirmed !== true || req.body?.outboundConfirmed !== true) {
      return res.status(400).json({ code: ErrorCodes.CHANNEL_ACCEPTANCE_REQUIRED, error: "必须确认真实入站与出站消息均已成功" });
    }
    let config: any = {};
    try { config = JSON.parse(instance.config_json || "{}"); } catch {}
    const channel = String(config.channel || "web").toLowerCase();
    if (["web", "api", "none"].includes(channel)) return res.status(400).json({ code: ErrorCodes.CHANNEL_ACCEPTANCE_NOT_REQUIRED, error: "该渠道不需要外部消息验收" });
    const metadata = instance.metadata || {};
    const statuses = metadata.channel_status || {};
    const runtimeChannel = channel === "lark" ? "feishu" : channel;
    const connected = statuses[channel]?.status === "connected" || statuses[runtimeChannel]?.status === "connected" || Number(metadata.connected_channels || 0) > 0;
    if (!connected) return res.status(409).json({ code: ErrorCodes.CHANNEL_NOT_CONNECTED, error: "通道尚未连接，请先重新检测通道状态" });
    const acceptance = { channel, inboundConfirmed: true, outboundConfirmed: true, verifiedAt: new Date().toISOString(), verifiedBy: req.user.id };
    config.channelAcceptance = acceptance;
    await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
    await dbAdapter.insertAuditLog({ instance_id: instance.id, action: "channel_message_acceptance", user_id: req.user.id, timestamp: acceptance.verifiedAt, details: `Confirmed real inbound and outbound messaging for ${channel}` }).catch(() => null);
    return res.json({ success: true, acceptance });
  });

  router.post("/:id/channels/:channel/setup-session", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
    res.status(410).json({ 
      success: false, 
      error: "原生快速配置已停用，请使用平台授权向导和手动配置。" 
    });
  });

  router.get("/:id/channels/:channel/setup-session/:sessionId", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
    res.status(410).json({ 
      success: false, 
      error: "原生快速配置已停用，请使用平台授权向导和手动配置。" 
    });
  });

  router.post("/:id/channels/:channel/setup-session/:sessionId/cancel", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
    res.status(410).json({ 
      success: false, 
      error: "原生快速配置已停用，请使用平台授权向导和手动配置。" 
    });
  });

  return router;
}

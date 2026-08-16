import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext } from "../../deployment";
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
import { rebuildProxyConfig } from "../../deployment"; // Used maybe? Assumed in configWriter
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";

export function createTemplatesRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.post("/:id/template/reapply", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ error: `未找到指定的实例：${id}` });
      }
      
      // Ownership check (only owner or admin can update)
      if (instance.user_id !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "您没有配置该实例的权限" });
      }

      const config = instance.config_json ? JSON.parse(instance.config_json) : {};
      if (!config.template_id) {
        return res.status(400).json({ error: "此实例并不是由工作流模板创建的，无法执行重新应用模板操作" });
      }

      const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");
      const { writePhysicalConfigs } = await import("../../configWriter");
      const { decrypt } = require("../../crypto");

      await deploymentEventsRepo.create({
        instance_id: id,
        owner_id: req.user.id,
        step: "template_load",
        status: "success",
        message: "开始重新应用当前模板快照配置"
      }).catch(() => {});

      // Decrypt credentials in config to safely rewrite files
      const configWithDecryptedKeys = { ...config };
      const encryptedFields = [
        "apiKey", "providerApiKey", "password", "telegramBotToken", 
        "discordBotToken", "feishuAppSecret", "qqBotSecret", 
        "whatsappAccessToken", "slackBotToken", "slackSigningSecret", 
        "slackAppToken", "dingtalkAppSecret", "dingtalkRobotSecret", 
        "wechatAppSecret", "webhookSecret", "skillTavilyApiKey", 
        "skillSerperApiKey", "skillGithubToken", 
      ];
      for (const field of encryptedFields) {
        if (configWithDecryptedKeys[field]) {
          try {
            configWithDecryptedKeys[field] = decrypt(configWithDecryptedKeys[field]);
          } catch (err) {
            // Keep as is if decryption fails
          }
        }
      }

      // Just write the configs (it's a soft update if container details didn't change)
      await writePhysicalConfigs(id, configWithDecryptedKeys);

      await deploymentEventsRepo.create({
        instance_id: id,
        owner_id: req.user.id,
        step: "template_files_written",
        status: "success",
        message: "模板衍生运行时配置文件(mybay.template.yaml、SOUL.md)在重新应用时成功覆写"
      }).catch(() => {});

      await deploymentEventsRepo.create({
        instance_id: id,
        owner_id: req.user.id,
        step: "template_injected",
        status: "success",
        message: "模板重新应用注入成功(Soft-applied)"
      }).catch(() => {});

      res.json({
        success: true,
        update_type: "soft",
        message: "模板配置重新应用成功。已经软更新相关运行文件(mybay.template.yaml, SOUL.md)，不影响容器运行。"
      });
    } catch (e: any) {
      console.error("[Reapply Template Error]", e);
      res.status(500).json({ error: "Reapply failed: " + (e.message || String(e)) });
    }
  });

  router.post("/:id/template/upgrade", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ error: `未找到指定的实例：${id}` });
      }
      
      // Ownership check (only owner or admin can update)
      if (instance.user_id !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "您没有配置该实例的权限" });
      }

      const config = instance.config_json ? JSON.parse(instance.config_json) : {};
      if (!config.template_id) {
        return res.status(400).json({ error: "该实例没有绑定任何模板，无法执行模板升级" });
      }

      const { templatesRepo } = await import("../../repositories/templatesRepo");
      const template = await templatesRepo.findById(config.template_id);
      if (!template) {
        return res.status(404).json({ error: `未能在模板库中找到关联的模板: ${config.template_id}` });
      }

      const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");
      const { decrypt } = require("../../crypto");

      await deploymentEventsRepo.create({
        instance_id: id,
        owner_id: req.user.id,
        step: "template_load",
        status: "success",
        message: `开始升级工作流模板到最新版本，目标模板：${template.name}`
      }).catch(() => {});

      // Compare template snapshot version
      const targetVersion = template.updated_at || "1.0.0";

      // Calculate if system changes (provider, model, channel, skills, ports) changed compared to template's latest definitions
      const providerChanged = (template.default_provider && template.default_provider !== config.provider);
      const modelChanged = (template.default_model && template.default_model !== config.model);
      const channelChanged = (template.default_channel && template.default_channel !== config.channel);
      
      const currentSkills = config.skills || [];
      const templateSkills = template.default_skills || [];
      const skillsChanged = JSON.stringify(currentSkills.sort()) !== JSON.stringify(templateSkills.sort());

      // Let's decide if this upgrade requires Re-deploy or raw Soft Update
      const needsRedeploy = providerChanged || modelChanged || channelChanged || skillsChanged;

      // Update snapshot properties in config
      config.template_version = targetVersion;
      config.template_snapshot = {
        name: template.name,
        description: template.description || "",
        default_prompt: template.default_prompt,
        default_skills: template.default_skills,
        required_inputs: template.required_inputs,
        supported_triggers: template.supported_triggers,
        default_trigger: template.default_trigger,
        default_output: template.default_output,
        required_permissions: template.required_permissions,
        risk_level: template.risk_level
      };

      // Set user config values from current latest template default values if not manually overridden
      if (template.default_provider) {
        config.provider = template.default_provider;
      }
      if (template.default_model) {
        config.model = template.default_model;
      }
      if (template.default_channel) {
        config.channel = template.default_channel;
      }
      if (template.default_prompt) {
        // We write latest prompt template (compiled via existing inputs in writePhysicalConfigs)
        config.prompt = template.default_prompt;
      }
      // Skill Policy Validation for Template Upgrade path
      const { skillPolicyRegistry } = require("../../../shared/skillPolicyRegistry");
      const targetUpgradeSkills = template.default_skills || [];
      for (const skillId of targetUpgradeSkills) {
        const policy = skillPolicyRegistry[skillId];
        if (!policy) {
           return res.status(400).json({ error: `目标升级模板中包含了未知的技能插件: ${skillId}` });
        }
        if (policy.adminOnly && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
          await dbAdapter.insertAuditLog({
            instance_id: id,
            action: "security_violation",
            user_id: req.user.id,
            timestamp: new Date().toISOString(),
            details: `用户试图通过升级工作流模板越权开启管理员专用高危技能: ${skillId} (Upgrade)`
          });
          return res.status(403).json({ error: `工作流新版本模板包含了管理员专用特权技能 [${policy.name}]，请联系系统管理员代为升级。` });
        }
      }

      config.skills = targetUpgradeSkills;

      // Save the updated configuration to database
      await dbAdapter.updateInstanceConfig(id, JSON.stringify(config));

      await deploymentEventsRepo.create({
        instance_id: id,
        owner_id: req.user.id,
        step: "template_snapshot_saved",
        status: "success",
        message: `工作流新版本快照升级成功，已持久化到数据库。触发升级类型: ${needsRedeploy ? '重部署(Re-deploy)' : '软更新(Soft Update)'}`
      }).catch(() => {});

      // Decrypt credentials to rewrite files
      const configWithDecryptedKeys = { ...config };
      const encryptedFields = [
        "apiKey", "providerApiKey", "password", "telegramBotToken", 
        "discordBotToken", "feishuAppSecret", "qqBotSecret", 
        "whatsappAccessToken", "slackBotToken", "slackSigningSecret", 
        "slackAppToken", "dingtalkAppSecret", "dingtalkRobotSecret", 
        "wechatAppSecret", "webhookSecret", "skillTavilyApiKey", 
        "skillSerperApiKey", "skillGithubToken", 
      ];
      for (const field of encryptedFields) {
        if (configWithDecryptedKeys[field]) {
          try {
            configWithDecryptedKeys[field] = decrypt(configWithDecryptedKeys[field]);
          } catch (err) {
            // Do fallback
          }
        }
      }

      if (needsRedeploy) {
        // Redeployment (writes files and rebuilds sandbox env in executeDeployment)
        const io = req.app.get("io");
        const wrappedUpdateStatus = async (status: string, error?: string) => {
          await dbAdapter.updateInstanceStatus(id, status);
          if (error) {
            await dbAdapter.updateInstanceVersionInfo(id, { deployment_error: error || null });
          }
          io.emit("instances_updated", { id, status });
        };

        // Trigger executeDeployment logic
        const instanceFull = { ...instance, config_json: JSON.stringify(config) };
        executeDeployment(instanceFull, io, wrappedUpdateStatus, configWithDecryptedKeys, req.user);

        await deploymentEventsRepo.create({
          instance_id: id,
          owner_id: req.user.id,
          step: "template_injected",
          status: "success",
          message: `由于模型商/模型/渠道/技能变更，已自动拉起并重启容器环境部署流程(Re-deploy)`
        }).catch(() => {});

        res.json({
          success: true,
          update_type: "redeploy",
          message: "模板升级成功。由于底座、模型、或绑定技能发生改变，已成功拉起后台重部署容器机制(Re-deploy)。"
        });
      } else {
        // Soft Update (just rebuild mybay.template.yaml, SOUL.md, mybay.instance.yaml)
        const { writePhysicalConfigs } = await import("../../configWriter");
        await writePhysicalConfigs(id, configWithDecryptedKeys);

        await deploymentEventsRepo.create({
          instance_id: id,
          owner_id: req.user.id,
          step: "template_files_written",
          status: "success",
          message: "模板升级提示词或描述更改：成功软更新下发 SOUL.md 到运行目录"
        }).catch(() => {});

        await deploymentEventsRepo.create({
          instance_id: id,
          owner_id: req.user.id,
          step: "template_injected",
          status: "success",
          message: "工作流模板升级无环境状态变更，软更新成功"
        }).catch(() => {});

        res.json({
          success: true,
          update_type: "soft",
          message: "模板升级成功。该版本没有触发底座及容器配置变更，程序已采用软更新方式直接投递。 (Soft Update)"
        });
      }

    } catch (e: any) {
      console.error("[Upgrade Template Error]", e);
      res.status(500).json({ error: "Upgrade failed: " + (e.message || String(e)) });
    }
  });

  return router;
}

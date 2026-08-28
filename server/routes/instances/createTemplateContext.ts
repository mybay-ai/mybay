import type { Response } from "express";

import { redactSecretsDeep } from "../../utils/sanitizer";

export async function resolveCreateTemplateContext(options: {
  data: any;
  generatedId: string;
  userId: string;
  res: Response;
}) {
  const { data, generatedId, userId, res } = options;
  let template: any = null;
  let blueprint: any = null;
  const referencedTemplates: any[] = [];

      if (data.blueprint_id) {
        const { blueprintsRepo } = await import("../../repositories/blueprintsRepo");
        blueprint = await blueprintsRepo.findById(data.blueprint_id);
        if (!blueprint) {
          res.status(404).json({ error: `未找到指定的行业场景 Blueprint: ${data.blueprint_id}` });
          return null;
        }
        if (blueprint.is_active === false) {
          res.status(400).json({ error: `该 Blueprint 已被禁用: ${blueprint.name}` });
          return null;
        }

        const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");
        await deploymentEventsRepo.create({
          instance_id: generatedId,
          owner_id: userId,
          step: "blueprint_load",
          status: "success",
          message: `已读取指定的行业场景 Blueprint: ${blueprint.name}`,
          metadata: { blueprint_id: blueprint.id, blueprint_slug: blueprint.slug || blueprint.id }
        });

        data.blueprint_id = blueprint.id;
        data.blueprint_slug = blueprint.slug || blueprint.id;
        data.blueprint_version = blueprint.version || "1.0.0";
        data.blueprint_snapshot = {
          id: blueprint.id,
          slug: blueprint.slug,
          name: blueprint.name,
          description: blueprint.description,
          category: blueprint.category,
          version: blueprint.version,
          recommended_skills: blueprint.recommended_skills,
          recommended_channels: blueprint.recommended_channels,
          referenced_workflow_template_ids: blueprint.referenced_workflow_template_ids,
          system_context_preview: blueprint.system_context_preview
        };

        if (blueprint.referenced_workflow_template_ids && Array.isArray(blueprint.referenced_workflow_template_ids)) {
          const { templatesRepo } = await import("../../repositories/templatesRepo");
          for (const refId of blueprint.referenced_workflow_template_ids) {
            const refTemplate = await templatesRepo.findById(refId);
            if (refTemplate) {
              referencedTemplates.push(refTemplate);
            }
          }
        }
      }

      if (data.template_id) {
        const { templatesRepo } = await import("../../repositories/templatesRepo");
        template = await templatesRepo.findById(data.template_id);
        if (!template) {
          res.status(404).json({ error: `未找到指定的工作流模板: ${data.template_id}` });
          return null;
        }
        if (template.is_active === false) {
          res.status(400).json({ error: `模板已被禁用: ${template.name}` });
          return null;
        }

        const { deploymentEventsRepo } = await import("../../repositories/deploymentEventsRepo");

        await deploymentEventsRepo.create({
          instance_id: generatedId,
          owner_id: userId,
          step: "template_load",
          status: "success",
          message: `已读取指定的模板: ${template.name}`,
          metadata: { template_id: template.id, template_slug: template.slug || template.id }
        });

        // 合并默认值并归一化输入
        const userInputs = { ...data.template_inputs };

        for (const input of (template.required_inputs || [])) {
          // 合并默认值
          const fallbackDefault = input.defaultValue !== undefined ? input.defaultValue : input.default;
          if ((userInputs[input.key] === undefined || userInputs[input.key] === null || userInputs[input.key] === "") && fallbackDefault !== undefined) {
             userInputs[input.key] = fallbackDefault;
          }

          // 归一化 url_list 或 list (按行分割并清除空行)
          if (input.type === "url_list" || input.type === "list") {
             if (userInputs[input.key] === "" || userInputs[input.key] === null || userInputs[input.key] === undefined) {
                userInputs[input.key] = [];
             } else if (typeof userInputs[input.key] === "string") {
                userInputs[input.key] = userInputs[input.key].split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
             }
          }

          // 归一化 boolean
          if (input.type === "boolean") {
            userInputs[input.key] = !!userInputs[input.key];
          }

          // 归一化 number
          if (input.type === "number" && typeof userInputs[input.key] !== "number") {
             const parsed = parseFloat(userInputs[input.key]);
             if (!isNaN(parsed)) userInputs[input.key] = parsed;
          }
        }

        // 写回以备后续使用
        data.template_inputs = userInputs;

        const missingInputs: string[] = [];
        for (const input of (template.required_inputs || [])) {
          // 空数组也是正常录入的值（如果 allowed），但如果 required，则不能缺少字段。
          // 这里的检查不再拦截空数组，除非它是 undefined/null 或者空字符串
          const isMissing = userInputs[input.key] === undefined || userInputs[input.key] === null || userInputs[input.key] === "";
          // 如果 required 且 missing
          if (input.required && isMissing) {
            missingInputs.push(input.label || input.key);
          }
        }
        if (missingInputs.length > 0) {
          console.log("[Instance Create Route] Template input validation failed:", {
            template_id: template.id,
            required_keys: (template.required_inputs || []).filter((i: any) => i.required).map((i: any) => i.key),
            received_keys: Object.keys(userInputs),
            template_inputs: redactSecretsDeep(userInputs),
            missing_keys: missingInputs
          });

          await deploymentEventsRepo.create({
            instance_id: generatedId,
            owner_id: userId,
            step: "template_validate",
            status: "failed",
            message: `模板校验失败：缺少必选输入参数: ${missingInputs.join("、")}`,
            metadata: { missing_inputs: missingInputs }
          }).catch(() => {});

          res.status(400).json({ error: `配置模板失败：缺少必填输入参数：${missingInputs.join("、")}。\n请返回“模板配置”步骤，确认上述内容已填写后重试。` });
          return null;
        }

        await deploymentEventsRepo.create({
          instance_id: generatedId,
          owner_id: userId,
          step: "template_validate",
          status: "success",
          message: `工作流运行所需输入参数校验通过`,
          metadata: { user_inputs: redactSecretsDeep(userInputs) }
        });

        // 合并：默认配置、技能、用户覆盖、输入快照等
        data.skills = template.default_skills || [];
        data.template_slug = template.slug || template.id;
        data.template_version = template.updated_at || "1.0.0";
        data.template_inputs = userInputs;

        // Auto-assign properties with standard priority:
        // 1. User config values data.provider / data.model
        // 2. Template's default_provider / default_model
        // 3. System defaults
        const SYSTEM_DEFAULT_PROVIDER = "google";
        const SYSTEM_DEFAULT_MODEL = "gemini-2.5-flash";

        const finalProvider = data.provider || template.default_provider || SYSTEM_DEFAULT_PROVIDER;
        const finalModel = data.model || template.default_model || SYSTEM_DEFAULT_MODEL;

        data.provider = finalProvider;
        data.model = finalModel;

        data.template_recommended_model = {
          provider: template.default_provider,
          model: template.default_model
        };
        data.selected_model = {
          provider: finalProvider,
          model: finalModel
        };

        if (!data.channel && template.default_channel) {
          data.channel = template.default_channel;
        }
        if (data.channel === "none" || !data.channel) {
          data.channel = "web";
        }
        if (!data.prompt && template.default_prompt) {
          data.prompt = template.default_prompt;
        }
        if (!data.name && template.name) {
          data.name = `${template.name}-${Math.random().toString(36).substring(7).toUpperCase()}`;
        }

        // Merge template's default_config
        const mergedConfig = { ...template.default_config, ...(data.default_config || {}) };
        data.default_config = mergedConfig;

        // Save snapshot of template properties
        data.template_snapshot = {
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
      }

      if (!data.name && blueprint) {
        data.name = `${blueprint.name}-${Math.random().toString(36).substring(7).toUpperCase()}`;
      }


  return { template, blueprint, referencedTemplates };
}

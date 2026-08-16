import { tasksRepo } from "../repositories/tasksRepo";
import { instancesRepo } from "../repositories/instancesRepo";
import { scheduledFiresRepo } from "../repositories/scheduledFiresRepo";
import { runXiaohongshuTopicGenerator } from "./xiaohongshuTopicRunner";
import {
  runDailyNewsBriefing,
  runCompetitorPriceMonitor,
  runPdfSummary,
  runLeadFormAutoReply,
  runEcommerceOrderAlert,
  runFeishuMessageSummary,
  runShortVideoScriptAnalyzer
} from "./workflowRunners";
import { LLMConfig } from "../utils/llmClient";
import { evaluateInstanceWorkflowReadiness } from "../services/workflowReadinessService";

type RunnerFn = (
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
) => Promise<{ resultText: string; filePath: string; relativePath: string }>;

interface RegistryEntry {
  runner: RunnerFn;
  successSummary: string;
}

const TEMPLATE_RUNNERS: Record<string, RegistryEntry> = {
  "xiaohongshu-topic-generator": {
    runner: runXiaohongshuTopicGenerator,
    successSummary: "小红书选题策划及爆款笔记方案已生成成功！"
  },
  "xiaohongshutopicgenerator": {
    runner: runXiaohongshuTopicGenerator,
    successSummary: "小红书选题策划及爆款笔记方案已生成成功！"
  },
  "daily-news-briefing": {
    runner: runDailyNewsBriefing,
    successSummary: "智能行业简报已生成"
  },
  "dailynewsbriefing": {
    runner: runDailyNewsBriefing,
    successSummary: "智能行业简报已生成"
  },
  "competitor-price-monitor": {
    runner: runCompetitorPriceMonitor,
    successSummary: "沙箱模拟价格分析报告已生成"
  },
  "competitorpricemonitor": {
    runner: runCompetitorPriceMonitor,
    successSummary: "沙箱模拟价格分析报告已生成"
  },
  "pdf-summary": {
    runner: runPdfSummary,
    successSummary: "文档深度解析、高管速读与核心发现已提取成功！"
  },
  "pdfsummary": {
    runner: runPdfSummary,
    successSummary: "文档深度解析、高管速读与核心发现已提取成功！"
  },
  "lead-form-auto-reply": {
    runner: runLeadFormAutoReply,
    successSummary: "意向客户首封专业回复信及多渠道触达方案已自动生成！"
  },
  "leadformautoreply": {
    runner: runLeadFormAutoReply,
    successSummary: "意向客户首封专业回复信及多渠道触达方案已自动生成！"
  },
  "ecommerce-order-alert": {
    runner: runEcommerceOrderAlert,
    successSummary: "电商大额交易异动订单诊断与部门协同备忘已分析完毕！"
  },
  "ecommerceorderalert": {
    runner: runEcommerceOrderAlert,
    successSummary: "电商大额交易异动订单诊断与部门协同备忘已分析完毕！"
  },
  "feishu-message-summary": {
    runner: runFeishuMessageSummary,
    successSummary: "飞书消息总结报告已生成，真实群消息读取需完成渠道授权"
  },
  "feishumessagesummary": {
    runner: runFeishuMessageSummary,
    successSummary: "飞书消息总结报告已生成，真实群消息读取需完成渠道授权"
  },
  "short-video-script-analyzer": {
    runner: runShortVideoScriptAnalyzer,
    successSummary: "短视频分镜脚本黄金 3 秒及完播改动红蓝对比已生成！"
  },
  "shortvideoscriptanalyzer": {
    runner: runShortVideoScriptAnalyzer,
    successSummary: "短视频分镜脚本黄金 3 秒及完播改动红蓝对比已生成！"
  }
};

/**
 * Orchestrates task execution. Fetches task, loads state, triggers the runner,
 * and updates database status correctly.
 */
export async function executeTaskInBackground(taskId: string): Promise<void> {
  try {
    // 1. Fetch task
    const task = await tasksRepo.findById(taskId);
    if (!task) {
      console.error(`[taskRunner] Task not found for ID: ${taskId}`);
      return;
    }
    const currentStatus = String(task.status || "queued").toLowerCase();
    if (["success", "completed"].includes(currentStatus)) {
      if (task.scheduled_fire_id) await scheduledFiresRepo.markCompleted(task.scheduled_fire_id);
      return;
    }
    if (["failed", "failed-terminal", "cancelled", "canceled"].includes(currentStatus)) {
      if (task.scheduled_fire_id) {
        await scheduledFiresRepo.markFailed(task.scheduled_fire_id, task.error || `Linked task is terminal: ${currentStatus}`);
      }
      return;
    }

    // Processing tasks may only be resumed after the stale timeout below.


    // Do not re-process active or finished tasks (idempotency safety)
    if (task.status === "processing") {
      // Allow re-processing if stale: started_at is missing OR updated_at is more than 10 minutes ago
      const startedAtVal = task.started_at;
      const updatedAtVal = task.updated_at;
      const nowMs = Date.now();
      const updatedDiff = updatedAtVal ? (nowMs - new Date(updatedAtVal).getTime()) : 0;
      const isStale = !startedAtVal || (updatedDiff > 10 * 60 * 1000);

      if (!isStale) {
        console.warn(`[taskRunner] Task ${taskId} is already processing and active. Aborting execution.`);
        return;
      }
      console.warn(`[taskRunner] Task ${taskId} is marked as processing but is stale or started_at is null. Resuming/Recalling execution.`);
    }
    if (task.status === "config_required") {
      console.warn(`[taskRunner] Task ${taskId} is waiting for business configuration. Skipping execution.`);
      if (task.scheduled_fire_id) {
        await scheduledFiresRepo.markFailed(task.scheduled_fire_id, task.error || "Workflow configuration is required.");
      }
      return;
    }

    // 2. Fetch linked instance
    const instanceId = task.instance_id;
    const instance = await instancesRepo.findByIdForOwner(instanceId, undefined, 'admin');
    if (!instance) {
      const errMsg = "关联部署实例已被删除或由于权限问题无法访问，因此无法执行。";
      await tasksRepo.update(taskId, {
        status: "failed",
        error: errMsg,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if (task.scheduled_fire_id) {
        await scheduledFiresRepo.markFailed(task.scheduled_fire_id, errMsg);
      }
      return;
    }

    // 3. Set state to processing
    await tasksRepo.update(taskId, {
      status: "processing",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 4. Resolve Template Registry Entry
    const templateRef = String(task.template_id || instance.template_slug || instance.template_id || "").toLowerCase();
    const entry = TEMPLATE_RUNNERS[templateRef];

    if (!entry) {
      const errMsg = `该模板暂未接入真实执行器 (未找到对应的执行器: ${templateRef})。`;
      await tasksRepo.update(taskId, {
        status: "failed",
        error: errMsg,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if (task.scheduled_fire_id) {
        await scheduledFiresRepo.markFailed(task.scheduled_fire_id, errMsg);
      }
      return;
    }

    const config_json = typeof instance.config_json === 'string'
      ? JSON.parse(instance.config_json || "{}")
      : (instance.config_json || {});

    // 4.5 Unified readiness validation for every built-in workflow.
    const { readiness, context: readinessContext } = await evaluateInstanceWorkflowReadiness({
      instanceId, instanceOverride: instance, templateId: templateRef, executionPayload: task.input_payload
    });
    if (!readiness.ready) {
      await tasksRepo.update(taskId, {
        status: "config_required", error: readiness.message, updated_at: new Date().toISOString()
      });
        if (task.scheduled_fire_id) {
          await scheduledFiresRepo.markFailed(task.scheduled_fire_id, readiness.message);
        }
      return;
    }
    // 5. Extract and merge inputs
    // Priorities: Task payload > Instance configurations > System defaults

      
    const instanceInputs = config_json.template_inputs || {};
    const businessConfig = config_json.businessConfig || {};
    const taskPayload = task.input_payload || {};
    const taskInputs = taskPayload.template_inputs || {};
    const webhookPayload = taskPayload.webhook_payload || taskInputs.webhook_payload || {};
    const webhookRaw = taskPayload.webhook_raw || taskInputs.webhook_raw || {};

    const normalizedReadinessInputs = readinessContext.template_inputs && typeof readinessContext.template_inputs === "object" && !Array.isArray(readinessContext.template_inputs)
      ? readinessContext.template_inputs as Record<string, unknown>
      : {};

    const mergedInputs = {
      ...businessConfig,
      ...instanceInputs,
      ...taskInputs,
      webhook_payload: { ...webhookPayload, ...webhookRaw },
      webhook_raw: { ...webhookRaw, ...webhookPayload },
      ...webhookRaw,
      ...normalizedReadinessInputs,
      ...webhookPayload
    };

    // Auto-map shopUrl and monitorSkus for ecommerce tasks
    if (businessConfig.shopUrl) {
      if (!mergedInputs.product_urls) {
        mergedInputs.product_urls = businessConfig.shopUrl;
      }
      if (!mergedInputs.competitor_urls) {
        mergedInputs.competitor_urls = businessConfig.shopUrl;
      }
    }
    if (businessConfig.monitorSkus) {
      if (!mergedInputs.skus) {
        mergedInputs.skus = businessConfig.monitorSkus;
      }
      if (!mergedInputs.focus_items) {
        mergedInputs.focus_items = businessConfig.monitorSkus;
      }
    }

    // 6. Build model credentials & configs
    const llmConfig: LLMConfig = {
      provider: config_json.provider || instance.model_provider || "gemini",
      model: config_json.model || instance.model_name || "gemini-3.5-flash",
      baseUrl: config_json.baseUrl || instance.model_base_url || "",
      providerApiKey: config_json.providerApiKey || config_json.apiKey || ""
    };

    console.log(`[taskRunner] Task ${taskId} starts executing for instance ${instanceId}. Template: ${templateRef}, Model provider: ${llmConfig.provider}`);

    // 7. Run Template
    const { relativePath, resultText } = await entry.runner(
      instanceId,
      taskId,
      mergedInputs,
      llmConfig,
      instance.data_volume_path
    );

    // 8. Update success state
    await tasksRepo.update(taskId, {
      status: "success",
      result: {
        summary: entry.successSummary,
        output_file: relativePath,
        markdown: resultText,
        content_preview: resultText.substring(0, 1000) + (resultText.length > 1000 ? "\n...(内容已折叠，请查看或预览完整文档)" : ""),
        timestamp: new Date().toISOString()
      },
      error: null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    console.log(`[taskRunner] Task ${taskId} successfully executed and written to output.`);

    if (task.scheduled_fire_id) {
      await scheduledFiresRepo.markCompleted(task.scheduled_fire_id);
    }
  } catch (err: any) {
    console.error(`[taskRunner] Error encountered during execution of task ${taskId}:`, err);
    try {
      await tasksRepo.update(taskId, {
        status: "failed",
        error: err.message || "未知执行错误。请刷新重试或向管理员反馈。",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      const failedTask = await tasksRepo.findById(taskId);
      if (failedTask?.scheduled_fire_id) {
        await scheduledFiresRepo.markFailed(failedTask.scheduled_fire_id, err.message || "Task execution failed.");
      }
    } catch (dbErr: any) {
      console.error(`[taskRunner] Failed to persist negative state for task ${taskId}:`, dbErr.message);
    }
  }
}

export default executeTaskInBackground;

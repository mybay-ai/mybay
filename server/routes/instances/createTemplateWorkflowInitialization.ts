import { buildWorkflowReadinessPayload, evaluateWorkflowReadiness, initialTaskStatus, selectInitialExecutionTasks } from "../../templates/productionPolicy";
import { buildWorkflowReadinessContext } from "../../services/workflowReadinessService";
import { redactSecretsDeep } from "../../utils/sanitizer";

export async function initializeTemplateWorkflow(options: {
  template: any;
  data: any;
  generatedId: string;
  ownerId: string;
  deploymentEventsRepo: any;
}) {
  const { template, data, generatedId, ownerId, deploymentEventsRepo } = options;
  await deploymentEventsRepo.create({
    instance_id: generatedId,
    owner_id: ownerId,
    step: "template_snapshot_saved",
    status: "success",
    message: "静态版本快照成功存盘持久化",
    metadata: { template_id: template.id, template_slug: template.slug || template.id },
  });

  let triggersOrTasksCreated = false;
  const triggersMetadata: Record<string, unknown> = {};
  const tasksMetadata: Record<string, unknown> = {};
  const templateConfigForReadiness = {
    businessConfig: data.businessConfig || {},
    template_inputs: data.template_inputs || {},
  };
  const templateReadiness = evaluateWorkflowReadiness(template, buildWorkflowReadinessContext(templateConfigForReadiness));
  const templateReadinessPayload = buildWorkflowReadinessPayload(templateReadiness);

  if (template.default_trigger?.type === "schedule") {
    try {
      const { scheduledJobsRepo } = await import("../../repositories/scheduledJobsRepo");
      let cronExpression = template.default_trigger.cron || "0 9 * * *";
      if (data.template_inputs?.run_time) {
        const parts = data.template_inputs.run_time.split(":");
        if (parts.length === 2) {
          cronExpression = `${parseInt(parts[1], 10)} ${parseInt(parts[0], 10)} * * *`;
        }
      }
      const newJob = await scheduledJobsRepo.create({
        owner_id: ownerId,
        instance_id: generatedId,
        template_id: template.id,
        title: `${template.name} 定时任务`,
        cron_expression: cronExpression,
        is_active: templateReadiness.ready,
        next_run_at: templateReadiness.ready ? new Date(Date.now() + 90 * 1000).toISOString() : null,
        input_payload: redactSecretsDeep({
          template_id: template.id,
          template_slug: template.slug || template.id,
          template_inputs: data.template_inputs || {},
          workflow_readiness: templateReadinessPayload,
          template_snapshot: data.template_snapshot || {},
          trigger: template.default_trigger,
        }),
      });
      triggersOrTasksCreated = true;
      triggersMetadata.job_id = newJob.id;
      triggersMetadata.cron_expression = cronExpression;
    } catch (error: any) {
      console.error("[Instance Create Route] Failed to create scheduled job:", error);
      throw new Error("初始化模板调度任务失败: " + error.message);
    }
  }

  if (Array.isArray(template.initial_tasks)) {
    try {
      const { tasksRepo } = await import("../../repositories/tasksRepo");
      const initialTasks = selectInitialExecutionTasks(template.initial_tasks);
      for (const task of initialTasks) {
        await tasksRepo.create({
          owner_id: ownerId,
          instance_id: generatedId,
          template_id: template.id,
          title: `${template.name} - 初始化阶段: ${task.title}`,
          trigger_type: "template_initial",
          status: initialTaskStatus(templateReadiness, task.status || "queued"),
          input_payload: redactSecretsDeep({
            template_id: template.id,
            template_slug: template.slug || template.id,
            template_inputs: data.template_inputs || {},
            workflow_readiness: templateReadinessPayload,
            template_snapshot: data.template_snapshot || {},
            initial_task: task,
          }),
        });
      }
      triggersOrTasksCreated = true;
      tasksMetadata.created_count = initialTasks.length;
    } catch (error: any) {
      console.error("[Instance Create Route] Failed to create initial tasks:", error);
      throw new Error("初始化模板前置任务失败: " + error.message);
    }
    await deploymentEventsRepo.create({
      instance_id: generatedId,
      owner_id: ownerId,
      step: "template_initial_tasks_created",
      status: "success",
      message: "初始化前置任务已创建，待用户手动触发",
      metadata: tasksMetadata,
    });
  }

  if (triggersOrTasksCreated && Object.keys(triggersMetadata).length > 0) {
    await deploymentEventsRepo.create({
      instance_id: generatedId,
      owner_id: ownerId,
      step: "template_triggers_created",
      status: "success",
      message: "相关的定时任务调度器注册就绪",
      metadata: triggersMetadata,
    });
  }
}

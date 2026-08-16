import { scheduledJobsRepo } from "./repositories/scheduledJobsRepo";
import { tasksRepo } from "./repositories/tasksRepo";
import { scheduledFiresRepo } from "./repositories/scheduledFiresRepo";
import { deploymentEventsRepo } from "./repositories/deploymentEventsRepo";
import { instancesRepo } from "./repositories/instancesRepo";
import { isTemplateSchedulerEnabled } from "./utils/templateWorkflowsFeature";
import { CronExpressionParser } from "cron-parser";

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunnerActive = false;

export function startSchedulerRunner() {
  if (schedulerInterval) return;
  if (process.env.NODE_ENV === "test" || !isTemplateSchedulerEnabled()) {
    console.log("[SchedulerRunner] Scheduler runner disabled for this process.");
    return;
  }
  const pollIntervalMs = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || "60000", 10);
  console.log(`[SchedulerRunner] Starting scheduled jobs runner, polling every ${pollIntervalMs}ms...`);
  void runSchedulerTick();
  schedulerInterval = setInterval(() => { void runSchedulerTick(); }, pollIntervalMs);
  schedulerInterval.unref?.();
}

export function stopSchedulerRunner() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    isRunnerActive = false;
    console.log("[SchedulerRunner] Stopped.");
  }
}

export async function runSchedulerTick(options: { executeTasks?: boolean } = {}) {
  if (isRunnerActive) return;
  isRunnerActive = true;
  try {
    await processDueJobs(options);
  } catch (error: any) {
    console.error("[SchedulerRunner] Global error during tick:", error.message);
  } finally {
    isRunnerActive = false;
  }
}

async function recoverScheduledFires(options: { executeTasks?: boolean }) {
  const fires = await scheduledFiresRepo.listRecoverable(20);
  for (const fire of fires) {
    let task = await scheduledFiresRepo.findTask(fire.id);
    if (!task) {
      const snapshot = fire.task_snapshot || {};
      task = await tasksRepo.create({
        ...(snapshot.task || {}),
        scheduled_fire_id: fire.id,
        idempotency_key: fire.idempotency_key,
        input_payload: { ...((snapshot.task || {}).input_payload || {}), scheduled_fire_id: fire.id }
      });
    }
    const status = String(task.status || "queued").toLowerCase();
    if (["success", "completed"].includes(status)) {
      await scheduledFiresRepo.markCompleted(fire.id);
      continue;
    }
    if (["failed", "failed-terminal", "cancelled", "canceled", "config_required"].includes(status)) {
      await scheduledFiresRepo.markFailed(fire.id, `Linked task is terminal: ${status}`);
      continue;
    }
    await scheduledFiresRepo.markDispatched(fire.id, task.id);
    if (options.executeTasks !== false) {
      const { executeTaskInBackground } = await import("./workers/taskRunner");
      executeTaskInBackground(task.id).catch((error) => console.error("[SchedulerRunner] Recovered task failed:", error));
    }
  }
}

async function processDueJobs(options: { executeTasks?: boolean }) {
  await recoverScheduledFires(options);

  const now = new Date().toISOString();
  
  const dueJobs = await scheduledJobsRepo.listDue(now, 20);

  if (!dueJobs || dueJobs.length === 0) {
    return;
  }

  console.log(`[SchedulerRunner] Tick: found ${dueJobs.length} potential due jobs.`);

  for (const job of dueJobs) {
    try {
      if (!job.cron_expression) {
         throw new Error("Missing cron_expression on job.");
      }

      const instance = await instancesRepo.findByIdForOwner(job.instance_id, undefined, "admin");
      const templateKey = String(job.template_id || job.input_payload?.template_id || job.input_payload?.template_slug || "").toLowerCase();
      const unified = await (await import("./services/workflowReadinessService")).evaluateInstanceWorkflowReadiness({
        instanceId: job.instance_id,
        instanceOverride: instance,
        templateId: templateKey,
        executionPayload: job.input_payload
      });
      if (!unified.readiness.ready) {
        await scheduledJobsRepo.update(job.id, { is_active: false, updated_at: now });
        await deploymentEventsRepo.create({
          instance_id: job.instance_id,
          owner_id: job.owner_id,
          step: "scheduled_job_config_required",
          status: "blocked",
          message: unified.readiness.message,
          metadata: {
            job_id: job.id,
            template_id: templateKey,
            readiness: unified.readiness.state,
            missing_fields: unified.readiness.missingRequirements.map((item) => item.key || item.provider || item.type)
          }
        });
        continue;
      }

      const fireAt = String(job.next_run_at || now);
      const taskSnapshot = {
        owner_id: job.owner_id,
        instance_id: job.instance_id,
        template_id: job.template_id || job.input_payload?.template_id,
        title: job.title || "Scheduled Task",
        trigger_type: "schedule",
        status: "queued",
        prompt: job.prompt || null,
        input_payload: {
          scheduled_job_id: job.id,
          template_id: job.template_id || job.input_payload?.template_id,
          template_slug: job.input_payload?.template_slug,
          template_inputs: job.input_payload?.template_inputs || {},
          template_snapshot: job.input_payload?.template_snapshot || {},
          trigger: job.input_payload?.trigger || { type: "schedule", cron: job.cron_expression },
          cron_expression: job.cron_expression,
          dispatched_at: now
        }
      };
      const fireClaim = await scheduledFiresRepo.claim(job.id, fireAt, { instance_id: job.instance_id, owner_id: job.owner_id, template_id: taskSnapshot.template_id, task: taskSnapshot });

      
      // 2. Parse cron interval and calculate next run 
      const cronInterval = CronExpressionParser.parse(job.cron_expression);
      const nextRunAtObj = cronInterval.next();
      const newNextRunAt = nextRunAtObj.toDate().toISOString();

      await scheduledJobsRepo.update(job.id, {
        last_run_at: now,
        next_run_at: newNextRunAt,


        updated_at: now
      });

      if (!fireClaim.claimed) {
        console.log(`[SchedulerRunner] Fire already claimed for job ${job.id} at ${fireAt}; skipping duplicate dispatch.`);
        continue;
      }
      const fire = fireClaim.fire;


      // 4. We got the lock! Insert into Tasks
      const payloadContent = {
        scheduled_job_id: job.id,
        template_id: job.template_id || job.input_payload?.template_id,
        template_slug: job.input_payload?.template_slug,
        template_inputs: job.input_payload?.template_inputs || {},
        template_snapshot: job.input_payload?.template_snapshot || {},
        trigger: job.input_payload?.trigger || { type: "schedule", cron: job.cron_expression },
        cron_expression: job.cron_expression,
        dispatched_at: now
      };

      const newTask = await tasksRepo.create({
        owner_id: job.owner_id,
        instance_id: job.instance_id,
        template_id: job.template_id || job.input_payload?.template_id,
        title: job.title || "Scheduled Task",
        trigger_type: "schedule",
        status: "queued",
        prompt: job.prompt || null,
        scheduled_fire_id: fire.id,
        idempotency_key: fire.idempotency_key,
        input_payload: { ...payloadContent, scheduled_fire_id: fire.id }
      });
      await scheduledFiresRepo.markDispatched(fire.id, newTask.id);

      console.log(`[SchedulerRunner] Successfully dispatched task ${newTask.id} from job ${job.id}`);

      // Persist-only mode keeps integration tests isolated from real Agent execution.
      if (options.executeTasks !== false) {
        try {
          const { executeTaskInBackground } = await import("./workers/taskRunner");
          executeTaskInBackground(newTask.id).catch(err => {
            console.error(`[SchedulerRunner] Asynchronous task execution background error for task ${newTask.id}:`, err);
          });
        } catch (err: any) {
          console.error(`[SchedulerRunner] Failed to import/execute taskRunner for task ${newTask.id}:`, err.message);
        }
      }

      // 5. Create deployment event for auditing
      await deploymentEventsRepo.create({
        instance_id: job.instance_id,
        owner_id: job.owner_id,
        step: "scheduled_job_dispatched",
        status: "success",
        message: `定时触发器 "${job.title}" 到期调度成功，已下发执行序列至后端引擎。`,
        metadata: {
          job_id: job.id,
          task_id: newTask.id,
          instance_id: job.instance_id,
          cron_expression: job.cron_expression,
          next_run_at: newNextRunAt
        }
      });
      
    } catch (err: any) {
      console.error(`[SchedulerRunner] Failed to dispatch job ${job.id}:`, err.message, err.stack);
      
      // If cron parsing failed or other error, record failure
      if (job.instance_id) {
         try {
           await deploymentEventsRepo.create({
             instance_id: job.instance_id,
             owner_id: job.owner_id,
             step: "scheduled_job_failed",
             status: "failed",
             message: `定时任务派发失败: ${err.message}`,
             metadata: { job_id: job.id, error_stack: err.stack }
           });
         } catch (auditErr: any) {
           console.error(`[SchedulerRunner] Also failed to write deployment event for job ${job.id}:`, auditErr.message);
         }
      }
    }
  }
}

import { Router, Request, Response } from "express";
import { dbAdapter } from "../db";
import { decrypt } from "../crypto";
import { tasksRepo } from "../repositories/tasksRepo";
import { executeTaskInBackground } from "../workers/taskRunner";

const router = Router();

/**
 * Public incoming webhook endpoint to trigger instance tasks.
 * POST /api/webhooks/incoming/:instance_id/:template_slug?
 */
router.post("/incoming/:instance_id/:template_slug?", async (req: Request, res: Response) => {
  try {
    const { instance_id, template_slug: templateSlugParam } = req.params;
    if (!instance_id) {
      return res.status(400).json({ error: "Missing instance_id in webhook route parameter." });
    }

    // 1. Fetch instance (privileged search)
    const instance = await dbAdapter.getInstanceById(instance_id);
    if (!instance) {
      return res.status(404).json({ error: "Target instance not found." });
    }

    // Parse config_json to read webhook settings
    let config: any = {};
    if (instance.config_json) {
      try {
        config = typeof instance.config_json === "string" ? JSON.parse(instance.config_json) : instance.config_json;
      } catch (e) {
        config = {};
      }
    }

    // Compile the list of allowed template slugs for this instance or blueprint
    const allowedSlugs: string[] = [];
    if (instance.template_slug) {
      allowedSlugs.push(instance.template_slug.toLowerCase());
    }

    if (instance.blueprint_id) {
      let ids: string[] = [];
      // 1. Prefer reading from instance.config_json.blueprint_snapshot
      if (config.blueprint_snapshot && config.blueprint_snapshot.referenced_workflow_template_ids) {
        const snapshotIds = config.blueprint_snapshot.referenced_workflow_template_ids;
        ids = Array.isArray(snapshotIds)
          ? snapshotIds
          : typeof snapshotIds === "string"
            ? JSON.parse(snapshotIds)
            : [];
      } else {
        // 2. Fallback to current DB blueprint if snapshot is missing
        const { blueprintsRepo } = await import("../repositories/blueprintsRepo");
        const blueprint = await blueprintsRepo.findById(instance.blueprint_id);
        if (blueprint && blueprint.referenced_workflow_template_ids) {
          ids = Array.isArray(blueprint.referenced_workflow_template_ids)
            ? blueprint.referenced_workflow_template_ids
            : typeof blueprint.referenced_workflow_template_ids === "string"
              ? JSON.parse(blueprint.referenced_workflow_template_ids)
              : [];
        }
      }

      ids.forEach((id: string) => {
        if (id) {
          allowedSlugs.push(id.toLowerCase().trim());
        }
      });
    }

    // Resolve target template slug from route param, query parameters, or default instance template slug
    const targetSlugRaw = templateSlugParam || req.query.workflow || req.query.template_slug || instance.template_slug || "";
    const targetSlug = String(targetSlugRaw).toLowerCase().trim();

    if (!targetSlug) {
      return res.status(400).json({ error: "Missing template_slug. Could not identify which workflow to trigger." });
    }

    if (!allowedSlugs.includes(targetSlug)) {
      return res.status(400).json({
        error: `The template_slug '${targetSlug}' is not associated with this instance (Allowed: ${allowedSlugs.join(", ")}).`
      });
    }

    // Load template definition to verify details (e.g. readiness)
    const { templatesRepo } = await import("../repositories/templatesRepo");
    const targetTemplate = await templatesRepo.findById(targetSlug);

    if (!targetTemplate) {
      return res.status(404).json({ error: `The target workflow template '${targetSlug}' was not found in the repository.` });
    }
    if (targetTemplate.is_active === false) {
      return res.status(400).json({ error: `The target workflow template '${targetSlug}' is currently disabled or inactive.` });
    }

        // 2. Validate webhook secret if configured, or require it if the workflow requires webhook
    let decryptedSecret = "";
    if (config.webhookSecret) {
      try {
        decryptedSecret = decrypt(config.webhookSecret);
      } catch (e) {
        console.error(`[Webhook Receiver] Failed to decrypt secret for instance ${instance_id}:`, e);
      }
    }

    const requiresWebhook = targetTemplate?.readiness === "requires_webhook";
    
    // Check webhookAuthMode. If webhookSecret exists but authMode is missing, implicit upgrade.
    const authMode = config.webhookAuthMode || (config.webhookSecret ? "secret-required" : "legacy-open");

    if (requiresWebhook && !decryptedSecret) {
      return res.status(401).json({ error: "Unauthorized: Webhook secret is required but not configured on this instance." });
    }

    if (authMode === "secret-required" && !decryptedSecret) {
      return res.status(401).json({ error: "Unauthorized: Webhook secret is required for this instance but not configured. Please configure a Webhook Secret in the instance settings." });
    }

    if (!decryptedSecret && authMode === "legacy-open") {
      console.warn(`[Webhook Receiver] WARNING: Instance ${instance_id} is using legacy-open webhook auth mode. This is insecure and will be deprecated. Please configure a webhookSecret.`);
    }

    if (decryptedSecret) {
      const receivedSecret = req.headers["x-webhook-secret"];
      if (!receivedSecret || typeof receivedSecret !== "string") {
        return res.status(401).json({ error: "Unauthorized: Webhook Secret is missing or invalid in headers (X-Webhook-Secret is required)." });
      }

      // Timing-safe equal implementation
      const crypto = await import("crypto");
      const a = Buffer.from(receivedSecret);
      const b = Buffer.from(decryptedSecret);
      if (a.length !== b.length) {
        return res.status(401).json({ error: "Unauthorized: Webhook Secret verification failed." });
      }
      if (!crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: "Unauthorized: Webhook Secret verification failed." });
      }
    }

    // 3. Request body validation based on matched template slug
    if (targetSlug === "lead-form-auto-reply" || targetSlug === "leadformautoreply") {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Invalid payload: JSON body is required." });
      }
      if (!req.body.name && !req.body.email && !req.body.phone) {
        return res.status(400).json({ error: "Invalid lead form schema: name, email, or phone must be provided." });
      }
    } else if (targetSlug === "ecommerce-order-alert" || targetSlug === "ecommerceorderalert") {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Invalid payload: JSON body is required." });
      }
      if (!req.body.order_id) {
        return res.status(400).json({ error: "Invalid ecommerce order schema: order_id is required." });
      }
    } else {
      // General JSON body validation as safety guard
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Invalid payload: JSON object body is required." });
      }
    }

    // 4. Transform and merge payload inputs
    const mergedInputs = {
      ...(config.template_inputs || {}),
      webhook_payload: req.body,
      ...req.body
    };

    // 5. Create task record in database using targeted sub-template parameters
    let taskTitle = `Webhook 触发工作流: ${targetTemplate?.name || targetSlug}`;
    if (targetSlug === "lead-form-auto-reply" || targetSlug === "leadformautoreply") {
      taskTitle = `Webhook 自动回复客户: ${req.body.name || req.body.email || "未知客户"}`;
    } else if (targetSlug === "ecommerce-order-alert" || targetSlug === "ecommerceorderalert") {
      taskTitle = `Webhook 订单通知: 订单号 ${req.body.order_id}`;
    }

    const payloadContent = {
      template_id: targetTemplate?.id || targetSlug,
      template_slug: targetSlug,
      template_inputs: mergedInputs,
      webhook_raw: req.body,
      timestamp: new Date().toISOString()
    };

    const newTask = await tasksRepo.create({
      owner_id: instance.user_id,
      instance_id: instance.id,
      template_id: targetTemplate?.id || targetSlug,
      title: taskTitle,
      trigger_type: "webhook_incoming",
      status: "queued",
      input_payload: payloadContent
    });

    console.log(`[Webhook Receiver] Successfully received webhook for instance ${instance_id}, queued task: ${newTask.id}`);

    // 6. Asynchronously trigger background worker execution
    executeTaskInBackground(newTask.id).catch(err => {
      console.error(`[Webhook Receiver] Background execution error for task ${newTask.id}:`, err);
    });

    return res.status(202).json({
      success: true,
      message: "Webhook payload validated and task scheduled successfully.",
      task_id: newTask.id,
      status: "queued"
    });

  } catch (err: any) {
    console.error("[Webhook Receiver] Global error handling webhook:", err);
    return res.status(500).json({ error: "Internal server error while processing webhook payload." });
  }
});

export default router;

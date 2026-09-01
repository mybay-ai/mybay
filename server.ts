import "dotenv/config";
import express from "express";
import { createQuestionBridgeRouter } from "./server/routes/questionBridge.routes";
import dns from "dns";

// Force Node.js fetch/dns to prefer IPv4 over IPv6 to fix unroutable IPv6 causing fetch failures in Docker
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

import path from "path";
import { APP_CONTENT_SECURITY_POLICY } from "./server/security/appContentSecurityPolicy";
import fs from "fs";
import { Server as SocketIOServer } from "socket.io";
import { createServer } from "http";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { resolveServerPort } from "./server/utils/portResolver";
import { isKnownClientRoute } from "./server/utils/clientRoutes";

// Import modular routers and socket handlers
import authRouter from "./server/routes/auth";
import systemRouter from "./server/routes/system";
import credentialsRouter from "./server/routes/credentials";
import oauthProvidersRouter from "./server/routes/oauthProviders";
import { createInstancesRouter } from "./server/routes/instances";
import { createDeploymentsRouter } from "./server/routes/deployments";
import instanceSessionAuthRouter, { handleSessionComplete } from "./server/routes/instanceSessionAuth";
import webhooksRouter from "./server/routes/webhooks";
import { startLocalDeployWorker } from "./server/workers/deployWorker";
import { setupSocketLogger } from "./server/sockets/logger";
import { setupChatRealtime } from "./server/services/chatRealtime";
import { dbAdapter } from "./server/db";
import { loadPersistedLocalResourcePolicy } from "./server/services/localResourcePolicy";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./server/utils/authSecrets";
import { sanitizeErrorMessage } from "./server/utils/sanitizer";
import { authenticateToken } from "./server/middlewares/auth";
import { isAuthorizedHtmlPreviewAssetRequest } from "./server/services/instances/htmlPreviewSessions";
import { startDockerGC } from "./server/dockerGC";
import { buildVersionFamilies } from "./server/repositories/versionsRepo";
import { discoverHermesVersions } from "./server/services/hermesVersionDiscovery";
import { prewarmManager } from "./server/prewarmManager";
import { startSchedulerRunner, stopSchedulerRunner } from "./server/schedulerRunner";
import { startReconciler, stopReconciler } from "./server/reconciler";
import { startStorageQuotaEnforcer, stopStorageQuotaEnforcer } from "./server/storageQuotaEnforcer";
import { startRunsReconciler, stopRunsReconciler } from "./server/services/runsReconciler";
import { closeLocalDatabase, getLocalDatabasePath, initializeLocalDatabase } from "./server/localStore";
import { createApplicationHealth } from "./server/appVersion";
import { isTemplateWorkflowsEnabled } from "./server/utils/templateWorkflowsFeature";
import { isAdvancedResourceConfigEnabled } from "./server/utils/advancedResourceConfigFeature";
import { getClientIp } from "./server/utils/ip";
import { validateProductionSecurityConfig } from "./server/utils/productionSecurityConfig";
import { STANDARD_API_JSON_BODY_LIMIT } from "./shared/chatMessageContract";
import { warnIfLegacyOpenWebhooksEnabled } from "./server/services/webhookAuthPolicy";
import { requestCorrelation } from "./server/middlewares/requestCorrelation";

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

function ensureGlobalTraefikConfig() {
  try {
    const proxyMode = process.env.PROXY_MODE || "nginx";
    if (proxyMode !== "traefik") {
      return;
    }
    const traefikDir = process.env.TRAEFIK_DYNAMIC_CONFIG_DIR || process.env.TRAEFIK_CONFIG_DIR || path.join(process.cwd(), "data", "traefik");
    if (!fs.existsSync(traefikDir)) {
      fs.mkdirSync(traefikDir, { recursive: true });
    }
    const consoleInternalUrl = process.env.INSTANCE_AUTH_INTERNAL_URL || process.env.CONTROL_PLANE_INTERNAL_URL || "http://mybay-console-active:15928";

    if (consoleInternalUrl.startsWith("http:") && consoleInternalUrl.includes(":443")) {
      console.warn(`[Proxy Gateway A Traefik Warning] The console URL is ${consoleInternalUrl}. This may cause: The plain HTTP request was sent to HTTPS port`);
    }

    const globalYaml = `
http:
  services:
    mybay-console-service:
      loadBalancer:
        servers:
          - url: "${consoleInternalUrl}"
`.trim();

    const configPath = path.join(traefikDir, "global-console.yml");
    fs.writeFileSync(configPath, globalYaml, "utf8");
    console.log(`[Proxy Gateway A Traefik] Generated/Synchronized global console service file provider configuration at ${configPath} with URL: ${consoleInternalUrl}`);
  } catch (err: any) {
    console.error("[Proxy Gateway A Traefik Error] Failed to generate global console service config:", err.message);
    throw err;
  }
}

async function startServer() {
  validateProductionSecurityConfig();
  // Fail before binding HTTP or starting workers when data is incompatible.
  initializeLocalDatabase();

  if (process.env.DEPLOY_WORKER_MODE === "true") {
    throw new Error("Remote worker mode is not included in the local open-source edition.");
  }

  // Load persisted local resource policy before routes and workers start.
  if (isAdvancedResourceConfigEnabled()) {
    await loadPersistedLocalResourcePolicy();
  }

  // Ensure global Traefik File Provider configuration is loaded
  ensureGlobalTraefikConfig();

  const app = express();
  app.disable("x-powered-by");
  app.use(requestCorrelation);
  const PORT = resolveServerPort(process.env.PORT);
  const httpServer = createServer(app);
  
  console.log("--------------------------------------------------");
  console.log("[System] MyBay Open Source Agent Control Panel starting...");
  console.log(`[Config] 运行端口: ${PORT}`);
  console.log(`[Config] 运行模式: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Config] 基础目录: ${process.cwd()}`);
  console.log(`[Config] Local SQLite: ${getLocalDatabasePath()}`);
  warnIfLegacyOpenWebhooksEnabled();
  
  // Verify encryption key configuration
  let keyConfigured = false;
  let fingerprint = "none";
  try {
    const { isEncryptionKeyConfigured, getEncryptionKeyFingerprint } = await import("./server/crypto");
    keyConfigured = isEncryptionKeyConfigured();
    fingerprint = getEncryptionKeyFingerprint();
  } catch (err: any) {
    console.error("[CRITICAL ERROR] Failed to load/verify ENCRYPTION_KEY:", err.message);
    if (process.env.NODE_ENV === "production") {
      console.error("[CRITICAL ERROR] Production enforcement: App will now exit due to invalid ENCRYPTION_KEY configuration.");
      process.exit(1);
    }
  }

  console.log(`[Config] encryptionKeyConfigured: ${keyConfigured}`);
  console.log(`[Config] encryptionKeyFingerprint: ${fingerprint}`);
  console.log("--------------------------------------------------");
  // MyBay Open Source initializes its on-machine SQLite schema during startup.
  // Initialize Socket.IO
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : (process.env.NODE_ENV === "production" ? false : "*");
  const io = new SocketIOServer(httpServer, {
    cors: { origin: allowedOrigins },
  });

  io.use((socket, next) => {
    let token = socket.handshake.auth?.token;
    
    if (token) {
      const trimmed = token.trim();
      if (trimmed === "" || trimmed === "null" || trimmed === "undefined") {
        token = undefined;
      }
    }
    
    // Fallback: try parsing token from cookie
    if (!token && socket.handshake.headers.cookie) {
      const match = socket.handshake.headers.cookie.match(/(?:^|; )mybay_auth_token=([^;]*)/);
      if (match) {
        const candidate = match[1].trim();
        if (candidate !== "" && candidate !== "null" && candidate !== "undefined") {
          token = candidate;
        }
      }
    }

    if (!token) {
      console.warn("[Socket.IO Auth] Connection rejected: Token is missing");
      return next(new Error("Authentication error: Unauthorized"));
    }
    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) {
        console.warn(`[Socket.IO Auth] Connection rejected: Invalid or expired token (${err.message})`);
        return next(new Error("Authentication error: Unauthorized"));
      }
      (socket as any).user = decoded;
      next();
    });
  });

  io.on("connection", (socket) => {
    const socketUser = (socket as any).user;
    if (socketUser?.id) {
      socket.join(`channel-auth:user:${socketUser.id}`);
    }
    if (socketUser?.role === "admin" || socketUser?.role === "super_admin") {
      socket.join("channel-auth:admins");
    }
  });

  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY);
    next();
  });

  // RFC 9116 security.txt: explicitly serve this single well-known file.
  // The general static middleware intentionally denies dotfiles/directories.
  app.get("/.well-known/security.txt", (req, res) => {
    const root = process.env.NODE_ENV === "production" ? "dist" : "public";
    const securityTxtPath = path.join(process.cwd(), root, ".well-known", "security.txt");

    if (!fs.existsSync(securityTxtPath)) {
      return res.status(404).type("text/plain").send("Not Found");
    }

    res.status(200);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, no-transform");
    return res.sendFile(securityTxtPath);
  });

  app.use("/internal/questions", createQuestionBridgeRouter());
  app.use(express.json({ limit: STANDARD_API_JSON_BODY_LIMIT }));
  app.use("/uploads", express.static(path.join(process.cwd(), "data", "uploads"), {
    dotfiles: "deny",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "private, max-age=3600");
    }
  }));
  
  const trustProxy = process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
    app.set("trust proxy", 1); // Trust immediate proxy (e.g. Traefik/Nginx). 
  } else {
    app.set("trust proxy", false);
  }

  // API Anti-Cache Middleware: Ensure private data is never cached by browsers or CDNs
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  });

  // Security Middleware: Block sensitive dotfiles and environment files from being reached by the SPA fallback
  app.use((req, res, next) => {
    const urlPath = req.path || "";
    const blockedPatterns = [
      /^\/\.env($|\.)/i,     // /.env or /.env.local etc. at root
      /\/\.env($|\.)/i,      // any /.env.* in any subdirectory
      /^\/\.git($|\/)/i,     // /.git/ or /.git at root
      /^\/\.DS_Store$/i,     // /.DS_Store at root
    ];

    if (blockedPatterns.some(pattern => pattern.test(urlPath))) {
      console.warn(`[Security] Blocked sensitive request: ${urlPath} from ${req.ip}`);
      return res.status(404).send("Not Found");
    }
    next();
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => `login:ip:${ipKeyGenerator(getClientIp(req))}`,
    message: { error: "Too many login attempts. Please try again in 15 minutes." }
  });
  const protectedApiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 600,
    keyGenerator: (req) => `protected-api:ip:${ipKeyGenerator(getClientIp(req))}`,
    message: { error: "Too many API requests. Please try again shortly." }
  });
  
  // Socket IO runtime logs streaming
  setupSocketLogger(io);
  setupChatRealtime(io);

  // Prewarm progress is streamed to the authenticated management UI.
  prewarmManager.setSocketIO(io);

  // Public unauthenticated Health Check Endpoint
  app.get("/api/health", (_req, res) => {
    res.json(createApplicationHealth());
  });

  // Feature flags endpoint for frontend consistency (protected with authenticateToken)
  app.get("/api/system/features", authenticateToken, (req, res) => {
    res.json({
      templateCenterEnabled: isTemplateWorkflowsEnabled(),
      advancedResourceConfigEnabled: isAdvancedResourceConfigEnabled()
    });
  });

  // Mount Application Routes
  app.get("/__mybay/session-complete", handleSessionComplete);
  app.use("/api/public/instances", instanceSessionAuthRouter);
  app.use("/api/webhooks", (req, res, next) => {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({
        code: "TEMPLATE_WORKFLOWS_DISABLED",
        error: "Template workflows are not enabled in this MyBay Open Source installation."
      });
    }
    next();
  }, webhooksRouter);
  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api/system", protectedApiLimiter, authenticateToken, systemRouter);
  app.use("/api/credentials", protectedApiLimiter, authenticateToken, credentialsRouter);
  app.use("/api/oauth/providers", protectedApiLimiter, authenticateToken, oauthProvidersRouter);
  app.use("/api/deployments", protectedApiLimiter, createDeploymentsRouter());
  app.use("/api/instances", protectedApiLimiter, (req, res, next) => {
    if (isAuthorizedHtmlPreviewAssetRequest(req.method, req.path, req.headers.cookie)) return next();
    return authenticateToken(req, res, next);
  }, createInstancesRouter(io));

  // Log all registered routes for diagnostics
  console.log("[System] MyBay Open Source starting...");
  
  const printRoutes = (pathPrefix: string, stack: any[]) => {
    stack.forEach((r: any) => {
      if (r.route) {
        const methods = Object.keys(r.route.methods).join(',').toUpperCase();
        console.log(`[Router] ${methods.padEnd(7)} ${pathPrefix}${r.route.path}`);
      } else if (r.name === 'router' && r.handle.stack) {
        const newPrefix = pathPrefix + (r.regexp.source.replace('\\/?(?=\\/|$)', '').replace('^', '').replace('\\/', '/').replace('\\', ''));
        printRoutes(newPrefix, r.handle.stack);
      }
    });
  };

  printRoutes('', app._router.stack);

  // Fetch active local templates (server/templates/ and local store)
  app.get("/api/templates", authenticateToken, async (req: any, res) => {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ error: "Template center is currently disabled" });
    }
    try {
      const { templatesRepo } = await import("./server/repositories/templatesRepo");
      const list = await templatesRepo.listActive();
      const { resolveTemplateLocale, localizeTemplateList } = await import("./server/templates/localization");
      const locale = resolveTemplateLocale(req.query?.lang || req.headers["accept-language"]);
      const { redactSecretsDeep } = await import("./server/utils/sanitizer");
      res.json(redactSecretsDeep(localizeTemplateList(list, locale)));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Fetch local Industry Blueprints
  app.get("/api/templates/blueprints", authenticateToken, async (req: any, res) => {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ error: "Template center is currently disabled" });
    }
    try {
      const { blueprintsRepo } = await import("./server/repositories/blueprintsRepo");
      const list = await blueprintsRepo.listActive();
      const { resolveTemplateLocale, localizeTemplateList } = await import("./server/templates/localization");
      const locale = resolveTemplateLocale(req.query?.lang || req.headers["accept-language"]);
      res.json(localizeTemplateList(list, locale));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/template-blueprints", authenticateToken, async (req: any, res) => {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ error: "Template center is currently disabled" });
    }
    try {
      const { blueprintsRepo } = await import("./server/repositories/blueprintsRepo");
      const list = await blueprintsRepo.listActive();
      const { resolveTemplateLocale, localizeTemplateList } = await import("./server/templates/localization");
      const locale = resolveTemplateLocale(req.query?.lang || req.headers["accept-language"]);
      res.json(localizeTemplateList(list, locale));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Fetch single template details
  app.get("/api/templates/:id", authenticateToken, async (req: any, res) => {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ error: "Template center is currently disabled" });
    }
    try {
      const { templatesRepo } = await import("./server/repositories/templatesRepo");
      const item = await templatesRepo.findById(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Workflow template not found." });
      }
      const { resolveTemplateLocale, localizeTemplateRecord } = await import("./server/templates/localization");
      const locale = resolveTemplateLocale(req.query?.lang || req.headers["accept-language"]);
      const { redactSecretsDeep } = await import("./server/utils/sanitizer");
      res.json(redactSecretsDeep(localizeTemplateRecord(item, locale)));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin: Create template
  app.post("/api/templates", authenticateToken, async (req: any, res) => {
    if (process.env.TEMPLATE_CENTER_ENABLED !== "true") {
      return res.status(404).json({ error: "Template center is currently disabled" });
    }
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ error: "Only platform administrators can create global workflow templates." });
      }
      if (req.body.required_inputs && Array.isArray(req.body.required_inputs)) {
        const keys = req.body.required_inputs.map((i: any) => i.key);
        if (new Set(keys).size !== keys.length) {
          return res.status(400).json({ code: "DUPLICATE_REQUIRED_INPUT_KEY", params: {}, error: "required_inputs contains duplicate keys." });
        }
      }
      const { templatesRepo } = await import("./server/repositories/templatesRepo");
      const newT = await templatesRepo.create(req.body);
      res.status(201).json(newT);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin: Update/Patch template
  app.patch("/api/templates/:id", authenticateToken, async (req: any, res) => {
    if (process.env.TEMPLATE_CENTER_ENABLED !== "true") {
      return res.status(404).json({ error: "Template center is currently disabled" });
    }
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ error: "Only platform administrators can update global workflow templates." });
      }
      if (req.body.required_inputs && Array.isArray(req.body.required_inputs)) {
        const keys = req.body.required_inputs.map((i: any) => i.key);
        if (new Set(keys).size !== keys.length) {
          return res.status(400).json({ code: "DUPLICATE_REQUIRED_INPUT_KEY", params: {}, error: "required_inputs contains duplicate keys." });
        }
      }
      const { templatesRepo } = await import("./server/repositories/templatesRepo");
      const updatedT = await templatesRepo.update(req.params.id, req.body);
      res.json(updatedT);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get user-owned tasks
  app.get("/api/tasks", authenticateToken, async (req: any, res) => {
    try {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ code: "TEMPLATE_WORKFLOWS_DISABLED", error: "Template workflow tasks are disabled." });
    }
      const { tasksRepo } = await import("./server/repositories/tasksRepo");
      const list = await tasksRepo.listByOwner(req.user.id);
      const { redactSecretsDeep } = await import("./server/utils/sanitizer");
      res.json(redactSecretsDeep(list));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get user-owned scheduled tasks trigger jobs
  app.get("/api/scheduled-jobs", authenticateToken, async (req: any, res) => {
    try {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ code: "TEMPLATE_WORKFLOWS_DISABLED", error: "Template workflow scheduling is disabled." });
    }
      const { scheduledJobsRepo } = await import("./server/repositories/scheduledJobsRepo");
      const list = await scheduledJobsRepo.listByOwner(req.user.id);
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manually trigger a task execution instantly
  app.post("/api/tasks/:id/trigger", authenticateToken, async (req: any, res) => {
    try {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ code: "TEMPLATE_WORKFLOWS_DISABLED", error: "Template workflow tasks are disabled." });
    }
      const { tasksRepo } = await import("./server/repositories/tasksRepo");
      const task = await tasksRepo.findById(req.params.id);
      if (!task || task.owner_id !== req.user.id) {
        return res.status(404).json({ error: "Task not found or permission denied." });
      }
      const templateKey = String(task.template_id || task.input_payload?.template_id || task.input_payload?.template_slug || "").toLowerCase();
      const { evaluateInstanceWorkflowReadiness } = await import("./server/services/workflowReadinessService");
      const { readiness } = await evaluateInstanceWorkflowReadiness({
        instanceId: task.instance_id, templateId: templateKey, executionPayload: task.input_payload
      });
      if (!readiness.ready) {
        return res.status(422).json({
          error: "CONFIG_REQUIRED",
          readiness: readiness.state,
          message: readiness.message,
          needsSetupUrl: true,
          instanceId: task.instance_id,
          setupSection: readiness.state === "file_required" ? "files" : "workflow",
          missingFields: readiness.missingRequirements.map((item) => item.key || item.provider || item.type)
        });
      }
      if (task.status === "config_required") {
        task.status = "queued";
        await tasksRepo.update(task.id, { status: "queued", error: null });
      }

      // Guard check to prevent multiple parallel runs (idempotency safety)
      if (task.status === "processing") {
        const startedAtVal = task.started_at;
        const updatedAtVal = task.updated_at;
        const nowMs = Date.now();
        const updatedDiff = updatedAtVal ? (nowMs - new Date(updatedAtVal).getTime()) : 0;
        const isStale = !startedAtVal || (updatedDiff > 10 * 60 * 1000);

        if (!isStale) {
          return res.status(400).json({ code: "TASK_ALREADY_RUNNING", params: { taskId: task.id }, error: "The task is already running." });
        }
      }
      if (task.status === "config_required") {
        return res.status(422).json({
          error: "CONFIG_REQUIRED",
          message: task.input_payload?.workflow_readiness?.setup_message || "Please complete the business configuration before running this task.",
          needsSetupUrl: true,
          instanceId: task.instance_id,
          setupSection: task.input_payload?.workflow_readiness?.setup_section || "shop-monitor",
          missingFields: task.input_payload?.workflow_readiness?.missing_fields || []
        });
      }
      if (task.status === "success") {
        return res.status(400).json({ code: "TASK_ALREADY_COMPLETED", params: { taskId: task.id }, error: "The task has already completed." });
      }

      // Import and invoke background task processing
      const { executeTaskInBackground } = await import("./server/workers/taskRunner");
      executeTaskInBackground(task.id).catch(innerErr => {
        console.error("[tasks:trigger] Async task runner worker execution failed:", innerErr);
      });

      res.json({ success: true, message: "Task has been dispatched. Please check the result later." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get task run output result/markdown safely
  app.get("/api/tasks/:id/result", authenticateToken, async (req: any, res) => {
    try {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ code: "TEMPLATE_WORKFLOWS_DISABLED", error: "Template workflow tasks are disabled." });
    }
      const { tasksRepo } = await import("./server/repositories/tasksRepo");
      const task = await tasksRepo.findById(req.params.id);
      if (!task || task.owner_id !== req.user.id) {
        return res.status(404).json({ error: "Task not found or access denied." });
      }

      const result = task.result || {};
      
      // 1. If result.markdown exists, return directly
      if (result.markdown) {
        return res.json({ markdown: result.markdown });
      }

      // 2. Otherwise read from result.output_file safely
      if (result.output_file) {
        const outputFilename = path.basename(result.output_file);
        
        // Security check: restrict extensions to .md / .txt
        const ext = path.extname(outputFilename).toLowerCase();
        if (ext !== ".md" && ext !== ".txt") {
          return res.status(403).json({ error: "Security policy blocked this request. Only text or Markdown reports can be viewed." });
        }

        const instanceId = task.instance_id;
        const instanceOutputsDir = path.resolve(process.cwd(), "data", "instances", instanceId, "outputs");
        const fullFilePath = path.resolve(instanceOutputsDir, outputFilename);

        // Security check: must reside inside instanceOutputsDir and forbid traversal
        if (!fullFilePath.startsWith(instanceOutputsDir + path.sep) && fullFilePath !== instanceOutputsDir) {
          return res.status(403).json({ error: "Security policy blocked this request because the file path is outside the allowed directory." });
        }

        const fs = await import("fs");
        if (fs.existsSync(fullFilePath)) {
          const content = fs.readFileSync(fullFilePath, "utf8");
          return res.json({ markdown: content });
        }
      }

      // 3. Fallback to content_preview if available
      if (result.content_preview) {
        return res.json({
          markdown: result.content_preview,
          warning: "Full report file is not available. Showing content preview only."
        });
      }

      return res.status(404).json({ error: "This task has not generated report content yet." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Enable/disable active level of scheduled trigger job
  app.post("/api/scheduled-jobs/:id/toggle", authenticateToken, async (req: any, res) => {
    try {
    if (!isTemplateWorkflowsEnabled()) {
      return res.status(404).json({ code: "TEMPLATE_WORKFLOWS_DISABLED", error: "Template workflow scheduling is disabled." });
    }
      const { scheduledJobsRepo } = await import("./server/repositories/scheduledJobsRepo");
      const job = await scheduledJobsRepo.findById(req.params.id);
      if (!job || job.owner_id !== req.user.id) {
        return res.status(404).json({ error: "Scheduled job not found or not editable." });
      }

      if (!job.is_active) {
        const templateKey = String(job.template_id || job.input_payload?.template_id || job.input_payload?.template_slug || "").toLowerCase();
        const { evaluateInstanceWorkflowReadiness } = await import("./server/services/workflowReadinessService");
        const { readiness } = await evaluateInstanceWorkflowReadiness({ instanceId: job.instance_id, templateId: templateKey });
        if (!readiness.ready) {
          return res.status(422).json({
            error: "CONFIG_REQUIRED", readiness: readiness.state, message: readiness.message,
            needsSetupUrl: true, instanceId: job.instance_id,
            setupSection: readiness.state === "file_required" ? "files" : "workflow",
            missingFields: readiness.missingRequirements.map((item) => item.key || item.provider || item.type)
          });
        }
      }


      const updated = await scheduledJobsRepo.update(job.id, {
        is_active: !job.is_active,
        updated_at: new Date().toISOString()
      });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Support both legacy `/api/agent-versions` and the new `/api/mybay-versions` endpoints
  app.get("/api/agent-versions", authenticateToken, async (req, res) => {
    try {
      const raw = await dbAdapter.getMyBayVersions();
      const families = buildVersionFamilies(raw).slice(0, 3);
      const mapped = families.map((v: any) => ({
        tag: v.tag,
        version: v.version,
        desc: v.changelog || "No release notes available.",
        releaseAt: v.published_at ? v.published_at.substring(0, 10) : "",
        capabilities: v.capabilities || ["core"],
        feishu_capable: v.feishu_capable,
        coreVariant: v.coreVariant,
        feishuVariant: v.feishuVariant,
        is_prewarmed: v.is_prewarmed,
        prewarm_status: v.prewarm_status
      }));
      res.json(mapped);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/mybay-versions", authenticateToken, async (req, res) => {
    try {
      const raw = await dbAdapter.getMyBayVersions();
      const families = buildVersionFamilies(raw).slice(0, 3);
      res.json(families);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/mybay-versions/latest", authenticateToken, async (req, res) => {
    try {
      const latest = await dbAdapter.getLatestMyBayVersion();
      if (!latest) {
        return res.status(404).json({ error: "No official version discovered yet." });
      }
      res.json(latest);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Support both new `/api/mybay-versions/sync` and legacy `/api/hermes-versions/sync` (for total compatibility)
  const handleVersionSyncRequest = async (req: any, res: any) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ error: "Only platform administrators can manually trigger version discovery." });
      }
      const beforeList = await dbAdapter.getMyBayVersions().catch(() => []);
      const beforeLatest = await dbAdapter.getLatestMyBayVersion().catch(() => null);

      await discoverHermesVersions();

      const afterList = await dbAdapter.getMyBayVersions().catch(() => []);
      const afterLatest = await dbAdapter.getLatestMyBayVersion().catch(() => null);

      const beforeSet = new Set(beforeList.map((v: any) => v.version));
      const newlyDiscovered = afterList.filter((v: any) => !beforeSet.has(v.version));
      const hasNewVersions = newlyDiscovered.length > 0;
      const latestChanged = beforeLatest ? (afterLatest ? beforeLatest.version !== afterLatest.version : false) : !!afterLatest;

      res.json({
        success: true,
        message: "Official version repository synchronized successfully.",
        hasNewVersions,
        latestChanged,
        newlyDiscoveredCount: newlyDiscovered.length,
        latestVersion: afterLatest ? (afterLatest.familyVersion || afterLatest.version) : null,
        newVersions: newlyDiscovered.map((v: any) => v.version)
      });
    } catch (e: any) {
      res.status(502).json({
        code: e?.code || "VERSION_DISCOVERY_FAILED",
        params: {},
        error: sanitizeErrorMessage(e?.message) || "Unable to check upstream Hermes releases; local metadata was retained."
      });
    }
  };

  app.post("/api/mybay-versions/sync", authenticateToken, handleVersionSyncRequest);
  app.post("/api/hermes-versions/sync", authenticateToken, handleVersionSyncRequest);

  app.post("/api/mybay-versions/prewarm", authenticateToken, async (req: any, res) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ code: "ADMIN_REQUIRED", params: {}, error: "Only platform administrators can trigger image pre-warming." });
      }
      const { version, image, tag } = req.body;
      if (!version || !image || !tag) {
        return res.status(400).json({ code: "INVALID_PREWARM_REQUEST", params: {}, error: "version, image and tag are required." });
      }
      
      await prewarmManager.addToQueue(String(version), String(image), String(tag));
      res.status(202).json({ success: true, status: "queued", version, image, tag });
    } catch (e: any) {
      res.status(500).json({ code: "PREWARM_QUEUE_FAILED", params: {}, error: sanitizeErrorMessage(e?.message) || "Unable to queue image pull." });
    }
  });


  // Catch-all API 404 Logger: Positioned after all defined routes
  app.use("/api/*", (req, res) => {
    console.warn(`[404] API Route Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
      error: "Not Found"
    });
  });

  // Vite dynamic asset pipeline integration
  if (process.env.NODE_ENV !== "production") {
    console.log("[System] MyBay Open Source starting...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (!fs.existsSync(distPath)) {
      console.error("--------------------------------------------------");
      console.error("[CRITICAL ERROR] 'dist' 目录不存在。");
      console.error("Please run npm run build before starting in production.");
      console.error("--------------------------------------------------");
    } else {
      console.log(`[System] 正在提供静态资源服务：${distPath}`);

      // Security: Prevent serving backend artifacts or sensitive files from static directory
      const sensitiveExts = ['.env', '.git', '.map', '.bak', '.sql', '.log', '.yaml', '.yml', '.cjs'];
      app.use((req, res, next) => {
        if (sensitiveExts.some(ext => req.path.endsWith(ext) || req.path.includes('/.git/'))) {
          return res.status(403).send('Forbidden');
        }
        next();
      });

      const hasFileExtension = (urlPath: string): boolean => {
        const p = urlPath.split('?')[0];
        const lastSegment = p.substring(p.lastIndexOf('/') + 1);
        return lastSegment.includes('.') && !lastSegment.endsWith('.html');
      };

      // 1. Global Trailing Slash Normalization: Run BEFORE express.static to prevent soft-duplicate serving
      app.use((req, res, next) => {
        const pathname = req.path;
        if (pathname.length > 1 && pathname.endsWith("/")) {
          const normalizedPath = pathname.replace(/\/+$/, "");
          const queryIndex = req.originalUrl.indexOf("?");
          const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
          return res.redirect(301, `${normalizedPath}${query}`);
        }
        next();
      });

      app.use(express.static(distPath, { dotfiles: "deny", redirect: false }));
      app.get("*", (req, res) => {
        const pathname = req.path;

        const spaPath = path.join(distPath, "spa.html");
        const indexPath = path.join(distPath, "index.html");
        
        // Use spa.html as fallback if it exists (it's the clean template without prerender markers)
        const fallbackPath = fs.existsSync(spaPath) ? spaPath : indexPath;
        
        // 2. If it has a file extension (e.g. missing asset, sourcemap, etc.)
        if (hasFileExtension(pathname)) {
          return res.status(404).send("Not Found");
        }

        // 3. Known pre-rendered public route check with path traversal protection
        const relativePath = pathname.replace(/^\/+/, "");
        if (relativePath.includes('..')) {
          return res.status(403).send("Forbidden");
        }

        let prerenderedPath: string;
        if (relativePath === "") {
          prerenderedPath = path.join(distPath, "index.html");
        } else {
          prerenderedPath = path.join(distPath, relativePath, "index.html");
        }

        // Absolute path prefix check to fully prevent traversal
        if (prerenderedPath.startsWith(distPath)) {
          if (fs.existsSync(prerenderedPath)) {
            return res.status(200).sendFile(prerenderedPath);
          }
        }

        // 4. If it is a known app SPA route
        if (isKnownClientRoute(pathname)) {
          if (fs.existsSync(fallbackPath)) {
            return res.sendFile(fallbackPath);
          } else {
            return res.status(404).send("Frontend build missing (index.html not found). Please run npm run build.");
          }
        }

        // 5. Otherwise, it is an unknown public route -> serve 404.html with status 404
        const error404Path = path.join(distPath, "404.html");
        if (fs.existsSync(error404Path)) {
          return res.status(404).sendFile(error404Path);
        } else if (fs.existsSync(fallbackPath)) {
          return res.status(404).sendFile(fallbackPath);
        } else {
          return res.status(404).send("Not Found");
        }
      });
    }
  }

  // Optional Docker background garbage collector. Disabled by default in the open-source edition
  // because Docker Desktop on Windows does not expose /var/run/docker.sock.
  if (process.env.MYBAY_DOCKER_GC_ENABLED === "true") {
    startDockerGC().catch(e => console.error("Failed to start Docker GC:", e));
  } else {
    console.log("[Docker GC] Disabled. Set MYBAY_DOCKER_GC_ENABLED=true to enable it.");
  }

  // Start Local Pure background services. Each starter is idempotent and owns its timer lifecycle.
  await startReconciler(60000, { io });
  await startRunsReconciler();
  await startStorageQuotaEnforcer();
  startSchedulerRunner();

  // Start the local in-process Docker deployment worker
  if (process.env.ENABLE_LOCAL_WORKER !== "false") {
    startLocalDeployWorker(io);
  } else {
    console.log("[Deploy Worker] Local in-process deployment worker is explicitly disabled via ENABLE_LOCAL_WORKER=false.");
  }

  // Template workflows are an optional extension and remain dormant by default.
  if (isTemplateWorkflowsEnabled()) {
    try {
      const { templatesRepo } = await import("./server/repositories/templatesRepo");
      await templatesRepo.initAndSeed();
      const { blueprintsRepo } = await import("./server/repositories/blueprintsRepo");
      await blueprintsRepo.seedBlueprints();
      console.log("[Startup] Optional template workflows loaded into local SQLite.");
    } catch (err: any) {
      console.error("[Startup Templates Seed Error] Could not initialize local templates:", err.message);
    }
  } else {
    console.log("[Startup] Optional template workflows disabled; template seeding skipped.");
  }

  if (process.env.MYBAY_ENABLE_OPENAI_SELF_REPAIR === "true") {
    try {
      const { repairExistingOpenAIInstances } = await import("./server/providerEnv");
      await repairExistingOpenAIInstances();
    } catch (err: any) {
      console.error("[Startup Self-Repair Error] Could not auto-repair OpenAI instances:", err.message);
    }
  } else {
    console.log("[Startup] OpenAI instance self-repair disabled for open-source edition.");
  }

  let shutdownStarted = false;
  const shutdown = (signal: string) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    console.log(`[Shutdown] ${signal} received; stopping background services...`);
    stopSchedulerRunner();
    stopReconciler();
    stopRunsReconciler();
    stopStorageQuotaEnforcer();
    httpServer.close(() => {
      closeLocalDatabase();
      process.exit(0);
    });
    const forceExit = setTimeout(() => {
      closeLocalDatabase();
      process.exit(1);
    }, 10000);
    forceExit.unref?.();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Ready] MyBay service started at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup failure.";
  console.error(`[Startup] ${message}`);
  process.exitCode = 1;
});







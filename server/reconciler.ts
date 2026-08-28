import { docker } from "./lib/docker";
import { dbAdapter } from "./db";
import * as fs from "fs";
import * as path from "path";
import { parseTraefikEnv } from "./infrastructure/traefik/traefikConfig";
import { buildDeploymentContext } from "./deploymentContext";
import { cleanupInstanceResources, compensateDeployment } from "./services/instanceCleanup";
import { instanceOperationCoordinator } from "./services/instances/instanceOperationCoordinator";
import { reconcileChatAttachmentStorage } from "./services/chatAttachmentStorage";
import type { Server as SocketIOServer } from "socket.io";

async function reloadGatewayOfInstance(instanceId: string) {
  const containerName = `mybay-agent-${instanceId}`;
  const container = docker.getContainer(containerName);

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
    console.warn(`[SyncHermesHomeDirWarning] Failed to synchronize files:`, syncErr.message);
  }

  const serviceName = "gateway";
  const possibleDirs = [
    `/run/service/${serviceName}-default`,
    `/var/run/s6/services/${serviceName}-default`,
    `/run/s6-rc/servicedirs/${serviceName}-default`,
    `/run/service/${serviceName}`,
    `/var/run/s6/services/${serviceName}`
  ];
  const possibleCmds = ["/command/s6-svc", "s6-svc"];
  
  let validDir: string | null = null;
  for (const p of possibleDirs) {
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

  if (validDir) {
    for (const cmd of possibleCmds) {
      try {
        const trySignal = async (sig: string) => {
          const execObj = await container.exec({
            Cmd: [cmd, sig, validDir!],
            AttachStdout: true, AttachStderr: true
          });
          const stream = await execObj.start({ Detach: false });
          await new Promise<void>(r => { 
            stream.on("data", () => {}); 
            stream.on("end", () => r()); 
          });
          const inspect = await execObj.inspect();
          return inspect.ExitCode === 0;
        };

        const resH = await trySignal("-h");
        if (resH) break;
        const resT = await trySignal("-t");
        if (resT) break;
        const resR = await trySignal("-r");
        if (resR) break;
      } catch (err) {}
    }
  }
}

async function migrateExistingQQBotInstances() {
  try {
    const dbInstances = await dbAdapter.getAllInstances();
    for (const instance of dbInstances) {
      const instanceId = instance.id;
      const envPath = path.join(process.cwd(), "data", "instances", instanceId, ".env");
      if (!fs.existsSync(envPath)) {
        continue;
      }

      const envContent = fs.readFileSync(envPath, "utf-8");
      const lines = envContent.split(/\r?\n/);
      
      const envMap: Record<string, string> = {};
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const idx = trimmed.indexOf("=");
          const key = trimmed.substring(0, idx).trim();
          const val = trimmed.substring(idx + 1).trim();
          envMap[key] = val;
        }
      });

      let changed = false;
      if (envMap.QQ_BOT_APP_ID && !envMap.QQ_APP_ID) {
        envMap.QQ_APP_ID = envMap.QQ_BOT_APP_ID;
        changed = true;
      }
      if (envMap.QQ_BOT_SECRET && !envMap.QQ_CLIENT_SECRET) {
        envMap.QQ_CLIENT_SECRET = envMap.QQ_BOT_SECRET;
        changed = true;
      }

      if (changed) {
        console.log(`[Migration] Migrating QQBot config variables for instance: ${instanceId}`);
        const backupPath = envPath + ".bak";
        fs.copyFileSync(envPath, backupPath);

        try {
          const outputLines: string[] = [...lines];

          if (envMap.QQ_APP_ID && !outputLines.some(l => l.trim().startsWith("QQ_APP_ID="))) {
            outputLines.push(`QQ_APP_ID=${envMap.QQ_APP_ID}`);
          }
          if (envMap.QQ_CLIENT_SECRET && !outputLines.some(l => l.trim().startsWith("QQ_CLIENT_SECRET="))) {
            outputLines.push(`QQ_CLIENT_SECRET=${envMap.QQ_CLIENT_SECRET}`);
          }

          const tmpPath = envPath + ".tmp";
          fs.writeFileSync(tmpPath, outputLines.join("\n"), "utf-8");
          
          try {
            const stats = fs.statSync(envPath);
            fs.chmodSync(tmpPath, stats.mode);
          } catch (e) {
            fs.chmodSync(tmpPath, 0o600);
          }

          fs.renameSync(tmpPath, envPath);
          console.log(`[Migration] Successfully migrated .env for instance: ${instanceId}`);

          await reloadGatewayOfInstance(instanceId).catch((reloadErr) => {
            console.error(`[Migration Error] Failed to restart gateway after migration for instance ${instanceId}:`, reloadErr.message);
          });
        } catch (err: any) {
          console.error(`[Migration Error] Failed during atomic write for instance ${instanceId}:`, err.message);
          if (fs.existsSync(backupPath)) {
            try {
              fs.copyFileSync(backupPath, envPath);
              console.log(`[Migration] Restored .env from backup for instance: ${instanceId}`);
            } catch (restoreErr) {}
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[Migration Header Error] Global instance QQBot migration failed:", err.message);
  }
}

// Global map to track auto-healing retry attempts to prevent infinite CrashLoopBackoff storms
const autoHealAttempts = new Map<string, number>();
const DEFAULT_TRANSITION_RECOVERY_TIMEOUT_MS = 5 * 60 * 1000;

function getTransitionRecoveryTimeoutMs() {
  const configured = Number(process.env.MYBAY_TRANSITION_RECOVERY_TIMEOUT_MS || DEFAULT_TRANSITION_RECOVERY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 30_000
    ? configured
    : DEFAULT_TRANSITION_RECOVERY_TIMEOUT_MS;
}

function isStaleTransition(instance: any, nowMs = Date.now()) {
  const timestamp = Date.parse(String(instance.updated_at || instance.started_at || instance.created_at || ""));
  return !Number.isFinite(timestamp) || nowMs - timestamp >= getTransitionRecoveryTimeoutMs();
}

function expectsContainerToRun(instance: any) {
  return [
    "running",
    "partial_running",
    "degraded",
    "restarting",
    "container_starting",
    "gateway_starting",
    "dashboard_ready",
  ].includes(String(instance.status));
}

function getPersistedAutoHealAttempts(instance: any) {
  const persisted = Number(instance?.metadata?.recovery?.container_start_attempts || 0);
  return Math.max(autoHealAttempts.get(instance.id) || 0, Number.isFinite(persisted) ? persisted : 0);
}

async function persistAutoHealState(instance: any, attempts: number, error: string | null = null) {
  const metadata = instance.metadata || {};
  const recovery = {
    ...(metadata.recovery || {}),
    container_start_attempts: attempts,
    last_container_start_at: attempts > 0 ? new Date().toISOString() : null,
    last_container_start_error: error,
  };
  const updatedMetadata = { ...metadata, recovery };
  instance.metadata = updatedMetadata;
  await dbAdapter.updateInstanceVersionInfo(instance.id, { metadata: updatedMetadata }).catch(() => {});
}

async function healLegacyTraefikLabels() {
  const { isTraefik } = parseTraefikEnv(process.env);
  if (!isTraefik) return;

  try {
    const dbInstances = await dbAdapter.getAllInstances();
    const containers = await docker.listContainers({ all: true });
    const { getTraefikAuthMiddlewareName, getTraefikRouterName } = require("./infrastructure/traefik/traefikConfig");
    const { executeDeployment } = require("./dockerDeployment");

    for (const instance of dbInstances) {
      if (instance.status === 'deploying' || instance.status === 'restarting' || instance.upgrade_status === 'upgrading') continue;

      let config: any = {};
      try {
        config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
      } catch (e) {}

      if (!config.webPasswordHash) continue;

      const containerName = instance.container_name || `mybay-agent-${instance.id}`;
      const actualContainer = containers.find(c => c.Names.some(n => n.includes(containerName)));
      if (!actualContainer || actualContainer.State !== 'running') continue;

      const routerName = getTraefikRouterName(instance.id);
      const authMiddlewareName = getTraefikAuthMiddlewareName(routerName);
      const labelKey = `traefik.http.middlewares.${authMiddlewareName}.forwardauth.address`;
      const actualLabelValue = actualContainer.Labels ? actualContainer.Labels[labelKey] : undefined;

      const mybayRouterName = `${routerName}-mybay`;
      const sessionCompleteServiceLabel = `traefik.http.routers.${mybayRouterName}.service`;
      const actualSessionCompleteService = actualContainer.Labels ? actualContainer.Labels[sessionCompleteServiceLabel] : undefined;
      const hasOldServersUrlLabel = actualContainer.Labels ? Object.keys(actualContainer.Labels).some(k => k.includes("loadbalancer.servers[0].url")) : false;

      const isSessionCompleteMissingOrInvalid = !actualSessionCompleteService || actualSessionCompleteService !== "mybay-console-service@file" || hasOldServersUrlLabel;

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

      if (hasLegacyPattern || isMismatch || isMissingLabel || isSessionCompleteMissingOrInvalid) {
        console.log(`[Reconciler] Instance ${instance.id} ForwardAuth or Bypass label issue (hasLegacyPattern=${hasLegacyPattern}, isMismatch=${isMismatch}, isMissingLabel=${isMissingLabel}, isSessionCompleteMissingOrInvalid=${isSessionCompleteMissingOrInvalid}). Recreating to heal...`);
        const mockIo: any = { emit: () => {} };
        const dummyStmt = { run: (params: any) => {
           dbAdapter.updateInstanceVersionInfo(params.id, { status: params.status }).catch(() => {});
        } };
        await dbAdapter.updateInstanceVersionInfo(instance.id, { status: 'restarting' });
        // Run in background so it doesn't block
        executeDeployment(instance, mockIo, dummyStmt, config, { role: "system" }, true).catch((e: any) => {
           console.error(`[Reconciler] Failed to self-heal Traefik proxy labels for ${instance.id}:`, e);
        });
      }
    }
  } catch (err: any) {
    console.error("[HealLegacyTraefikLabels Error]", err.message);
  }
}

/**
 * State Reconciler Manager
 * Maintains consistency between the Database and the actual Docker state.
 */
let reconcilerTimer: NodeJS.Timeout | null = null;
let reconcileCycleActive = false;
let attachmentMaintenanceActive = false;

function scheduleChatAttachmentMaintenance() {
  if (attachmentMaintenanceActive) return;
  attachmentMaintenanceActive = true;
  void reconcileChatAttachmentStorage()
    .catch((error: any) => {
      console.warn(JSON.stringify({ operation: "chat_attachment_storage_reconcile_failed", error: error?.message || "unknown" }));
    })
    .finally(() => { attachmentMaintenanceActive = false; });
}

interface ReconcilerOptions {
  allowInTest?: boolean;
  runStartupMaintenance?: boolean;
  io?: SocketIOServer;
}

export async function startReconciler(intervalMs: number = 60000, options: ReconcilerOptions = {}) {
  if (reconcilerTimer || (process.env.NODE_ENV === "test" && !options.allowInTest)) return;
  console.log(`[Reconciler] Background state motor started (Interval: ${intervalMs / 1000}s)`);

  if (options.runStartupMaintenance !== false) {
    migrateExistingQQBotInstances().catch(err => {
      console.error("[StartReconciler Migration Error] Failed to complete instance migration:", err);
    });
    healLegacyTraefikLabels().catch(err => {
      console.error("[StartReconciler Traefik Heal Error] Failed to complete Traefik labels healing:", err);
    });
  }

  const reconcile = async () => {
    if (reconcileCycleActive) return;
    reconcileCycleActive = true;
    try {
      scheduleChatAttachmentMaintenance();
      // 1. Get all instances from DB
      const dbInstances = await dbAdapter.getAllInstances();
      const deploymentTasks = await dbAdapter.listAllDeploymentTasks().catch(() => []);
      const activeDeploymentInstances = new Set(
        deploymentTasks
          .filter((task: any) => ["queued", "deploying", "retry_wait"].includes(String(task.status)))
          .map((task: any) => String(task.instance_id)),
      );
      
      // 2. Get all containers from Docker (active or not)
      const containers = await docker.listContainers({ all: true });
      const containerMap = new Map();
      const networks = await docker.listNetworks().catch(() => []);
      const networkNames = new Set(networks.map((network: any) => network.Name));
      
      // Sort containers so that 'running' ones or newer ones are processed last, yielding correct mapping override
      const sortedContainers = [...containers].sort((a, b) => {
        if (a.State === 'running' && b.State !== 'running') return 1;
        if (a.State !== 'running' && b.State === 'running') return -1;
        return (a.Created || 0) - (b.Created || 0); // older first, newer last to overwrite older ones
      });
      
      sortedContainers.forEach(c => {
         c.Names.forEach(name => {
           const cleanedName = name.startsWith('/') ? name.substring(1) : name;
           containerMap.set(cleanedName, c);
         });
      });

      // 2b. Fetch Traefik container networks for proxy self-healing
      const { isTraefik, traefikContainerName } = parseTraefikEnv(process.env);
      let traefikNetworks: string[] = [];
      if (isTraefik) {
        try {
          let traefikContainer: any = null;
          
          try {
            const container = docker.getContainer(traefikContainerName);
            const inspectData = await container.inspect();
            if (inspectData && inspectData.NetworkSettings && inspectData.NetworkSettings.Networks) {
              traefikNetworks = Object.keys(inspectData.NetworkSettings.Networks);
            }
          } catch (err) {
            // Find by image/name search as fallback
            const list = await docker.listContainers({ all: false });
            const found = list.find(c => 
              c.Names.some(n => n.includes("traefik")) || 
              (c.Image && c.Image.includes("traefik"))
            );
            if (found) {
              const container = docker.getContainer(found.Id);
              const inspectData = await container.inspect();
              if (inspectData && inspectData.NetworkSettings && inspectData.NetworkSettings.Networks) {
                traefikNetworks = Object.keys(inspectData.NetworkSettings.Networks);
              }
            }
          }
        } catch (inspectErr) {
          console.error("[Reconciler Traefik Inspect Warning] Failed to inspect Traefik container networks:", inspectErr);
        }
      }

      // 3. Compare and Update
      for (const instance of dbInstances) {
        try {
         const containerName = instance.container_name || `mybay-agent-${instance.id}`;
         const actualContainer = containerMap.get(containerName);
         const isPhysicallyRunning = actualContainer && actualContainer.State === 'running';
         const networkName = buildDeploymentContext(instance).networkName;
         const hasManagedResources = Boolean(actualContainer) || networkNames.has(networkName);

         if (instance.status === "deleting" || (instance.desired_state === "deleted" && !["deleted", "failed"].includes(instance.status))) {
            await dbAdapter.updateInstanceRecord(instance.id, { status: "deleting", desired_state: "deleted" });
            await dbAdapter.createCleanupTask(instance.id);
            continue;
         }

         if (instance.status === "deleted") {
            if (hasManagedResources || !instance.cleanup_verified_at) {
               await cleanupInstanceResources(instance, undefined, "delete");
               await dbAdapter.updateInstanceRecord(instance.id, {
                  cleanup_verified_at: new Date().toISOString(),
                  container_id: null,
                  container_name: null,
               });
            }
            continue;
         }

         if (instance.status === "failed" && instance.desired_state !== "deleted" && (hasManagedResources || !instance.compensated_at)) {
            await compensateDeployment(instance);
            await dbAdapter.updateInstancePhysicalState(instance.id, {
               physical_status: "missing",
               physical_error: null,
               last_reconciled_at: new Date().toISOString(),
            });
            continue;
         }

         // Skip reconciliation for instances that are currently deploying, restarting, or upgrading
         // Also skip if storage quota is exceeded to prevent auto-restart loops
         let config: any = {};
         try {
           config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : (instance.config_json || {});
         } catch (e) {}

         // If physically running, proactively heal/clear any storageExceeded flag to prevent loop
         if (isPhysicallyRunning && config.storageExceeded === true) {
            console.log(`[Reconciler] Container "${containerName}" is physically running. Proactively clearing stale storageExceeded flag.`);
            config.storageExceeded = false;
            await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config)).catch(() => {});
         }

         const isRecoverableTransition = instance.status === "deploying" || instance.status === "restarting";
         const transitionOwned = activeDeploymentInstances.has(String(instance.id)) || Boolean(instanceOperationCoordinator.getActive(instance.id));
         const recoverStaleTransition = isRecoverableTransition && !transitionOwned && isStaleTransition(instance);

         if (recoverStaleTransition) {
            const recoveryStatus = isPhysicallyRunning ? "gateway_starting" : "restarting";
            console.warn(`[Reconciler] Recovering stale instance transition ${instance.id}: ${instance.status} -> ${recoveryStatus} (physical=${actualContainer?.State || "missing"}).`);
            await dbAdapter.updateInstanceRecord(instance.id, {
               status: recoveryStatus,
               health_status: isPhysicallyRunning ? "checking" : "unhealthy",
               error_code: null,
               error_message: null,
               deployment_error: null,
            });
            instance.status = recoveryStatus;
         }

         if ((isRecoverableTransition && !recoverStaleTransition) || instance.upgrade_status === 'upgrading' || config.storageExceeded === true) {
            if (config.storageExceeded === true) {
               // Update DB with storage_exceeded status if not already set to make it visible in reconciler logs/metadata
               await dbAdapter.updateInstancePhysicalState(instance.id, {
                 physical_status: 'exited', // or 'storage_exceeded' if we want to be explicit in backend
                 physical_error: 'Disk quota exceeded. Container stopped by enforcement.',
                 last_reconciled_at: new Date().toISOString()
               }).catch(() => {});
            }
            continue;
         }

         let physical_status = 'missing';
         let physical_error = null;

         if (actualContainer) {
            physical_status = actualContainer.State; // e.g. 'running', 'exited', 'paused'
            
            // Proactively align container_id in database if it differs from Docker reality
            if (instance.container_id !== actualContainer.Id) {
               await dbAdapter.updateInstancePhysicalState(instance.id, {
                  container_id: actualContainer.Id
               }).catch(() => {});
               instance.container_id = actualContainer.Id;
            }

            // If the user expects it to be running but it's exited/stopped/paused
            const expectsRunning = expectsContainerToRun(instance);
            if (expectsRunning && physical_status !== 'running') {
               const attempts = getPersistedAutoHealAttempts(instance);
               if (attempts < 3) {
                  const nextAttempts = attempts + 1;
                  autoHealAttempts.set(instance.id, nextAttempts);
                  console.log(`[Self-Heal] Container "${containerName}" (instance: ${instance.id}) is in state "${physical_status}" but expected "running". Triggering automatic recovery (Attempt ${nextAttempts}/3)...`);
                  
                  try {
                     await persistAutoHealState(instance, nextAttempts);
                     const container = docker.getContainer(actualContainer.Id);
                     await container.start();
                     const recoveredState = await container.inspect();
                     const verifiedState = String(recoveredState?.State?.Status || "unknown");
                     if (verifiedState !== "running") {
                        throw new Error(`Docker start returned but the verified state is ${verifiedState}.`);
                     }
                     console.log(`[Self-Heal] Successfully restarted and verified container "${containerName}" for instance ${instance.id}.`);
                     physical_status = "running";
                     await dbAdapter.updateInstanceRecord(instance.id, {
                        status: "gateway_starting",
                        health_status: "checking",
                        error_code: null,
                        error_message: null,
                        deployment_error: null,
                     });
                     instance.status = "gateway_starting";
                  } catch (restartErr: any) {
                     console.error(`[Self-Heal] Failed to restart container "${containerName}" (Attempt ${nextAttempts}/3):`, restartErr.message);
                     physical_error = `Physical container is ${physical_status} but should be running. Auto-restart attempt ${nextAttempts}/3 failed: ${restartErr.message}`;
                     await persistAutoHealState(instance, nextAttempts, restartErr.message);
                  }
               } else {
                  physical_error = `Physical container is ${physical_status} but should be running. Auto-healing suspended after 3 failed attempts to avoid crash loop.`;
               }
            } else if (physical_status === 'running') {
               // Reset when running status is recovered or remains stable
               if (autoHealAttempts.has(instance.id)) {
                  autoHealAttempts.delete(instance.id);
               }
               if (getPersistedAutoHealAttempts(instance) > 0) {
                  await persistAutoHealState(instance, 0);
               }

               // Scan container logs for unauthorized access events across supported channels
               try {
                  const { getContainerLogTail, probeGatewayReadiness } = await import("./healthCheck");
                  const { scanLogsForAuthEvents } = await import("./utils/logParser");
                  const logs = await getContainerLogTail(containerName, 100);
                    if (logs) {
                      // Run background gateway status check & metadata sync
                      let enabledChannels: string[] = [];
                      let currentAllowMode = "";
                      try {
                        const configObj = typeof instance.config_json === "string"
                          ? JSON.parse(instance.config_json || "{}")
                          : (instance.config_json || {});
                        currentAllowMode = configObj.allowMode || "";
                        if (Array.isArray(configObj.channel)) {
                          enabledChannels = configObj.channel.map((c: string) => c.toLowerCase());
                        } else if (typeof configObj.channel === 'string') {
                          enabledChannels = [configObj.channel.toLowerCase()];
                        }
                      } catch (e) {}

                      if (currentAllowMode !== "disabled") {
                        const newAuthEvents = await scanLogsForAuthEvents(instance.id, logs);
                        if (newAuthEvents.length > 0 && options.io) {
                          const ownerId = instance.user_id || instance.owner_id;
                          const payload = { instanceId: instance.id };
                          if (ownerId) {
                            options.io.to(`channel-auth:user:${ownerId}`).emit("channel_auth_events_changed", payload);
                          }
                          options.io.to("channel-auth:admins").emit("channel_auth_events_changed", payload);
                        }
                      }

                      const containerObj = docker.getContainer(containerName);
                    const probeRes = await probeGatewayReadiness(containerObj, instance.id, logs, enabledChannels);

                    // Merge and persist to DB
                    const currentInstance = await dbAdapter.getInstanceById(instance.id).catch(() => null);
                    if (currentInstance) {
                      const existingMetadata = currentInstance.metadata || {};
                      const updatedMetadata = {
                        ...existingMetadata,
                        gateway_status: probeRes.gateway_status,
                        gateway_ready: probeRes.gateway_ready,
                        gateway_checked_at: probeRes.checked_at,
                        gateway_error: probeRes.gateway_error,
                        gateway_services: probeRes.gateway_services,
                        configured_channels: probeRes.configured_channels,
                        connected_channels: probeRes.connected_channels,
                        channel_status: probeRes.channel_status
                      };

                      const isStuckStatus = (
                        currentInstance.status === "gateway_starting" || 
                        currentInstance.status === "container_starting" || 
                        currentInstance.status === "dashboard_ready" ||
                        currentInstance.status === "stopped" ||
                        currentInstance.status === "degraded" ||
                        currentInstance.status === "partial_running"
                      );

                      const { checkTraefikRoute, checkHostHeaderProxy } = await import("./healthCheck");
                      let proxyReady = false;
                      const { isTraefik: isTraefikMode } = parseTraefikEnv(process.env);
                      const subdomainVal = currentInstance.subdomain || "";
                      if (isTraefikMode) {
                        proxyReady = await checkTraefikRoute(subdomainVal).catch(() => false);
                      } else {
                        proxyReady = await checkHostHeaderProxy(subdomainVal).catch(() => false);
                      }

                      const shouldPromoteToRunning = isStuckStatus && probeRes.gateway_ready === true && proxyReady;
                      const statusUpdate = shouldPromoteToRunning ? { 
                        status: "running", 
                        deployment_error: null,
                        stop_reason: null,
                        last_error: null
                      } : {};

                      await dbAdapter.updateInstanceVersionInfo(instance.id, {
                        metadata: updatedMetadata,
                        health_status: probeRes.gateway_ready ? "healthy" : "unhealthy",
                        last_health_check_at: probeRes.checked_at,
                        ready_at: probeRes.gateway_ready ? (currentInstance.ready_at || probeRes.checked_at) : (currentInstance.ready_at || null),
                        error_message: probeRes.gateway_error || null,
                        ...statusUpdate
                      }).catch(() => {});
                    }
                  }
               } catch (logErr: any) {
                  console.error(`[Reconciler Log/Gateway Scan Error] Failed to scan logs/gateway of instance ${instance.id}:`, logErr.message);
               }

               // Subtask 3: Traefik & isolated network bridge self-healing
               if (isTraefik) {
                  const networkName = `mybay-net-${instance.id}`;
                  if (!traefikNetworks.includes(networkName)) {
                     console.log(`[Reconciler Traefik Self-Heal] Traefik is NOT connected to network "${networkName}" for running instance ${instance.id}. Re-bridging...`);
                     try {
                        const nets = await docker.listNetworks();
                        const netExists = nets.some(n => n.Name === networkName);
                        if (netExists) {
                           const { connectTraefikToNetwork } = require("./dockerDeployment");
                           await connectTraefikToNetwork(networkName);
                           console.log(`[Reconciler Traefik Self-Heal] Successfully re-connected Traefik to "${networkName}"`);
                        } else {
                           console.warn(`[Reconciler Traefik Self-Heal Warning] Network "${networkName}" does not exist for running instance ${instance.id}.`);
                        }
                     } catch (netErr: any) {
                        console.error(`[Reconciler Traefik Self-Heal Error] Failed to self-heal Traefik connection to network "${networkName}":`, netErr.message);
                     }
                  }
               }
            }
         } else {
            if (expectsContainerToRun(instance)) {
               physical_error = "Container missing from Docker engine.";
               await dbAdapter.updateInstanceRecord(instance.id, {
                  status: "degraded",
                  health_status: "unhealthy",
                  error_code: "CONTAINER_MISSING",
                  error_message: physical_error,
                  deployment_error: physical_error,
               });
            } else if (instance.status !== "stopped" && instance.status !== "deploying") {
               physical_error = "Container missing from Docker engine.";
            }
         }

         // Update DB with reality
         await dbAdapter.updateInstancePhysicalState(instance.id, {
            physical_status,
            physical_error,
            last_reconciled_at: new Date().toISOString()
         });
        } catch (instanceErr: any) {
          console.error(`[Reconciler] Failed to reconcile instance ${instance.id}:`, instanceErr?.message || instanceErr);
        }
      }
    } catch (err: any) {
      console.error("[Reconciler] Reconciliation cycle failed:", err.message);
    } finally {
      reconcileCycleActive = false;
    }
  };

  reconcilerTimer = setInterval(() => { void reconcile(); }, intervalMs);
  reconcilerTimer.unref?.();
  void reconcile();
}

export function stopReconciler() {
  if (reconcilerTimer) clearInterval(reconcilerTimer);
  reconcilerTimer = null;
}

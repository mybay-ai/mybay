import { Router, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { checkPortInUse, isPortTaken, findAvailablePort } from "../utils";
import Docker from "dockerode";
import os from "os";
import crypto from "crypto";
import { providerRegistry } from "../../shared/providerRegistry";
import { ErrorCodes } from "../../shared/errorCodes";
import { resolveProviderRegistryKey } from "../../shared/providerRegistryUtils";
import { dbAdapter } from "../db";
import { templatesRepo } from "../repositories/templatesRepo";
import { authenticateToken, requireAdmin, AuthenticatedRequest } from "../middlewares/auth";
import { auditLogsRepo } from "../repositories/auditLogsRepo";
import { getClientIp } from "../utils/ip";
import { parseTraefikEnv } from "../infrastructure/traefik/traefikConfig";
import { getDeploymentModeConfig, saveDeploymentModeConfig } from "../services/deploymentMode";
import { sanitizeErrorMessage } from "../utils/sanitizer";
import { applySavedProviderCredential, resolveStoredCredentialApiKey, SavedProviderCredentialError } from "../utils/savedProviderCredential";
import { DEFAULT_INSTANCE_DISK_MB, DEFAULT_MAX_SINGLE_INSTANCE_DISK_MB, DEFAULT_USER_DISK_LIMIT_MB, ALLOWED_DISK_LIMITS } from "../constants/resourceLimits";
import { isAdvancedResourceConfigEnabled } from "../utils/advancedResourceConfigFeature";
import { readStore } from "../localStore";
import { buildDeploymentJourney } from "../services/deploymentJourneyService";
import { formatSystemRequestError as formatError, isSafeUrl } from "../services/system/systemNetworkPolicy";
import { createDeploymentModeRoutes } from "./system/deploymentMode.routes";
import { createSystemSettingsRoutes } from "./system/settings.routes";
import systemDiagnosticsRouter from "./systemDiagnostics.routes";

export { resolveStoredCredentialApiKey };

const router = Router();
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });
export async function loadLocalDatabaseOverviewData() {
  let instancesError = false;
  let usersError = false;

  const instancesPromise = dbAdapter.getAllInstances().catch((error: any) => {
    instancesError = true;
    console.error("[SystemHealth] Local instances query failed.", {
      name: error?.name || "Error",
      code: error?.code || "LOCAL_QUERY_FAILED"
    });
    return [];
  });
  const usersPromise = dbAdapter.getAdminUsersList({ page: 1, pageSize: 10000 })
    .then((result: any) => result.users || [])
    .catch((error: any) => {
      usersError = true;
      console.error("[SystemHealth] Local users query failed.", {
        name: error?.name || "Error",
        code: error?.code || "LOCAL_QUERY_FAILED"
      });
      return [];
    });

  const [allInstances, usersList] = await Promise.all([instancesPromise, usersPromise]);
  const status: "healthy" | "degraded" | "critical" =
    instancesError && usersError ? "critical" :
    instancesError || usersError ? "degraded" : "healthy";
  const details =
    status === "critical" ? "本地数据库访问失败" :
    status === "degraded" ? "部分本地数据查询异常" : "本地数据库正常";

  return {
    allInstances,
    usersList,
    instancesError,
    usersError,
    databaseHealth: { status, details }
  };
}


// /api/system/stats - Admin only
router.get("/stats", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user.role !== 'admin') {
    // Audit unauthorized access attempt
    auditLogsRepo.create({
      instance_id: "system",
      action: "unauthorized_system_stats_access",
      user_id: req.user.id,
      timestamp: new Date().toISOString(),
      details: `Unauthorized access attempt to /api/system/stats from ip=${getClientIp(req)} user_agent=${req.headers['user-agent']}`,
      actor_type: "user"
    }).catch(() => null);

    return res.status(403).json({ error: "Access denied: Admin privileges required" });
  }

  res.setHeader("Cache-Control", "no-store");
  try {
    const stats = await dbAdapter.getOverviewStats(req.user.id, req.user.role);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/admin/overview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const { isQuotaConsumingStatus, resolveInstanceLimit } = require("../utils/quota");
    const { sanitizeAdminErrorSummary } = require("../utils/sanitizer");
    
    const statsPromise = dbAdapter.getOverviewStats(req.user.id, req.user.role).catch(() => ({ cpuUsage: 0, memUsed: 0, memTotal: 0, diskUsed: 0, diskTotal: 0 }));
    const localDatabasePromise = loadLocalDatabaseOverviewData();
    const auditLogsPromise = dbAdapter.listAuditLogs().then((logs: any[]) => logs.slice(0, 10)).catch(() => []);

    const [stats, localDatabase, recentAuditLogs] = await Promise.all([
      statsPromise,
      localDatabasePromise,
      auditLogsPromise
    ]);
    const { allInstances, usersList, instancesError, usersError, databaseHealth } = localDatabase;
    
    // 1. instances
    const total = instancesError ? null : allInstances.length;
    const running = instancesError ? null : allInstances.filter((i: any) => i.status === 'running' || i.status === 'partial_running').length;
    const stopped = instancesError ? null : allInstances.filter((i: any) => i.status === 'stopped' || i.status === 'archived').length;
    const starting = instancesError ? null : allInstances.filter((i: any) => i.status === 'starting').length;
    const errorCount = instancesError ? null : allInstances.filter((i: any) => i.status === 'error' || i.status === 'failed').length;
    
    const maxAllowed = null;
    const remaining = null;

    // 2. system resources
    const cpuPercent = stats.cpuUsage;
    const memoryUsedMb = stats.memUsed / (1024 * 1024);
    const memoryTotalMb = stats.memTotal / (1024 * 1024);
    const memoryPercent = stats.memTotal > 0 ? (stats.memUsed / stats.memTotal) * 100 : 0;
    
    const diskUsedGb = stats.diskUsed / (1024 * 1024 * 1024);
    const diskTotalGb = stats.diskTotal / (1024 * 1024 * 1024);
    const diskPercent = stats.diskTotal > 0 ? (stats.diskUsed / stats.diskTotal) * 100 : 0;
    
    const loadAverage = os.loadavg();

    // 3. docker stats
    let containersTotal = 0, containersRunning = 0, containersExited = 0;
    let dockerApiStatus = 'critical';
    let dockerErrorMsg = '容器守护进程未联通';
    let containers: any[] = [];
    try {
      containers = await docker.listContainers({ all: true });
      containersTotal = containers.length;
      containersRunning = containers.filter(c => c.State === 'running').length;
      containersExited = containers.filter(c => c.State === 'exited' || c.State === 'dead').length;
      dockerApiStatus = containersRunning > 0 ? 'healthy' : 'warning';
      dockerErrorMsg = `${containersRunning} 运行中 / 共 ${containersTotal} 个`;
    } catch (e) {
      // Fallback already defaults to critical/unreachable
    }

    // 4. users & quota
    const usersTotal = usersError ? null : usersList.length;
    const usersActive = usersError ? null : usersList.filter(u => u.status === 'active' || !u.status).length;
    const usersDisabled = usersError ? null : usersList.filter(u => u.status === 'disabled').length;
    const usersAdmins = usersError ? null : usersList.filter(u => u.role === 'admin').length;

    let usersAtQuota: number | null = usersError ? null : 0;
    const userInstanceCount: Record<string, number> = {};
    for (const inst of allInstances) {
      if (isQuotaConsumingStatus(inst.status) && !inst.archived) {
        userInstanceCount[inst.user_id] = (userInstanceCount[inst.user_id] || 0) + 1;
      }
    }

    if (!usersError) {
      for (const u of usersList) {
        const limit = resolveInstanceLimit(u);
        if (limit !== null && limit !== -1 && (userInstanceCount[u.id] || 0) >= limit) {
          usersAtQuota!++;
        }
      }
    }

    const topUsers = usersError ? [] : usersList.map(u => {
      const limit = resolveInstanceLimit(u);
      return {
        id: u.id,
        username: u.username || u.id.substring(0, 8), // removed email
        usedInstances: userInstanceCount[u.id] || 0,
        instanceLimit: limit,
        isUnlimited: limit === null,
        status: u.status || 'active'
      };
    }).sort((a, b) => b.usedInstances - a.usedInstances).slice(0, 5);

    // 5. Recent Activity (Audit logs) DTO
    const recentActivity = (recentAuditLogs || []).map((log: any) => {
      let resultStr = 'OK';
      if (log.details && typeof log.details === 'string') {
        const lowerDetails = log.details.toLowerCase();
        if (lowerDetails.includes('error') || lowerDetails.includes('fail')) {
          resultStr = 'Executed With Error';
        } else if (!lowerDetails.includes('success') && !lowerDetails.includes('ok')) {
           resultStr = 'Executed';
        }
      }
      return {
        id: log.id,
        timestamp: log.timestamp,
        actor: log.user_id ? 'User' : 'System',
        target: log.instance_id || 'System',
        action: log.action,
        result: resultStr
      };
    });

    // 6. Services check
    const checkedAt = new Date().toISOString();
    const dbStatus = databaseHealth.status;
    const dbDetails = databaseHealth.details;

    // Traefik check
    const tEnv = parseTraefikEnv(process.env);
    let traefikStatus: 'healthy' | 'warning' | 'critical' | 'unknown' = 'unknown';
    let traefikDetails = '未检测';

    if (!tEnv.isTraefik) {
      traefikStatus = 'unknown';
      traefikDetails = '未启用 (采用 Nginx 代理模式)';
    } else {
      const traefikContainer = (containers || []).find(c => 
        (c.Names || []).some(n => n === `/${tEnv.traefikContainerName}` || n.includes(`_${tEnv.traefikContainerName}`))
      );
      if (traefikContainer) {
        if (traefikContainer.State === 'running') {
          traefikStatus = 'healthy';
          traefikDetails = '运行中 (容器在线)';
        } else {
          traefikStatus = 'critical';
          traefikDetails = `未运行 (容器状态: ${traefikContainer.State})`;
        }
      } else {
        traefikStatus = 'critical';
        traefikDetails = '未部署 (找不到 Traefik 容器)';
      }
    }

    // Scheduler check
    let schedulerStatus: 'healthy' | 'warning' | 'critical' | 'unknown' = 'unknown';
    let schedulerDetails = '未启用';
    if (process.env.SCHEDULER_RUNNER_ENABLED === 'true') {
      schedulerStatus = 'healthy';
      schedulerDetails = '运行中';
    } else {
      schedulerStatus = 'unknown';
      schedulerDetails = '未配置 / 未启用';
    }

    const services = [
      { name: '后端数据库服务', status: dbStatus, details: dbDetails, checkedAt },
      { name: 'Agent容器引擎', status: dockerApiStatus, details: dockerErrorMsg, checkedAt },
      { name: '网关代理服务', status: traefikStatus, details: traefikDetails, checkedAt },
      { name: '任务调度服务', status: schedulerStatus, details: schedulerDetails, checkedAt }
    ];

    // Build Health Level
    let healthLevel: 'healthy' | 'warning' | 'critical' = 'healthy';
    let message = '当前宿主机资源充足，可继续部署新 Agent 实例。';
    const issues: Array<{ type: string, severity: 'info' | 'warning' | 'critical', message: string }> = [];

    // Different thresholds
    const cpuWarning = 60, cpuCritical = 80;
    const memWarning = 70, memCritical = 85;
    const diskWarning = 75, diskCritical = 90;

    if (diskPercent > diskCritical) {
      healthLevel = 'critical';
      issues.push({ type: 'disk', severity: 'critical', message: '磁盘占用极其严重，请立即清理日志和无用缓存！' });
    } else if (diskPercent > diskWarning) {
      if ((healthLevel as any) !== 'critical') healthLevel = 'warning';
      issues.push({ type: 'disk', severity: 'warning', message: '磁盘占用较高，建议清理日志和 Docker 缓存。' });
    }

    if (memoryPercent > memCritical) {
      healthLevel = 'critical';
      issues.push({ type: 'memory', severity: 'critical', message: '内存占用极高，可能导致 OOM。' });
    } else if (memoryPercent > memWarning) {
      if ((healthLevel as any) !== 'critical') healthLevel = 'warning';
      issues.push({ type: 'memory', severity: 'warning', message: '内存占用偏高，请关注应用内存泄漏情况。' });
    }

    if (cpuPercent > cpuCritical) {
      healthLevel = 'critical';
      issues.push({ type: 'cpu', severity: 'critical', message: 'CPU 负载极高，可能影响并发响应速度。' });
    } else if (cpuPercent > cpuWarning) {
      if ((healthLevel as any) !== 'critical') healthLevel = 'warning';
      issues.push({ type: 'cpu', severity: 'warning', message: 'CPU 负载偏高，请留意。' });
    }

    if (errorCount && errorCount > 0) {
      if ((healthLevel as any) !== 'critical') healthLevel = 'warning';
      issues.push({ type: 'instance', severity: 'warning', message: `存在 ${errorCount} 个异常运行/退出的实例需要检查。` });
    }

    if (containersExited > 0) {
      issues.push({ type: 'docker', severity: 'info', message: `发现 ${containersExited} 个处于退出状态的容器残余。` });
    }

    if (healthLevel === 'critical') {
      message = '系统资源临近枯竭或有严重异常，请立即处理！';
    } else if (healthLevel === 'warning') {
      message = '部分资源偏高或存在轻微异常，请排查。';
    }

    const abnormalList = allInstances
      .filter((i: any) => i.status === 'error' || i.status === 'failed')
      .slice(0, 5)
      .map((i: any) => {
         let rawError = i.deployment_error;
         let errorCode = 'UNKNOWN_RUNTIME_ERROR';
         if (rawError && typeof rawError === 'string') {
            if (rawError.includes('container start') || rawError.includes('Docker')) errorCode = 'CONTAINER_START_FAILED';
            else if (rawError.includes('memory') || rawError.includes('OOM')) errorCode = 'RESOURCE_LIMIT_EXCEEDED';
         }
         return {
            id: i.id,
            name: i.name,
            ownerId: i.user_id,
            status: i.status,
            physicalStatus: i.physical_status,
            errorCode,
            errorSummary: sanitizeAdminErrorSummary(rawError),
            createdAt: i.created_at,
            updatedAt: i.updated_at
         };
      });

    res.json({
      users: {
        total: usersTotal,
        active: usersActive,
        disabled: usersDisabled,
        admins: usersAdmins,
        atQuota: usersAtQuota,
        topUsers,
        available: !usersError,
        errorCode: usersError ? 'USERS_QUERY_FAILED' : null
      },
      instances: {
        total,
        running,
        starting,
        stopped,
        error: errorCount,
        maxAllowed,
        remaining,
        abnormalList,
        available: !instancesError,
        errorCode: instancesError ? 'INSTANCES_QUERY_FAILED' : null
      },
      system: {
        cpuPercent,
        memoryUsedMb,
        memoryTotalMb,
        memoryPercent,
        diskUsedGb,
        diskTotalGb,
        diskPercent,
        loadAverage
      },
      docker: {
        containersTotal,
        containersRunning,
        containersExited
      },
      health: {
        level: healthLevel,
        message,
        issues
      },
      services,
      alerts: {
        total: issues.length,
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length
      },
      recentActivity
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch admin overview" });
  }
});

router.get("/port-check", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const portQuery = req.query.port ? parseInt(req.query.port as string, 10) : null;
    if (!portQuery || isNaN(portQuery)) {
      return res.status(400).json({ error: "端口号无效" });
    }

    const inUse = await isPortTaken(portQuery, docker);
    
    // Find recommended idle ports starting from MY_BAY_PORT_START
    const portStart = Number(process.env.MY_BAY_PORT_START || 10100);
    const portEnd = Number(process.env.MY_BAY_PORT_END || 19999);
    const recommendedPorts: number[] = [];
    let candidate = portStart;
    while (recommendedPorts.length < 5 && candidate <= portEnd) {
      if (candidate !== portQuery) {
        const isBusy = await isPortTaken(candidate, docker);
        if (!isBusy) {
          recommendedPorts.push(candidate);
        }
      }
      candidate++;
    }

    // Optional audit for system scan, though it's relatively low risk for authenticated users
    if (inUse) {
      auditLogsRepo.create({
        instance_id: "system",
        action: "port_conflict_detected",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: `User detected port conflict on port ${portQuery}`,
        actor_type: "user"
      }).catch(() => null);
    }

    res.json({
      port: portQuery,
      inUse,
      recommended: recommendedPorts,
      message: inUse 
        ? `端口 ${portQuery} 冲突已被占用，建议使用推荐的空闲端口。`
        : `端口 ${portQuery} 空闲可用，无冲突风险。`
    });
  } catch (err: any) {
    console.error("[System API] Network ping error:", err);
    res.status(500).json({ error: "接口检测失败，服务器异常" });
  }
});

router.use(createDeploymentModeRoutes());
router.get("/preflight", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user.role !== 'admin') {
    // Audit unauthorized access attempt
    auditLogsRepo.create({
     instance_id: "system",
     action: "unauthorized_system_preflight_access",
     user_id: req.user.id,
     timestamp: new Date().toISOString(),
     details: `Unauthorized access attempt to /api/system/preflight from ip=${getClientIp(req)} user_agent=${req.headers['user-agent']}`,
     actor_type: "user"
   }).catch(() => null);

   return res.status(403).json({ error: "Access denied: Admin privileges required" });
  }

  res.setHeader("Cache-Control", "no-store");
  const { proxyMode, traefikNetwork } = parseTraefikEnv(process.env);
  const deploymentMode = await getDeploymentModeConfig();
  const isVerbose = process.env.SYSTEM_DIAGNOSTICS_VERBOSE === "true";
  
  const result: any = { 
    status: "ok", 
    checks: [],
    proxyMode,
    deploymentMode: deploymentMode.mode,
    deploymentModeValid: deploymentMode.valid,
    deploymentModeIssues: deploymentMode.issues,
  };

  const addCheck = (key: string, status: 'ok' | 'warn' | 'fail', publicMsg: string, internalDetails?: any) => {
    const check: any = { key, status, name: key };
    
    // Strict desensitization: hide paths and internal detail keys unless verbose and admin
    // Even for admins, we avoid leaking raw error strings if not in verbose mode
    if (isVerbose) {
      check.message = publicMsg;
      if (internalDetails) check.details = internalDetails;
    } else {
      // In non-verbose mode, we provide highly sanitized generic messages
      if (key === "runtime") check.message = status === "ok" ? "Docker Socket Accessible" : "Docker Socket Not Accessible";
      else if (key === "connectivity") check.message = status === "ok" ? "Domain configuration validated" : "Domain configuration missing";
      else if (key === "encryption") check.message = status === "ok" ? "Security keys present" : "Security keys missing";
      else if (key === "proxy") check.message = status === "ok" ? "Gateway network established" : "Gateway network missing";
      else if (key === "network") check.message = status === "ok" ? "Port pool available" : "Port pool exhausted";
      else if (key === "internal_routing") check.message = status === "ok" ? "Routing secret present" : "Routing secret missing";
      else check.message = status === "ok" ? "System check passed" : "System check failed";
    }

    result.checks.push(check);
    if (status === 'fail') result.status = 'error';
  };

  try {
    // 1. Runtime / Docker
    try {
      await docker.ping();
      addCheck("runtime", "ok", "Docker Engine is reachable.");
    } catch (e: any) {
      addCheck("runtime", "fail", "Cannot reach Docker Engine.");
      console.error("[Preflight Audit] Docker unreachable:", e.message);
    }

    // 2. Resources
    const freeMem = os.freemem();
    if (freeMem < 512 * 1024 * 1024) {
      addCheck("storage", "warn", "System available memory is low.");
    } else {
      addCheck("storage", "ok", "System memory within safe bounds.");
    }

    // 3. Proxy. Server mode requires Traefik; desktop/LAN use direct host-port access.
    if (deploymentMode.mode === "server") {
      if (proxyMode !== "traefik") {
        addCheck("proxy", "fail", "Server mode requires Traefik.");
      } else {
        try {
          await docker.getNetwork(traefikNetwork).inspect();
          addCheck("proxy", "ok", "Gateway network established.");
        } catch (e) {
          addCheck("proxy", "fail", "Gateway network missing.");
        }
      }
    } else {
      addCheck("proxy", "ok", "Direct access mode active.");
    }

    // 4. Ports
    try {
      await findAvailablePort(docker);
      addCheck("network", "ok", "Port pool has availability.");
    } catch (e) {
      addCheck("network", "fail", "Port pool exhausted.");
    }

    // 5. Access config / Encryption
    if (deploymentMode.mode === "desktop") {
      addCheck("connectivity", "ok", "Desktop loopback access configured.");
    } else if (deploymentMode.mode === "lan") {
      addCheck("connectivity", deploymentMode.issues.includes("LAN_IP_INVALID") ? "fail" : "ok", "LAN bind address validated.");
    } else {
      const serverAccessInvalid = deploymentMode.serverIssues.some((issue: string) => issue !== "SERVER_TRAEFIK_REQUIRED");
      addCheck("connectivity", serverAccessInvalid ? "fail" : "ok", "External domain and HTTPS identity configured.");
    }

    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 32) {
      addCheck("encryption", "ok", "Security keys derived.");
    } else {
      addCheck("encryption", "warn", "Security keys suboptimal.");
    }

    if (process.env.MYBAY_INTERNAL_ROUTING_SECRET) {
      addCheck("internal_routing", "ok", "Internal routing secret present.");
    } else {
      addCheck("internal_routing", "fail", "MYBAY_INTERNAL_ROUTING_SECRET missing. Deployments will fail securely.");
    }

  } catch (err: any) {
    console.error("[Preflight Error]:", err);
    result.status = "error";
  }
  res.json(result);
});

router.use(systemDiagnosticsRouter);

// Admin endpoint: List all users so we can configure resource policies easily
router.get("/admin/users", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Access denied: Admin only" });
  }
  try {
    const result = await dbAdapter.getAdminUsersList({ page: 1, pageSize: 10000 });
    res.json(result.users || []);
  } catch (err: any) {
    console.error("[System API] Get users error:", err);
    res.status(500).json({ error: "获取用户列表失败，服务器内部异常" });
  }
});

// Admin endpoint: List all user resource policy definitions
router.get("/admin/resource-policies", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isAdvancedResourceConfigEnabled()) return res.status(404).json({ error: "Advanced resource configuration is disabled" });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Access denied: Admin only" });
  }
  try {
    const policies = await dbAdapter.listAllUserResourcePolicies();
    res.json(policies);
  } catch (err: any) {
    console.error("[System API] Get resource policies error:", err);
    res.status(500).json({ error: "获取资源策略失败，服务器内部异常" });
  }
});

// Admin endpoint: Set/upsert a user's resource policy
router.post("/admin/resource-policies", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isAdvancedResourceConfigEnabled()) return res.status(404).json({ error: "Advanced resource configuration is disabled" });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Access denied: Admin only" });
  }

  const {
    user_id,
    default_cpu_limit,
    default_memory_limit_mb,
    max_cpu_limit,
    max_memory_limit_mb,
    resource_plan,
    disk_limit_mb,
    default_instance_disk_mb,
    max_single_instance_disk_mb
  } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: "Missing required parameter: user_id" });
  }

  const normalizeDiskField = (fieldName: string, value: any, allowUnlimited: boolean): number | null | undefined => {
    if (value === undefined) return undefined;
    if (allowUnlimited && (value === "unlimited" || value === null || value === "null")) return null;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${fieldName} must be a valid number${allowUnlimited ? " or unlimited/null" : ""}.`);
    }

    const allowedValues = ALLOWED_DISK_LIMITS.filter((x): x is number => x !== null);
    if (!allowedValues.includes(parsed)) {
      throw new Error(`${fieldName} must be one of ${allowedValues.join(', ')} MB${allowUnlimited ? " or unlimited/null" : ""}.`);
    }

    return parsed;
  };

  let normalizedDiskLimitMb: number | null | undefined;
  let normalizedDefaultInstanceDiskMb: number | undefined;
  let normalizedMaxSingleInstanceDiskMb: number | null | undefined;

  try {
    normalizedDiskLimitMb = normalizeDiskField("disk_limit_mb", disk_limit_mb, true);
    normalizedDefaultInstanceDiskMb = normalizeDiskField("default_instance_disk_mb", default_instance_disk_mb, false) as number | undefined;
    normalizedMaxSingleInstanceDiskMb = normalizeDiskField("max_single_instance_disk_mb", max_single_instance_disk_mb, true);

    if (
      normalizedDefaultInstanceDiskMb !== undefined &&
      normalizedMaxSingleInstanceDiskMb !== undefined &&
      normalizedMaxSingleInstanceDiskMb !== null &&
      normalizedDefaultInstanceDiskMb > normalizedMaxSingleInstanceDiskMb
    ) {
      return res.status(400).json({ error: "Default per-instance disk quota cannot exceed the max per-instance disk quota." });
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Invalid disk quota configuration." });
  }

  try {
    const policy = await dbAdapter.upsertUserResourcePolicy({
      user_id,
      default_cpu_limit: default_cpu_limit !== undefined ? Number(default_cpu_limit) : undefined,
      default_memory_limit_mb: default_memory_limit_mb !== undefined ? Number(default_memory_limit_mb) : undefined,
      max_cpu_limit: max_cpu_limit !== undefined ? Number(max_cpu_limit) : undefined,
      max_memory_limit_mb: max_memory_limit_mb !== undefined ? Number(max_memory_limit_mb) : undefined,
      resource_plan,
      disk_limit_mb: normalizedDiskLimitMb,
      default_instance_disk_mb: normalizedDefaultInstanceDiskMb,
      max_single_instance_disk_mb: normalizedMaxSingleInstanceDiskMb,
      updated_by: req.user.username
    });

    res.json({ success: true, policy });
  } catch (err: any) {
    console.error("[System API] Upsert resource policy error:", err);
    res.status(500).json({ error: "Failed to update resource policy." });
  }
});

// Admin endpoint: Clear and apply resource policy properties to all existing instances of a target user at once
router.post("/admin/resource-policies/apply-to-instances", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isAdvancedResourceConfigEnabled()) return res.status(404).json({ error: "Advanced resource configuration is disabled" });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Access denied: Admin only" });
  }

  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: "Missing required parameter: user_id" });
  }

  try {
    const policy = await dbAdapter.getUserResourcePolicy(user_id);
    if (!policy) {
      return res.status(404).json({ error: "No resource policy found for this user." });
    }

    const allInstances = await dbAdapter.getAllInstances();
    const userInstances = allInstances.filter((inst: any) => inst.user_id === user_id);

    let updatedCount = 0;
    for (const inst of userInstances) {
      let config: any = {};
      try {
        config = JSON.parse(inst.config_json || "{}");
      } catch {
        config = {};
      }

      config.limitsCpu = String(policy.default_cpu_limit);
      config.limitsMem = `${policy.default_memory_limit_mb}MB`;
      config.diskLimitMode = "inherit";
      delete config.limitsDiskMb;

      await dbAdapter.updateInstanceConfig(inst.id, JSON.stringify(config));

      const versionInfoUpdate: any = {
        limitsCpu: parseFloat(String(policy.default_cpu_limit)),
        limitsMemory: `${policy.default_memory_limit_mb}MB`,
        limitsMemoryMb: policy.default_memory_limit_mb,
        limitsDisk: policy.default_instance_disk_mb !== undefined && policy.default_instance_disk_mb !== null ? `${policy.default_instance_disk_mb}MB` : `${DEFAULT_INSTANCE_DISK_MB}MB`
      };
      await dbAdapter.updateInstanceVersionInfo(inst.id, versionInfoUpdate);

      const diskLabel = policy.disk_limit_mb === null
        ? "shared pool unlimited"
        : `shared pool ${policy.disk_limit_mb}MB / default per-instance ${policy.default_instance_disk_mb ?? DEFAULT_INSTANCE_DISK_MB}MB / max per-instance ${policy.max_single_instance_disk_mb === null ? "unlimited" : `${policy.max_single_instance_disk_mb ?? DEFAULT_MAX_SINGLE_INSTANCE_DISK_MB}MB`}`;

      await dbAdapter.insertAuditLog({
        instance_id: inst.id,
        action: "apply_policy_limits",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: `Admin applied resource policy to existing instance (${policy.default_cpu_limit} CPU / ${policy.default_memory_limit_mb}MB memory / disk ${diskLabel}, inherit mode).`
      });

      updatedCount++;
    }

    res.json({
      success: true,
      message: `Resource policy applied to ${updatedCount} existing instance records. Changes take effect after the next container restart or rebuild.`
    });
  } catch (err: any) {
    console.error("[System API] Apply policy error:", err);
    res.status(500).json({ error: "Failed to apply resource policy." });
  }
});

// Local-edition endpoint: expose the single host resource policy used by deployment.
router.get("/my-resource-policy", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isAdvancedResourceConfigEnabled()) return res.status(404).json({ error: "Advanced resource configuration is disabled" });
  try {
    const { getLocalResourcePolicy } = await import("../services/localResourcePolicy");
    const policy = getLocalResourcePolicy();
    return res.json({
      user_id: req.user.id,
      default_cpu_limit: policy.defaultCpu,
      default_memory_limit_mb: policy.defaultMemoryMb,
      max_cpu_limit: policy.maxCpu,
      max_memory_limit_mb: policy.maxMemoryMb,
      resource_plan: "local-host-policy",
      disk_limit_mb: null,
      default_instance_disk_mb: policy.defaultDiskMb,
      max_single_instance_disk_mb: policy.defaultDiskMb
    });
  } catch (err: any) {
    console.error("[System API] Get local resource policy error:", err);
    return res.status(500).json({ code: "LOCAL_RESOURCE_POLICY_LOAD_FAILED" });
  }
});
// User endpoint: Query current user's aggregated dashboard summary (Usage summary, policy, credentials, recent tasks 24h, audit logs)
router.get("/my-dashboard-summary", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const isAdmin = role === 'admin' || role === 'super_admin';

    const { isQuotaConsumingStatus, resolveInstanceLimit } = require("../utils/quota");
    const { userResourcePoliciesRepo } = require("../repositories/userResourcePoliciesRepo");

    // 1. Fetch usage-summary data
    let usageSummaryObj: any = {
      plan: isAdmin ? "admin" : (role || "free"),
      instanceLimit: 1,
      instanceUsed: 0,
      runningInstances: 0,
      storageUsedMb: null,
      storageLimitMb: DEFAULT_USER_DISK_LIMIT_MB
    };

    let instances: any[] = [];
    try {
      instances = await dbAdapter.getInstances(userId, role);
      const activeInstances = instances.filter((row: any) => isQuotaConsumingStatus(row.status));
      const runningInstances = instances.filter((row: any) => row.status === 'running' || row.status === 'partial_running');
      const limit = resolveInstanceLimit(req.user);
      const isUnlimited = limit === null;
      
      let storageLimitMb: number | null = DEFAULT_USER_DISK_LIMIT_MB;
      if (isAdmin) {
        storageLimitMb = null;
      } else {
        const policy = await userResourcePoliciesRepo.getByUserId(userId).catch(() => null);
        if (policy) {
          if (policy.disk_limit_mb === undefined) {
            storageLimitMb = DEFAULT_USER_DISK_LIMIT_MB;
          } else if (policy.disk_limit_mb === null || String(policy.disk_limit_mb) === 'unlimited') {
            storageLimitMb = null;
          } else {
            const mb = parseInt(String(policy.disk_limit_mb), 10);
            storageLimitMb = isNaN(mb) ? DEFAULT_USER_DISK_LIMIT_MB : mb;
          }
        }
      }

      usageSummaryObj = {
        plan: isAdmin ? "admin" : (role || "free"),
        instanceLimit: isUnlimited ? null : limit,
        instanceUsed: activeInstances.length,
        runningInstances: runningInstances.length,
        storageUsedMb: null,
        storageLimitMb: storageLimitMb
      };
    } catch (e) {
      console.error("[Summary API] Query usage summary failed:", e);
    }

    // 2. Fetch resourcePolicy
    let responsePolicy: any = {
      user_id: userId,
      default_cpu_limit: Number(process.env.DEFAULT_INSTANCE_CPUS || 1),
      default_memory_limit_mb: Number(process.env.DEFAULT_INSTANCE_MEMORY_MB || 1024),
      max_cpu_limit: Number(process.env.MAX_INSTANCE_CPUS || 4),
      max_memory_limit_mb: Number(process.env.MAX_INSTANCE_MEMORY_MB || 4096),
      resource_plan: "local-host-policy",
      disk_limit_mb: isAdmin ? null : DEFAULT_USER_DISK_LIMIT_MB,
      default_instance_disk_mb: DEFAULT_INSTANCE_DISK_MB,
      max_single_instance_disk_mb: isAdmin ? null : DEFAULT_MAX_SINGLE_INSTANCE_DISK_MB
    };
    try {
      const policy = await dbAdapter.getUserResourcePolicy(userId).catch(() => null);
      if (policy) {
        responsePolicy = {
          ...policy,
          disk_limit_mb: isAdmin ? null : (policy.disk_limit_mb !== undefined && policy.disk_limit_mb !== null ? policy.disk_limit_mb : DEFAULT_USER_DISK_LIMIT_MB),
          default_instance_disk_mb: policy.default_instance_disk_mb ?? DEFAULT_INSTANCE_DISK_MB,
          max_single_instance_disk_mb: isAdmin ? null : (policy.max_single_instance_disk_mb !== undefined ? policy.max_single_instance_disk_mb : DEFAULT_MAX_SINGLE_INSTANCE_DISK_MB)
        };
      }
    } catch (e) {
      console.error("[Summary API] Query user resource policy failed:", e);
    }

    // 3. Fetch credentials count
    let credentialsCount = 0;
    try {
      const credentials = await dbAdapter.getCredentials(userId).catch(() => []);
      credentialsCount = credentials.length;
    } catch (e) {
      console.error("[Summary API] Query credentials failed:", e);
    }

    // 4. Fetch recentTasks24h
    let recentTasks24h = 0;
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const trackedActions = new Set(['create', 'start', 'stop', 'restart', 'redeploy', 'rebuild_proxy', 'manual_business_task', 'config_update']);
      recentTasks24h = (await dbAdapter.listAuditLogs()).filter((log: any) =>
        log.user_id === userId &&
        String(log.timestamp || '') >= oneDayAgo &&
        trackedActions.has(log.action)
      ).length;
    } catch (e) {
      console.error("[Summary API] Query recentTasks24h failed:", e);
    }

    // 5. Fetch combined audit logs for user (limit 5)
    let auditLogs: any[] = [];
    try {
      const instIds = new Set(instances.map((i: any) => i.id));
      const logs = (await dbAdapter.listAuditLogs()).filter((log: any) =>
        log.user_id === userId || (log.instance_id && instIds.has(log.instance_id))
      ).slice(0, 10);

      if (logs) {
        const instanceMap = new Map(instances.map((i: any) => [i.id, i.name]));
        auditLogs = logs.map((log: any) => ({
          id: log.id,
          action: log.action,
          timestamp: log.timestamp,
          details: log.details,
          instance_id: log.instance_id,
          instance_name: log.instance_id ? (instanceMap.get(log.instance_id) || "Unknown Instance") : null
        })).slice(0, 5);
      }
    } catch (e) {
      console.error("[Summary API] Query combined audit logs failed:", e);
    }

    // 6. Fetch recent outputs (max 5 from the first running instance, no deep recursion)
    let recentOutputs: any[] = [];
    try {
      const runningInst = instances.find((i: any) => i.status === 'running' || i.status === 'partial_running');
      if (runningInst) {
        const { isSensitiveFile, getMimeType, validateFileAccess } = require("../services/instances/instanceFileSecurityService");
        const fs = require("fs");
        const path = require("path");
        {
          // Local node file listing
          const validation = await validateFileAccess(req, runningInst.id, "/");
          if (validation && !("error" in validation)) {
            const { absolutePath } = validation;
            try {
              const dirents = await fs.promises.readdir(absolutePath, { withFileTypes: true });
              const filePromises = dirents
                .filter((d: any) => !isSensitiveFile(d.name))
                .map(async (d: any) => {
                  try {
                    const fPath = path.join(absolutePath, d.name);
                    const isSymlink = d.isSymbolicLink();
                    
                    let actualStats: any;
                    if (isSymlink) {
                      try {
                        actualStats = await fs.promises.stat(fPath);
                      } catch (e) {
                        actualStats = await fs.promises.lstat(fPath);
                      }
                    } else if (d.isDirectory()) {
                      return null;
                    } else {
                      actualStats = await fs.promises.stat(fPath);
                    }

                    if (actualStats.isDirectory()) {
                      return null;
                    }

                    return {
                      name: d.name,
                      path: "/" + d.name,
                      type: "file",
                      isSymlink,
                      mime: getMimeType(d.name),
                      size: actualStats.size,
                      updatedAt: actualStats.mtime.toISOString(),
                      instanceName: runningInst.name,
                      instanceId: runningInst.id
                    };
                  } catch (err) {
                    return null;
                  }
                });
              const resolvedFiles = await Promise.all(filePromises);
              recentOutputs = resolvedFiles.filter(Boolean).slice(0, 5);
            } catch (err) {
              console.error("[Summary API] Local directory read failed:", err);
            }
          }
        }
      }
    } catch (e) {
      console.error("[Summary API] Query recent outputs failed:", e);
    }

    // 7. Fetch recommended templates/blueprints (limit 2, light format)
    let recommendedWorkflows: any[] = [];
    let recommendedBlueprints: any[] = [];
    try {
      if (process.env.TEMPLATE_CENTER_ENABLED === "true") {
        const { blueprintsRepo } = require("../repositories/blueprintsRepo");
        const { redactSecretsDeep } = require("../utils/sanitizer");
        
        const activeWorkflows = await templatesRepo.listActive();
        const activeBlueprints = await blueprintsRepo.listActive();
        
        recommendedWorkflows = redactSecretsDeep(activeWorkflows || []).slice(0, 2);
        recommendedBlueprints = redactSecretsDeep(activeBlueprints || []).slice(0, 2);
      }
    } catch (e) {
      console.error("[Summary API] Query recommended templates failed:", e);
    }

    res.json({
      usageSummary: usageSummaryObj,
      resourcePolicy: responsePolicy,
      credentialsCount,
      recentTasks24h,
      auditLogs,
      recentOutputs,
      recommendedWorkflows,
      recommendedBlueprints
    });

  } catch (err: any) {
    console.error("[System API] Get my dashboard summary error:", err);
    res.status(500).json({ error: "获取工作台概览数据失败，服务器内部异常" });
  }
});

router.get("/deployment-journey", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const [instances, credentials] = await Promise.all([
      dbAdapter.getInstances(req.user.id, req.user.role),
      dbAdapter.getCredentials(req.user.id),
    ]);
    let environmentReady = true;
    let environmentReason = "LOCAL_RUNTIME_READY";
    try {
      await docker.ping();
      await findAvailablePort(docker);
      if (!process.env.MYBAY_INTERNAL_ROUTING_SECRET) {
        environmentReady = false;
        environmentReason = "INTERNAL_ROUTING_SECRET_MISSING";
      }
    } catch {
      environmentReady = false;
      environmentReason = "DOCKER_OR_PORT_POOL_UNAVAILABLE";
    }
    const store = readStore();
    return res.json(buildDeploymentJourney({ environmentReady, environmentReason, credentials, instances, chatMessages: store.chatMessages }));
  } catch (error) {
    console.error("[Deployment Journey] Failed to build status:", error);
    return res.status(500).json({ error: "DEPLOYMENT_JOURNEY_FAILED" });
  }
});

// User endpoint: Query current user's 24H task execution stats from audit logs
router.get("/my-overview-stats", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const trackedActions = new Set(['create', 'start', 'stop', 'restart', 'redeploy', 'rebuild_proxy', 'manual_business_task', 'config_update']);
    const count = (await dbAdapter.listAuditLogs()).filter((log: any) =>
      log.user_id === req.user.id &&
      String(log.timestamp || '') >= oneDayAgo &&
      trackedActions.has(log.action)
    ).length;

    res.json({
      recentTasks24h: count || 0
    });
  } catch (err: any) {
    console.error("[System API] Get my overview stats error:", err);
    res.status(500).json({ error: "获取今日任务统计失败，服务器内部异常" });
  }
});

router.use(createSystemSettingsRoutes());
export default router;

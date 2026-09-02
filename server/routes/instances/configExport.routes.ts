import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import os from "os";
import multer from "multer";
import { hasZipMagic } from "../../utils/uploadSecurity";
import AdmZip from "adm-zip";
import * as archiver from "archiver";
import { resolveArchiverFactory } from "../../utils/resolveArchiverFactory";
import { executeDeployment, buildDeploymentContext, rebuildProxyConfig } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { isAdvancedResourceConfigEnabled } from "../../utils/advancedResourceConfigFeature";
import { supportsFeishu } from "../../utils/hermesCapabilities";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { sanitizeChannelConfigForChannel } from "../../utils/channelConfigSanitizer";
import { assertCanExportBackup, assertCanUseChannel, getInstanceLimit, sendEntitlementError } from "../../services/entitlements";
import { RouterDependencies } from "./index";
import { parseImageRef, isSensitiveFile, getMimeType, validateFileAccess, upload } from "./helpers";
import { encrypt } from "../../crypto";
import { isMaskedSecretPlaceholder, redactSecretsDeep, sanitizeConfig, sanitizeErrorMessage } from "../../utils/sanitizer";
import bcrypt from "bcryptjs";
import { providerRegistry as registry } from "../../../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../../../shared/providerRegistryUtils";
import { checkSSRFSafe } from "../../utils/ssrfValidator";
import { skillPolicyRegistry } from "../../../shared/skillPolicyRegistry";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";
import { ensureEncryptedDashboardAuthSecret } from "../../utils/dashboardAuthSecret";
import { applySavedProviderCredential, SavedProviderCredentialError } from "../../utils/savedProviderCredential";
import { validateConfigArchiveEntries } from "../../utils/configArchiveSecurity";
import {
  isPrivilegedUser,
  parseInstanceConfigJson,
  resolveProviderCredentialSelection,
} from "../../services/instanceConfig/instanceConfigRoutePolicy";
import { createRuntimeConfigRoutes } from "./config/runtimeConfig.routes";
import { buildConfigArchiveSections } from "../../utils/configArchiveSections";

export function createConfigExportRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.get("/:id/export", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ error: "Not found" });

      const ownerId = instance.owner_id || instance.user_id;
      const isOwner = ownerId === req.user.id;
      const isPrivileged = isPrivilegedUser(req.user);
      if (!isOwner && !isPrivileged) {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }


      try {
        await assertCanExportBackup(req.user);
      } catch (entitlementErr: any) {
        if (sendEntitlementError(res, entitlementErr)) return;
        throw entitlementErr;
      }

      const config = parseInstanceConfigJson(instance.config_json);

      const redactedConfig = redactSecretsDeep(config);

      const exportData = {
        name: instance.name,
        path: instance.path,
        config: redactedConfig,
        exportedAt: new Date().toISOString(),
        platform: "MyBay (麦贝) Agent 控制台",
        securityNote: "API Keys and secrets are redacted for security. Please re-configure them after import."
      };

      await dbAdapter.insertAuditLog({
        instance_id: req.params.id,
        action: "export_config",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Exported instance configuration (redacted secrets)"
      });

      res.setHeader('Content-Disposition', `attachment; filename="agent-config-${instance.path || instance.id}.json"`);
      res.json(exportData);
    } catch (e: any) {
      console.error("[Config API] Export error:", e);
      res.status(500).json({ error: "应用导出失败，服务器内部异常" });
    }
  });

  router.get("/:id/export-archive", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    let instance: any = null;
    let rootDir: string | undefined = undefined;
    try {
      instance = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Not found" });
      }

      const ownerId = instance.owner_id || instance.user_id;
      const isOwner = ownerId === req.user.id;
      const isPrivileged = isPrivilegedUser(req.user);
      if (!isOwner && !isPrivileged) {
        return res.status(403).json({ error: "Forbidden: Access denied" });
      }


      try {
        await assertCanExportBackup(req.user);
      } catch (entitlementErr: any) {
        if (sendEntitlementError(res, entitlementErr)) return;
        throw entitlementErr;
      }

      const config = parseInstanceConfigJson(instance.config_json);
      const redactedConfig = redactSecretsDeep(config);
      const businessConfig = redactSecretsDeep(config.businessConfig || {});
      const templateInputs = redactSecretsDeep(config.template_inputs || {});

      // Resolve instance root directory path
      const localDir = path.resolve(process.cwd(), "data", "instances", instance.id);
      rootDir = localDir;
      if (!fs.existsSync(rootDir) && instance.data_volume_path) {
        rootDir = instance.data_volume_path;
      }

      if (!fs.existsSync(rootDir)) {
        const containerName = instance.container_name || `mybay-agent-${instance.id}`;
        try {
          const container = docker.getContainer(containerName);
          const inspectData = await container.inspect();
          const mounts = inspectData.Mounts || [];
          const optDataMount = mounts.find((m: any) => m.Destination === "/opt/data");
          if (optDataMount && optDataMount.Source) {
            const hostPathFound = optDataMount.Source;
            let resolvedLocal = null;
            try {
              const hostname = os.hostname();
              if (hostname) {
                const selfContainer = docker.getContainer(hostname);
                const selfData = await selfContainer.inspect();
                const m = selfData.Mounts?.find((m: any) => hostPathFound.startsWith(m.Source));
                if (m) {
                  resolvedLocal = path.join(m.Destination, hostPathFound.substring(m.Source.length));
                }
              }
            } catch (me) {}
            if (resolvedLocal && fs.existsSync(resolvedLocal)) {
              rootDir = resolvedLocal;
            } else if (fs.existsSync(hostPathFound)) {
              rootDir = hostPathFound;
            } else if (fs.existsSync(localDir)) {
              rootDir = localDir;
            }
          }
        } catch (e) {}
      }

      const filesToPack: { absolutePath: string; archivePath: string; size: number }[] = [];
      let totalSize = 0;

      const uploadsDirs = ["uploads", "input", "inputs", "documents", "files"];
      const outputsDirs = ["outputs", "output", "results", "artifacts"];
      const dirExclusions = ["logs", "cache", "sessions", "tmp", "node_modules", ".venv", "venv", "__pycache__", ".git", "secrets", "keys", "certs"];

      function scanDir(currentDir: string, archivePrefix: string) {
        try {
          if (!fs.existsSync(currentDir)) return;
          const stats = fs.lstatSync(currentDir);
          if (stats.isSymbolicLink()) return;
          if (!stats.isDirectory()) return;

          const basename = path.basename(currentDir);
          if (dirExclusions.includes(basename.toLowerCase())) {
            return;
          }

          let items: string[] = [];
          try {
            items = fs.readdirSync(currentDir);
          } catch (readdirErr) {
            console.warn(`[Export Archive] Failed to read directory: ${currentDir}`, readdirErr);
            return;
          }

          for (const item of items) {
            const fullPath = path.join(currentDir, item);
            const itemArchivePath = path.join(archivePrefix, item);

            if (!rootDir) return;
            // Path traversal safeguard
            const resolvedRoot = path.resolve(rootDir);
            const resolvedPath = path.resolve(fullPath);
            const relativePath = path.relative(resolvedRoot, resolvedPath);
            if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
              continue;
            }

            try {
              const itemStats = fs.lstatSync(fullPath);
              if (itemStats.isSymbolicLink()) {
                continue;
              }

              if (itemStats.isDirectory()) {
                scanDir(fullPath, itemArchivePath);
              } else if (itemStats.isFile()) {
                const lowerName = item.toLowerCase();
                if (
                  lowerName === ".env" ||
                  lowerName === "config.yaml" ||
                  lowerName === "mybay.instance.yaml" ||
                  lowerName.endsWith(".db") ||
                  lowerName.endsWith(".sqlite") ||
                  lowerName.endsWith(".sqlite3") ||
                  lowerName.endsWith(".pem") ||
                  lowerName.endsWith(".key") ||
                  lowerName.endsWith(".crt") ||
                  lowerName.endsWith(".log")
                ) {
                  continue;
                }

                if (isSensitiveFile(item)) {
                  continue;
                }

                // Limit single file size to 100MB
                if (itemStats.size > 100 * 1024 * 1024) {
                  continue;
                }

                const safeArchivePath = itemArchivePath.split(path.sep).join("/");
                filesToPack.push({
                  absolutePath: fullPath,
                  archivePath: safeArchivePath,
                  size: itemStats.size
                });
                totalSize += itemStats.size;
              }
            } catch (err) {
              console.warn(`[Export Archive] Skip file error: ${fullPath}`, err);
            }
          }
        } catch (globalErr) {
          console.warn(`[Export Archive] scanDir global error for: ${currentDir}`, globalErr);
        }
      }

      if (rootDir && fs.existsSync(rootDir)) {
        for (const udir of uploadsDirs) {
          const target = path.join(rootDir, udir);
          if (fs.existsSync(target)) {
            scanDir(target, udir);
          }
        }
        for (const odir of outputsDirs) {
          const target = path.join(rootDir, odir);
          if (fs.existsSync(target)) {
            scanDir(target, odir);
          }
        }
      }

      const totalLimit = req.user.role === 'admin' ? 1024 * 1024 * 1024 : 500 * 1024 * 1024;
      if (totalSize > totalLimit) {
        const limitStr = req.user.role === 'admin' ? "1GB" : "500MB";
        return res.status(400).json({ error: `备份数据量超限。当前实例可导出文件总大小为 ${(totalSize / (1024 * 1024)).toFixed(1)}MB，超过了单次导出上限 (${limitStr})。` });
      }

      const manifest = {
        instance_id: instance.id,
        instance_name: instance.name,
        exported_at: new Date().toISOString(),
        platform: "MyBay",
        archive_version: 1,
        redacted: true,
        included_sections: buildConfigArchiveSections(filesToPack.map((file) => file.archivePath))
      };

      const safeName = (instance.name || "instance").replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `mybay-agent-backup-${safeName}-${instance.id}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const archiverFactory = resolveArchiverFactory();
      const archive = archiverFactory('zip', { zlib: { level: 9 } });

      const archivePromise = new Promise<void>((resolve, reject) => {
        let settled = false;

        archive.on('warning', function(err) {
          if (err.code !== 'ENOENT') {
            console.error("[Export Archive Warning]", { instanceId: instance?.id || req.params.id, error: err });
          }
        });

        archive.on('error', function(err) {
          console.error("[Export Archive Error]", { instanceId: instance?.id || req.params.id, error: err });
          if (!settled) {
            settled = true;
            reject(err);
          }
        });

        res.on('finish', () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        });

        res.on('close', () => {
          if (!settled) {
            settled = true;
            const err = new Error("Client disconnected before archive stream finished");
            console.warn(`[Export Archive Error] Connection closed prematurely before finish. Instance ID: ${instance?.id || req.params.id}`);
            reject(err);
          }
        });

        archive.pipe(res);
      });

      console.log(
        `[Export Archive] Starting zip compilation.\n` +
        `Instance ID: ${instance.id}\n` +
        `RootDir: ${rootDir || 'undefined'}\n` +
        `Files count to pack: ${filesToPack.length}\n` +
        `Total size: ${totalSize} bytes\n` +
        `Uploads/Outputs found: ${filesToPack.length > 0 ? "Yes" : "No"}`
      );

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      archive.append(JSON.stringify(redactedConfig, null, 2), { name: 'config.redacted.json' });
      archive.append(JSON.stringify(businessConfig, null, 2), { name: 'business-config.json' });
      archive.append(JSON.stringify(templateInputs, null, 2), { name: 'template-inputs.json' });

      const readmeContent = `MyBay Agent Backup Archive
==========================

This backup package was exported from MyBay on ${manifest.exported_at}.

Included contents:
- manifest.json: Metadata about this export
- config.redacted.json: Redacted configuration (API keys, credentials, and passwords have been removed for security)
- business-config.json: Redacted business configuration
- template-inputs.json: Redacted template inputs configuration
- uploads/: User-uploaded data documents (if any exist and within limits)
- outputs/: Generated artifacts and output files (if any exist and within limits)

Excluded contents (NOT INCLUDED):
- Sensitive credentials, system passwords, API Keys, or active login sessions (.env, database files, certs)
- Runtime dependencies and cache (node_modules, logs, tmp, cache, sessions)
- Container system environments

Note:
This backup package is designed for troubleshooting, offline data review, and safe storage.
API keys, credentials, and passwords must be manually reconfigured upon future restore or clone.
`;
      archive.append(readmeContent, { name: 'README.txt' });

      for (const file of filesToPack) {
        try {
          if (fs.existsSync(file.absolutePath)) {
            archive.file(file.absolutePath, { name: file.archivePath });
          } else {
            console.warn(`[Export Archive] File missing dynamically, skipping: ${file.absolutePath}`);
          }
        } catch (fileErr: any) {
          console.error(`[Export Archive] Failed to append file ${file.absolutePath} (skipped):`, fileErr);
        }
      }

      console.log(`[Export Archive] Finalizing archive for instance ${instance.id}`);
      await archive.finalize();
      console.log(`[Export Archive] Archive finalize call finished for instance ${instance.id}`);

      await archivePromise;
      console.log(`[Export Archive] Zip archive output streamed completely for instance ${instance.id}`);

      await dbAdapter.insertAuditLog({
        instance_id: instance.id,
        action: "export_archive",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Exported redacted instance backup package (.zip)"
      }).catch(() => {});

    } catch (e: any) {
      console.error(
        `[Config API] Export Archive error:\n` +
        `Instance ID: ${req.params.id}\n` +
        `Typeof config_json: ${typeof (instance?.config_json)}\n` +
        `Root Directory: ${rootDir || 'undefined'}\n` +
        `Error: ${e?.message}\n` +
        `Stack: ${e?.stack}`
      );
      if (!res.headersSent) {
        res.status(500).json({ error: "应用打包导出失败，服务器内部异常" });
      }
    }
  });

  return router;
}

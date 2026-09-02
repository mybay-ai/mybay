import path from "path";
import fs from "fs";
import os from "os";
import { dbAdapter } from "../../db";
import { AuthenticatedRequest } from "../../middlewares/auth";
import Docker from "dockerode";
import { getValidatedContainer } from "../../deploymentContext";

// We need a docker instance, but we can't assume we import it from routes/instances/index.
// Let's pass it as a parameter, or create a short-lived instance, or import the shared one
import { docker } from "../../routes/instances/index"; // Wait, circular dependency? 
// Let's just instantiate a new Docker or import if safe. Actually exporting docker from index is ok.

export const isSensitiveFile = (filename: string) => {
  const sensitivePatterns = [
    // Hidden files and directories commonly contain credentials, runtime
    // metadata, or package-manager state. They are not product artifacts.
    /^\./,
    /^\.mybay-upload-/i,
    /^\.env/i,
    /\.key$/i,
    /\.pem$/i,
    /\.crt$/i,
    /secret/i,
    /token/i,
    /api_key/i,
    /credential/i,
    /password/i,
    /^config\.ya?ml(?:\.bak(?:[-.].*)?)?$/i,
    /^mybay\.config\.ya?ml(?:\.bak(?:[-.].*)?)?$/i,
    /^mybay\.instance\.yaml$/i,
    /^mybay\.template\.yaml$/i,
    /^mybay\.system\.md$/i,
    /^soul\.md$/i,
    /^auth\.(?:json|lock)$/i,
    /^spawn-ledger\.json$/i,
    /^(?:backup|backups|home|log|logs|pairing|session|sessions|state)$/i,
    /\.(?:sqlite|db)(?:-(?:wal|shm|journal))?$/i,
    /^\.git/i
  ];
  return sensitivePatterns.some(pattern => pattern.test(filename));
};

export const getMimeType = (filename: string) => {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.ts': 'text/plain',
    '.tsx': 'text/plain',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
  };
  return map[ext] || 'application/octet-stream';
};

function resolveExistingDirectory(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !candidate || candidate.length > 4096 || /[\0-\x1f\x7f]/.test(candidate)) return null;
  try {
    const canonical = fs.realpathSync(path.resolve(candidate));
    return fs.statSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}

export const validateFileAccess = async (req: AuthenticatedRequest, instanceId: string, requestedPathRaw: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(instanceId)) {
    return { error: "无效的实例标识", status: 400 };
  }
  if (typeof requestedPathRaw !== "string" || requestedPathRaw.length > 4096 || /[\0-\x1f\x7f]/.test(requestedPathRaw)) {
    return { error: "无效的文件路径", status: 400 };
  }
  const instance: any = await dbAdapter.getInstanceById(instanceId);
  if (!instance) return { error: "实例不存在", status: 404 };
  
  let isOwner = false;
  if (instance.owner_id) {
    isOwner = instance.owner_id === req.user.id;
  } else {
    isOwner = instance.user_id === req.user.id;
  }

  if (!isOwner && req.user.role !== 'admin') {
    return { error: "无权访问此实例的文件", status: 403 };
  }

  let requestedPath = "";
  try {
    requestedPath = decodeURIComponent(requestedPathRaw);
  } catch (e) {
    return { error: "无效的路径编码", status: 400 };
  }

  if (requestedPath.includes('..') || requestedPath.includes('\\')) {
    return { error: "非法访问：检测到路径穿越尝试", status: 403 };
  }

  const segments = requestedPath.split('/').filter(Boolean);
  if (segments.some(segment => isSensitiveFile(segment))) {
    return { error: "禁止访问敏感配置文件或目录", status: 403 };
  }

  const localDir = path.resolve(process.cwd(), "data", "instances", instanceId);
  let rootDir = resolveExistingDirectory(localDir) || resolveExistingDirectory(instance.data_volume_path);

  if (!rootDir) {
    try {
      const container = await getValidatedContainer(docker, instance);
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
        } catch (me: any) {
          console.warn("[File Manager] Self-container inspect failed", { error: me.message });
        }

        rootDir = resolveExistingDirectory(resolvedLocal)
          || resolveExistingDirectory(hostPathFound)
          || resolveExistingDirectory(localDir);
        
        dbAdapter.updateInstanceVersionInfo(instanceId, { data_volume_path: hostPathFound }).catch((e: any) => {
          console.warn("[File Manager] Failed to auto-heal data_volume_path", { instanceId, error: e.message });
        });
      }
    } catch (e: any) {
      console.warn("[File Manager] Docker inspect fallback failed", { instanceId, error: e.message });
    }
  }

  if (!rootDir) {
    return { error: "该实例暂无可浏览的数据目录，或未找到有效的挂载", status: 404 };
  }

  try {
    const realBaseDir = rootDir;
    
    const relativePath = path.relative("/", path.join("/", requestedPath));
    const absolutePath = path.resolve(realBaseDir, relativePath);

    const realAbsolutePath = fs.realpathSync(absolutePath);

    const isInside = realAbsolutePath === realBaseDir || realAbsolutePath.startsWith(realBaseDir + path.sep);

    if (!isInside) {
      return { error: "非法访问：越界路径", status: 403 };
    }

    const fileName = path.basename(realAbsolutePath);
    if (isSensitiveFile(fileName)) {
      return { error: "禁止访问敏感配置文件", status: 403 };
    }

    return { absolutePath: realAbsolutePath, candidatePath: absolutePath, rootDir: realBaseDir, instance };
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
      return { error: "文件或目录不存在", status: 404 };
    }
    console.error("[File Manager] Path validation error:", err);
    return { error: "路径解析错误", status: 400 };
  }
};

export const validateFileForDeletion = async (req: AuthenticatedRequest, instanceId: string, requestedPathRow: string) => {
  const requestedPath = requestedPathRow || "";
  if (!requestedPath || requestedPath === "/") {
    return { error: "未指定文件路径", code: "INVALID_FILE_PATH", status: 400 };
  }

  const normalizedRequestedPath = requestedPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const allowedPrefixes = ["outputs/", "uploads/", "documents/", "reports/", "tmp/"];
  const isAllowedDir = allowedPrefixes.some(prefix => normalizedRequestedPath.toLowerCase().startsWith(prefix));
  
  if (!isAllowedDir) {
     return { 
        error: "只能删除 outputs, uploads, documents, reports, tmp 目录下的产物文件。", 
        code: "INVALID_FILE_PATH",
        status: 403
     };
  }

  const validation = await validateFileAccess(req, instanceId, requestedPath);
  if ("error" in validation) {
    return validation; // contains error, status
  }

  const { absolutePath, candidatePath, rootDir, instance } = validation as any;

  try {
    const targetPathForDeletion = candidatePath || absolutePath;
    
    // Check for symlinks path segments
    if (candidatePath && rootDir && candidatePath.startsWith(rootDir)) {
      const relativePath = path.relative(rootDir, candidatePath);
      const segments = relativePath.split(path.sep).filter(Boolean);
      let currentPath = rootDir;
      for (const segment of segments) {
        currentPath = path.join(currentPath, segment);
        try {
          const stats = fs.lstatSync(currentPath);
          if (stats.isSymbolicLink()) {
            return { error: "禁止删除符号链接文件或通过符号链接目录删除", code: "INVALID_FILE_PATH", status: 403 };
          }
        } catch (e: any) {
          if (e.code === 'ENOENT') {
             return { error: "文件不存在", code: "NOT_FOUND", status: 404 };
          }
          throw e;
        }
      }
    }

    const lstats = fs.lstatSync(targetPathForDeletion);
    if (lstats.isSymbolicLink()) {
       return { error: "禁止删除符号链接文件", code: "INVALID_FILE_PATH", status: 403 };
    }
    if (lstats.isDirectory()) {
       return { error: "禁止删除目录，只能删除具体文件", code: "INVALID_FILE_PATH", status: 403 };
    }
  } catch (e) {
    return { error: "文件不存在", code: "NOT_FOUND", status: 404 };
  }

  const targetPathForDeletion = candidatePath || absolutePath;
  const fileName = path.basename(targetPathForDeletion);
  if (fileName.startsWith(".")) {
     return { error: "禁止删除隐藏文件", code: "INVALID_FILE_PATH", status: 403 };
  }
  if (isSensitiveFile(fileName)) {
     return { error: "禁止删除敏感文件", code: "INVALID_FILE_PATH", status: 403 };
  }

  return { absolutePath: targetPathForDeletion, rootDir, instance };
};

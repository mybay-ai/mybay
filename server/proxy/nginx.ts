import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { Server as SocketIOServer } from "socket.io";
import { buildDeploymentContext } from "../deploymentContext";
import { runInstanceHealthChecks } from "../healthCheck";
import { parseTraefikEnv } from "../infrastructure/traefik/traefikConfig";
import { isPrivilegedInstance } from "../utils/instanceRole";
import { tryResolvePlainInstancePassword } from "../crypto";

export async function rebuildProxyConfig(instance: any, io: SocketIOServer, updateInstanceStatusStmt: any) {
  const ctx = buildDeploymentContext(instance);
  const configObj = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json || '{}') : (instance.config_json || {});
  const subdomain = ctx.subdomain;
  const targetPort = ctx.gatewayHostPort;
  const dashboardHostPort = ctx.dashboardHostPort;

  let proxyPassTarget = `http://127.0.0.1:${dashboardHostPort}`;

  let filesBlock = "";
  const isPrivileged = await isPrivilegedInstance(instance);
  if (!isPrivileged) {
    filesBlock += `
    location ~ ^/(api/files|files|workspace) {
        return 403 "{\\"error\\":\\"Access denied. Files capability is restricted to administrators.\\"}";
        default_type application/json;
    }
`;
  }

  if (!ctx.enableDashboard) {
    filesBlock += `
    location ~ ^/(?!webhook|webhooks|v1|oauth|callback|lark|wechat|wechat_mp|wecom|dingtalk|socket\\.io|api/channels|api/webhook|api/callback|api/oauth) {
        return 403 "{\\"error\\":\\"Web UI is disabled for this instance.\\"}";
        default_type application/json;
    }
`;
  }

  let mainLocationBlock = "";

  if (ctx.enableDashboard !== false) {
    let authHeaderBlock = "";
    if (configObj.webPasswordHash) {
      const plainPassword = tryResolvePlainInstancePassword(configObj);
      if (plainPassword) {
        const username = configObj.username || "admin";
        const authHeaderVal = "Basic " + Buffer.from(`${username}:${plainPassword}`).toString("base64");
        authHeaderBlock = `\n        proxy_set_header Authorization "${authHeaderVal}";`;
      }
    }

    mainLocationBlock = `
    location / {
        auth_request /_auth_check;
        error_page 401 = @error401;
${authHeaderBlock}
        proxy_pass ${proxyPassTarget};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }`;
  }

  let consoleInternalUrl = process.env.INSTANCE_AUTH_INTERNAL_URL || process.env.CONTROL_PLANE_INTERNAL_URL;
  if (!consoleInternalUrl) {
    consoleInternalUrl = "http://master-node:3000";
  }

  const isApiEnabled = configObj?.channel === "api" || configObj?.publicApiEnabled === true || configObj?.exposeApi === true || configObj?.publicApiEnabled === "true" || configObj?.exposeApi === "true";
  const isWebhookEnabled = configObj?.channel === "webhook" || configObj?.WEBHOOK_ENABLED === "true" || configObj?.WEBHOOK_ENABLED === true;

  const nginxConfig = `
server {
    listen 80;
    server_name ${subdomain};

${filesBlock}

    location = /_auth_check {
        internal;
        proxy_pass ${consoleInternalUrl}/api/public/instances/auth-check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Host $host;
    }

    location @error401 {
        if ($saved_location) {
            return 302 $saved_location;
        }
        return 401 "{\\"error\\":\\"Unauthorized\\",\\"message\\":\\"Please log in to access this instance's Web UI layer.\\"}";
        default_type application/json;
    }

    # Public routes that bypass MyBay session auth checking
    location ~ ^/(${isApiEnabled ? 'v1|' : ''}${isWebhookEnabled ? 'webhook|webhooks|' : ''}oauth|callback|lark|wechat|wechat_mp|wecom|dingtalk|socket\\.io|api/channels|api/webhook|api/callback|api/oauth) {
        proxy_pass ${proxyPassTarget};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }

${!isApiEnabled ? `    location ^~ /v1 {
        return 404 "{\\"error\\":\\"API Channel is not enabled for this instance.\\"}";
        default_type application/json;
    }` : ""}

${mainLocationBlock}
}
`.trim();

  const nginxDir = path.dirname(ctx.nginxConfigContainerPath);
  if (!fs.existsSync(nginxDir)) fs.mkdirSync(nginxDir, { recursive: true });
  
  const configPath = ctx.nginxConfigContainerPath;
  fs.writeFileSync(configPath, nginxConfig);

  if (isApiEnabled || isWebhookEnabled) {
    io.emit(`deploy_log_${instance.id}`, {
      timestamp: new Date().toISOString(),
      message: `[WARNING] 本地 Nginx 代理仅通过单端口 (9119 -> ${dashboardHostPort}) 进行容器绑定。API/Webhook 独立端口闭环（8642/8644）主要由 Traefik 模式支持。在 Nginx 模式下，/v1 与 /webhooks 流量将继续降级转发至主端口 9119。`
    });
  }

  io.emit(`deploy_log_${instance.id}`, {
    timestamp: new Date().toISOString(),
    message: `[Nginx config generated] Nginx 配置文件已重新生成: ${configPath}\n详细部署元数据：\nInstance ID: ${ctx.instanceId}\nFull Server Name: ${subdomain}\nNginx Config File: ${ctx.nginxConfigFileName}\nDashboard Proxy Target: ${proxyPassTarget}`,
  });

  const enableHostNginxReload = process.env.ENABLE_HOST_NGINX_RELOAD === "true";
  const hostNginxReloadCommand = process.env.HOST_NGINX_RELOAD_COMMAND || "";

  if (enableHostNginxReload && hostNginxReloadCommand) {
    io.emit(`deploy_log_${instance.id}`, {
      timestamp: new Date().toISOString(),
      message: `[网关] 检测到已配置宿主机重载指令。开始重载宿主机 Nginx: ${hostNginxReloadCommand}...`,
    });
    // Parameterize the command to avoid shell injection
    const cmdParts = hostNginxReloadCommand.trim().split(/\s+/);
    const mainCommand = cmdParts[0];
    const commandArgs = cmdParts.slice(1);

    execFile(mainCommand, commandArgs, (reloadErr, reloadStdout, reloadStderr) => {
      if (reloadErr) {
        io.emit(`deploy_log_${instance.id}`, {
          timestamp: new Date().toISOString(),
          message: `[网关提醒] 宿主机 Nginx 自动重载指令执行失败: ${reloadErr.message}\\n指令输出stderr: ${reloadStderr || '无'}\\n请在宿主面板手动检测并重载 nginx。`
        });
      } else {
        io.emit(`deploy_log_${instance.id}`, {
          timestamp: new Date().toISOString(),
          message: `[Nginx config loaded] 宿主机 Nginx 重载启动成功！`
        });
      }
      runInstanceHealthChecks(instance.id, targetPort, dashboardHostPort, subdomain, io, updateInstanceStatusStmt, "auto_create");
    });
  } else {
    execFile("nginx", ["-t"], (nginxTestErr, testStdout, testStderr) => {
      if (nginxTestErr) {
        if (nginxTestErr.code === 'ENOENT') {
          io.emit(`deploy_log_${instance.id}`, {
            timestamp: new Date().toISOString(),
            message: `[网关提醒] 系统容器内未安装 nginx 指令，无法执行验证测试。配置文件已保存，请手动在宿主机执行重载以应用新的反代规则。`
          });
          runInstanceHealthChecks(instance.id, targetPort, dashboardHostPort, subdomain, io, updateInstanceStatusStmt, "auto_create");
        } else {
          fs.unlinkSync(configPath);
          io.emit(`deploy_log_${instance.id}`, {
            timestamp: new Date().toISOString(),
            message: `[网关提醒] Nginx 配置文件语法测试未通过，已自动撤销该文件以避免系统级影响。\\n详情及原因：\\n${testStderr}`,
          });
          updateInstanceStatusStmt.run({ status: "partial_running", id: instance.id });
          io.emit(`deploy_status_${instance.id}`, "partial_running");
          runInstanceHealthChecks(instance.id, targetPort, dashboardHostPort, subdomain, io, updateInstanceStatusStmt, "auto_create");
        }
        return;
      }
      
      io.emit(`deploy_log_${instance.id}`, {
        timestamp: new Date().toISOString(),
        message: `[网关] Nginx 配置文件语法自检通过。因未开启或支持容器外部 Nginx 自动 Reload，请手动登录宿主机面板或执行 reload 重新加载配置。`
      });
      runInstanceHealthChecks(instance.id, targetPort, dashboardHostPort, subdomain, io, updateInstanceStatusStmt, "auto_create");
    });
  }
}

export async function removeProxyConfig(instance: any, io?: SocketIOServer): Promise<void> {
  const { isTraefik } = parseTraefikEnv(process.env);
  if (isTraefik) {
    return; // Under Traefik mode, no Nginx config is written or removed on A
  }

  const ctx = buildDeploymentContext(instance);
  const configPath = ctx.nginxConfigContainerPath;

  if (!fs.existsSync(configPath)) {
    console.log(`[Proxy Gateway A] No proxy configuration file found at ${configPath}, skipping removal (idempotent).`);
    return;
  }

  try {
    fs.unlinkSync(configPath);
    console.log(`[Proxy Gateway A] Cleaned up proxy configuration file at ${configPath}`);
    if (io) {
      io.emit(`deploy_log_${instance.id}`, {
        timestamp: new Date().toISOString(),
        message: `[网关] 已成功删除主站统一入口反代配置文件: ${configPath}`
      });
    }
  } catch (err: any) {
    console.error(`[Proxy Gateway A Error] Failed to delete proxy config file ${configPath}:`, err.message);
    if (io) {
      io.emit(`deploy_log_${instance.id}`, {
        timestamp: new Date().toISOString(),
        message: `[网关异常] 无法删除主站统一入口反代配置文件: ${err.message}`
      });
    }
    throw new Error(`Failed to delete proxy config file: ${err.message}`);
  }

  const enableHostNginxReload = process.env.ENABLE_HOST_NGINX_RELOAD === "true";
  const hostNginxReloadCommand = process.env.HOST_NGINX_RELOAD_COMMAND || "";

  return new Promise<void>((resolve, reject) => {
    if (enableHostNginxReload && hostNginxReloadCommand) {
      if (io) {
        io.emit(`deploy_log_${instance.id}`, {
          timestamp: new Date().toISOString(),
          message: `[网关] 开始重载宿主机 Nginx 以应用配置变更...`
        });
      }
      const cmdParts = hostNginxReloadCommand.trim().split(/\s+/);
      const mainCommand = cmdParts[0];
      const commandArgs = cmdParts.slice(1);

      execFile(mainCommand, commandArgs, (reloadErr, reloadStdout, reloadStderr) => {
        if (reloadErr) {
          const errMsg = `宿主机 Nginx 自动重载指令执行失败: ${reloadErr.message}. stderr: ${reloadStderr || '无'}`;
          console.error(`[Proxy Gateway A Error] ${errMsg}`);
          if (io) {
            io.emit(`deploy_log_${instance.id}`, {
              timestamp: new Date().toISOString(),
              message: `[网关异常] ${errMsg}`
            });
          }
          reject(new Error(errMsg));
        } else {
          console.log(`[Proxy Gateway A] Host Nginx reload successful.`);
          if (io) {
            io.emit(`deploy_log_${instance.id}`, {
              timestamp: new Date().toISOString(),
              message: `[网关] 宿主机 Nginx 重新加载成功，统一入口配置已清理。`
            });
          }
          resolve();
        }
      });
    } else {
      execFile("nginx", ["-s", "reload"], (reloadErr, reloadStdout, reloadStderr) => {
        if (reloadErr) {
          const errMsg = `容器 Nginx 重新加载失败: ${reloadErr.message}. stderr: ${reloadStderr || '无'}`;
          console.error(`[Proxy Gateway A Error] ${errMsg}`);
          if (io) {
            io.emit(`deploy_log_${instance.id}`, {
              timestamp: new Date().toISOString(),
              message: `[网关异常] ${errMsg}`
            });
          }
          reject(new Error(errMsg));
        } else {
          console.log(`[Proxy Gateway A] Container Nginx reload successful.`);
          if (io) {
            io.emit(`deploy_log_${instance.id}`, {
              timestamp: new Date().toISOString(),
              message: `[网关] 容器 Nginx 重载成功，统一入口配置已清理。`
            });
          }
          resolve();
        }
      });
    }
  });
}

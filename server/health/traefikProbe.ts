import http from "http";
import { execFile } from "child_process";
import { parseTraefikEnv, getTraefikRouterName } from "../infrastructure/traefik/traefikConfig";
export function checkHostHeaderProxy(subdomain: string, username?: string, password?: string, dashboardHostPort?: number): Promise<boolean> {
  return new Promise((resolve) => {
    let targetUrl = process.env.NGINX_HEALTH_URL || "http://127.0.0.1/";
    const headers = ["-H", `Host: ${subdomain}`];

    if (username && password) {
      headers.push("-u", `${username}:${password}`);
    }
    execFile("curl", ["-sS", "-I", "--max-time", "5", ...headers, targetUrl], (err, stdout, stderr) => {
      if (err) {
        // Fallback checks with Nginx proxy under fallback host headers
        const fallbackHeaders = ["-H", `Host: ${subdomain}`];
        if (username && password) {
          fallbackHeaders.push("-u", `${username}:${password}`);
        }
        execFile("curl", ["-sS", "-I", "--max-time", "5", ...fallbackHeaders, "http://host.docker.internal/"], (fallbackErr, fallbackStdout) => {
          if (fallbackErr) {
            resolve(false);
            return;
          }
          const fLine = (fallbackStdout || "").split(/\r?\n/)[0] || "";
          const isOk = [200, 301, 302, 401, 403].some(code => fLine.includes(String(code)));
          resolve(isOk);
        });
        return;
      }
      const output = stdout || "";
      const firstLine = output.split(/\r?\n/)[0] || "";
      const isReachable = [200, 301, 302, 401, 403].some(code => firstLine.includes(String(code)));
      resolve(isReachable);
    });
  });
}

export function checkTraefikRoute(subdomain: string, username?: string, password?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { traefikInternalUrl } = parseTraefikEnv(process.env);
    try {
      const parsed = new URL(traefikInternalUrl);
      const headers: { [key: string]: string } = { 'Host': subdomain };
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        headers['Authorization'] = `Basic ${auth}`;
      }
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        headers,
        timeout: 5000
      };

      const req = http.get(options, (res) => {
        const sc = res.statusCode;
        res.resume();
        if (sc && [200, 301, 302, 401, 403].includes(sc)) {
          resolve(true);
        } else {
          resolve(false);
        }
      }).on('error', (err: any) => {
        console.error("checkTraefikRoute error:", err.message);
        resolve(false);
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
    } catch (e: any) {
      console.error("Failed to parse TRAEFIK_INTERNAL_URL:", e.message);
      resolve(false);
    }
  });
}

export function checkHostHeaderProxyDetails(subdomain: string, username?: string, password?: string, dashboardHostPort?: number): Promise<{ success: boolean; url: string; statusCode: string }> {
  return new Promise((resolve) => {
    let targetUrl = process.env.NGINX_HEALTH_URL || "http://127.0.0.1/";
    const headers = ["-H", `Host: ${subdomain}`];

    if (username && password) {
      headers.push("-u", `${username}:${password}`);
    }
    execFile("curl", ["-sS", "-I", "--max-time", "5", ...headers, targetUrl], (err, stdout) => {
      const output = stdout || "";
      const firstLine = output.split(/\r?\n/)[0] || "";
      const isReachable = [200, 301, 302, 401, 403].some(code => firstLine.includes(String(code)));
      resolve({ success: isReachable, url: targetUrl, statusCode: firstLine.trim() || (err ? "Connect Error" : "None") });
    });
  });
}

export function checkTraefikRouteDetails(subdomain: string, username?: string, password?: string): Promise<{ success: boolean; url: string; statusCode: string }> {
  return new Promise((resolve) => {
    const { traefikInternalUrl } = parseTraefikEnv(process.env);
    const traefikUrl = traefikInternalUrl;
    try {
      const parsed = new URL(traefikUrl);
      const headers: { [key: string]: string } = { 'Host': subdomain };
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        headers['Authorization'] = `Basic ${auth}`;
      }
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        headers,
        timeout: 5000
      };

      const req = http.get(options, (res) => {
        const sc = res.statusCode;
        res.resume();
        const success = !!(sc && [200, 301, 302, 401, 403].includes(sc));
        resolve({ success, url: traefikUrl, statusCode: String(sc || "Unknown") });
      }).on('error', (err: any) => {
        resolve({ success: false, url: traefikUrl, statusCode: `Error: ${err.message}` });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ success: false, url: traefikUrl, statusCode: "Timeout" });
      });
    } catch (e: any) {
      resolve({ success: false, url: traefikUrl, statusCode: `Parse error: ${e.message}` });
    }
  });
}

export async function verifyTraefikLabels(docker: any, containerName: string, instanceId: string) {
  try {
    const container = docker.getContainer(containerName);
    const inspect = await container.inspect();
    const labels = inspect.Config.Labels;
    if (!labels) {
      return { success: false, error: "容器没有任何 labels，缺少 Traefik 路由配置" };
    }
    
    if (labels['traefik.enable'] !== 'true') {
      return { success: false, error: "缺少 traefik.enable=true label" };
    }
    
    const expectedRouter = getTraefikRouterName(instanceId);
    
    const missingKeys: string[] = [];
    if (!labels[`traefik.http.routers.${expectedRouter}.rule`]) missingKeys.push(`traefik.http.routers.${expectedRouter}.rule`);
    if (!labels[`traefik.http.services.${expectedRouter}.loadbalancer.server.port`]) missingKeys.push(`traefik.http.services.${expectedRouter}.loadbalancer.server.port`);
    
    if (missingKeys.length > 0) {
      return { success: false, error: `缺少 Traefik 必要 labels: ${missingKeys.join(', ')}` };
    }
    
    try {
      const { traefikContainerName } = parseTraefikEnv(process.env);
      const traefikContainer = docker.getContainer(traefikContainerName);
      const logsBuffer = await traefikContainer.logs({ tail: 100, stdout: true, stderr: true });
      const logs = logsBuffer.toString('utf8');
      
      if (logs.includes(expectedRouter) && logs.includes("cannot be linked automatically with multiple Services")) {
        return { success: false, error: `Traefik 核心错误：Router ${expectedRouter} cannot be linked automatically with multiple Services. 必须在 Router 上显式指定 service 标签。`, errorCode: "gateway_config_error" };
      }
      if (logs.includes(expectedRouter) && logs.includes("unsupported function: Headers")) {
        return { success: false, error: `Traefik 核心错误：不支持的路由规则 Headers 函数，请检查 labels 语法。`, errorCode: "gateway_config_error" };
      }
    } catch (logErr) {
      console.warn("Failed to fetch traefik logs for verification", logErr);
    }
    
    const traefikNetworkName = labels['traefik.docker.network'];
    const containerNetworks = Object.keys(inspect.NetworkSettings.Networks || {});
    
    return { success: true, diagnostics: `router: ${expectedRouter}, rule: ${labels[`traefik.http.routers.${expectedRouter}.rule`]}, expected network: ${traefikNetworkName}, current networks: ${containerNetworks.join(',')}` };
  } catch (err: any) {
    return { success: false, error: `检查容器 labels 失败: ${err.message}` };
  }
}

import { execFile } from "child_process";
import Docker from "dockerode";

const docker = new Docker();

export type LocalAccessMode = "desktop" | "lan";

export function resolvePublishedPortBinding(
  inspectData: any,
  internalPort: number,
  expectedHostPort: number,
  mode: LocalAccessMode,
): { ready: boolean; hostIp: string | null; hostPort: string | null } {
  const portKey = `${internalPort}/tcp`;
  const bindings = inspectData?.NetworkSettings?.Ports?.[portKey]
    || inspectData?.HostConfig?.PortBindings?.[portKey]
    || [];
  const expectedPort = String(expectedHostPort);

  for (const binding of bindings) {
    const hostPort = String(binding?.HostPort || "");
    const hostIp = String(binding?.HostIp || "");
    if (hostPort !== expectedPort) continue;

    const normalizedIp = hostIp.toLowerCase();
    const loopback = normalizedIp === "127.0.0.1" || normalizedIp === "::1";
    const lanReachable = !loopback && (
      normalizedIp === ""
      || normalizedIp === "0.0.0.0"
      || normalizedIp === "::"
      || normalizedIp === "[::]"
      || normalizedIp.length > 0
    );
    const ready = mode === "desktop" ? loopback : lanReachable;
    return { ready, hostIp: hostIp || null, hostPort };
  }

  return { ready: false, hostIp: null, hostPort: null };
}

export async function checkPublishedPortBinding(
  containerName: string,
  internalPort: number,
  expectedHostPort: number,
  mode: LocalAccessMode,
): Promise<{ ready: boolean; hostIp: string | null; hostPort: string | null }> {
  try {
    const inspectData = await docker.getContainer(containerName).inspect();
    return resolvePublishedPortBinding(inspectData, internalPort, expectedHostPort, mode);
  } catch {
    return { ready: false, hostIp: null, hostPort: null };
  }
}

export function checkContainerRunning(containerName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const container = docker.getContainer(containerName);
    container.inspect((err, data) => {
      resolve(!err && data && data.State && data.State.Running === true);
    });
  });
}

export function checkContainerHttp(containerName: string, url: string, expectedText?: string): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const cmd = `curl -fsS "${url}" || wget -qO- "${url}"`;
      const container = docker.getContainer(containerName);
      const exec = await container.exec({
        Cmd: ['sh', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false }) as any;
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.on('end', () => {
        if (expectedText) {
          resolve(output.includes(expectedText));
        } else {
          resolve(true);
        }
      });
    } catch (err) {
      resolve(false);
    }
  });
}

export function checkContainerPortListening(containerName: string, port: number): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const pythonCmd = `python3 -c "import socket; s = socket.socket(); s.settimeout(1); s.connect(('127.0.0.1', ${port}))"`;
      const curlCmd = `curl -fsSI http://127.0.0.1:${port}`;
      const wgetCmd = `wget --spider -q http://127.0.0.1:${port}`;
      const ncCmd = `nc -z 127.0.0.1 ${port}`;
      const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
      const procTcpCmd = `cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -i ':${hexPort}'`;

      const combinedCmd = `(${pythonCmd} && echo "OK") || (${curlCmd} && echo "OK") || (${wgetCmd} && echo "OK") || (${ncCmd} && echo "OK") || ((${procTcpCmd}) && echo "OK")`;

      const container = docker.getContainer(containerName);
      const exec = await container.exec({
        Cmd: ['sh', '-c', combinedCmd],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false }) as any;
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.on('end', () => {
        resolve(output.includes("OK"));
      });
    } catch (err) {
      resolve(false);
    }
  });
}

export function checkHostPortHttp(hostPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Run curl -I http://127.0.0.1:<hostPort> to check host port reachability
    execFile("curl", ["-I", "--max-time", "3", `http://127.0.0.1:${hostPort}`], (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      const output = stdout || "";
      const isOk = [200, 301, 302, 401, 403, 404, 500, 502, 503].some(code => output.includes(String(code))) || output.includes("HTTP/");
      resolve(isOk);
    });
  });
}

export function checkFrontendMissingBuild(containerName: string, internalPort: number): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const container = docker.getContainer(containerName);
      const exec = await container.exec({
        Cmd: ['sh', '-c', `curl -sS --max-time 3 http://127.0.0.1:${internalPort}/dashboard/ || wget -qO- http://127.0.0.1:${internalPort}/dashboard/`],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false }) as any;
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.on('end', () => {
        resolve(output.includes("Frontend not built"));
      });
    } catch (err) {
      resolve(false);
    }
  });
}

export async function detectDuplicateRunningContainers(instanceId: string): Promise<boolean> {
  const containers = await docker.listContainers({ all: false }).catch(() => []);
  const prefix = `mybay-agent-${instanceId}-`;
  let runningCount = 0;
  for (const c of containers) {
    const isOurInstance = c.Names.some(n => {
      const cleanName = n.startsWith('/') ? n.substring(1) : n;
      return cleanName.startsWith(prefix);
    });
    if (isOurInstance) {
      runningCount++;
    }
  }
  return runningCount > 1;
}

export function checkFrontendConfigDiagnostic(containerName: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    try {
      const container = docker.getContainer(containerName);
      // Check HERMES_WEB_DIST from env and verify if index.html exists in both that path and the default path
      const checkCmd = `
        echo "ENV_WEB_DIST=$MY_BAY_WEB_DIST"
        if [ -n "$MY_BAY_WEB_DIST" ]; then
          if [ -f "$MY_BAY_WEB_DIST/index.html" ]; then
            echo "ENV_PATH_VALID=true"
          else
            echo "ENV_PATH_VALID=false"
          fi
        fi
        if [ -f "/opt/mybay/mybay_cli/web_dist/index.html" ]; then
          echo "DEFAULT_PATH_VALID=true"
        else
          echo "DEFAULT_PATH_VALID=false"
        fi
      `;
      const exec = await container.exec({
        Cmd: ['sh', '-c', checkCmd],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false }) as any;
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.on('end', () => {
        const envWebDistMatch = output.match(/ENV_WEB_DIST=(.*)/);
        const envWebDist = envWebDistMatch ? envWebDistMatch[1].trim() : "";
        const envPathValid = output.includes("ENV_PATH_VALID=true");
        const defaultPathValid = output.includes("DEFAULT_PATH_VALID=true");

        if (envWebDist) {
          if (!envPathValid) {
            if (defaultPathValid) {
              resolve(`MY_BAY_WEB_DIST misconfigured: pointing to "${envWebDist}" which is missing index.html, but valid build found at default path.`);
            } else {
              resolve(`frontend_path_mismatch: MY_BAY_WEB_DIST="${envWebDist}" is invalid and default path is also empty.`);
            }
          }
        } else if (!defaultPathValid) {
          resolve("Default frontend path /opt/mybay/mybay_cli/web_dist/ is missing index.html.");
        }
        resolve(null);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

export function checkMyBayProcessRunning(containerName: string): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const container = docker.getContainer(containerName);
      const exec = await container.exec({
        Cmd: ['sh', '-c', 'ps aux'],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false }) as any;
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.on('end', () => {
        const lines = output.split(/\r?\n/);
        const hasRealService = lines.some(line => {
          const lower = line.toLowerCase();
          if (lower.includes("ps aux") || lower.includes("grep")) return false;
          return (lower.includes("python") || lower.includes("node") || lower.includes("mybay") || lower.includes("gateway")) && !lower.includes("sleep");
        });
        const hasFakeSleep = lines.some(line => {
          const lower = line.toLowerCase();
          return lower.includes("sleep infinity") && (lower.includes("mybay") || lower.includes("root"));
        });
        resolve(hasRealService && !hasFakeSleep);
      });
    } catch(err) {
      resolve(false);
    }
  });
}

export function getContainerLogTail(containerName: string, linesCount: number = 30): Promise<string> {
  return new Promise(async (resolve) => {
    try {
      const container = docker.getContainer(containerName);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: linesCount,
      });
      
      let result = '';
      const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs as any);
      let offset = 0;

      while (offset + 8 <= buffer.length) {
        const type = buffer.readUInt8(offset);
        const size = buffer.readUInt32BE(offset + 4);
        
        if (type > 0 && type <= 2 && offset + 8 + size <= buffer.length) {
          result += buffer.toString('utf8', offset + 8, offset + 8 + size);
          offset += 8 + size;
        } else {
          result += buffer.toString('utf8', offset);
          break;
        }
      }

      if (result.length === 0 && buffer.length > 0) {
        result = buffer.toString('utf8');
      }

      const cleaned = result
        .replace(/\x1B\[[0-9;]*[mK]/g, '')
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
      
      resolve(cleaned.trim());
    } catch(err) {
      resolve("");
    }
  });
}

export async function runExecInContainer(container: any, cmd: string): Promise<string> {
  try {
    const exec = await container.exec({
      Cmd: ['sh', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true,
    });
    return new Promise((resolve) => {
      exec.start({ Detach: false }, (err: any, stream: any) => {
        if (err) {
          resolve('');
          return;
        }
        let output = '';
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        stream.on('end', () => {
          resolve(output);
        });
      });
    });
  } catch (err) {
    return '';
  }
}

export function getContainerState(containerName: string): Promise<{ Running: boolean; Status: string; OOMKilled?: boolean; ExitCode?: number; Dead?: boolean }> {
  return new Promise((resolve) => {
    const container = docker.getContainer(containerName);
    container.inspect((err, data) => {
      if (err || !data || !data.State) {
        resolve({ Running: false, Status: "not_found" });
        return;
      }
      resolve({
        Running: data.State.Running === true,
        Status: data.State.Status || "unknown",
        OOMKilled: data.State.OOMKilled === true,
        ExitCode: data.State.ExitCode,
        Dead: data.State.Dead === true
      });
    });
  });
}


import Docker from "dockerode";
import net from "net";

/**
 * Global Concurrency Semaphore
 * Used to limit resource-intensive operations like Docker builds across the entire system.
 */
export class Semaphore {
  private queue: (() => void)[] = [];
  private activeCount: number = 0;

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeCount++;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Allow maximum 2 concurrent heavyweight Docker operations (build/pull)
export const globalTaskSemaphore = new Semaphore(2);

/**
 * Checks if a port is taken by a Docker container or local process.
 */
export async function isPortTaken(port: number, docker: Docker): Promise<boolean> {
  // 1. Check local TCP stack
  const isLocalBusy = await new Promise<boolean>((resolve) => {
    const server = net.createServer()
      .once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') resolve(true);
        else resolve(false);
      })
      .once('listening', () => {
        server.once('close', () => resolve(false)).close();
      })
      .listen(port, '0.0.0.0');
  });

  if (isLocalBusy) return true;

  // 2. Check Docker container port mappings
  try {
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
      if (c.Ports) {
        const portMapped = c.Ports.some(p => p.PublicPort === port);
        if (portMapped) return true;
      }
    }
  } catch (err) {
    console.error(`[Port Check] Docker listContainers error:`, err);
  }

  return false;
}

/**
 * Checks if a port is in use (simple local check).
 */
export async function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => {
        server.once('close', () => resolve(false)).close();
      })
      .listen(port, '0.0.0.0');
  });
}

export function getInstancePortRange() {
  const fallbackStart = 10100;
  const fallbackEnd = 19999;
  const parsedStart = Number.parseInt(String(process.env.MY_BAY_PORT_START || fallbackStart), 10);
  const parsedEnd = Number.parseInt(String(process.env.MY_BAY_PORT_END || fallbackEnd), 10);
  const start = Number.isInteger(parsedStart) && parsedStart >= 1024 && parsedStart <= 65535 ? parsedStart : fallbackStart;
  const end = Number.isInteger(parsedEnd) && parsedEnd >= start && parsedEnd <= 65535 ? parsedEnd : fallbackEnd;
  return { start, end };
}

export function listInstancePortCandidates(preferred?: number | null) {
  const { start, end } = getInstancePortRange();
  const candidates: number[] = [];
  if (preferred && preferred >= start && preferred <= end && ![3000, 15929].includes(preferred)) candidates.push(preferred);
  for (let port = start; port <= end; port++) if (![3000, 15929].includes(port) && port !== preferred) candidates.push(port);
  return candidates;
}

/**
 * Finds the next available port within the configured range.
 * This is a host preflight only; Docker's actual bind remains authoritative.
 */
export async function findAvailablePort(docker: Docker, excludedPorts: number[] = []): Promise<number> {
  const { start, end } = getInstancePortRange();

  for (let p = start; p <= end; p++) {
    if (p === 3000 || p === 15929 || excludedPorts.includes(p)) continue;
    const busy = await isPortTaken(p, docker);
    if (!busy) return p;
  }
  throw new Error(`No available ports found in range ${start}-${end}`);
}

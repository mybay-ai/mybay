import { dbAdapter } from "./db";
import { Server as SocketIOServer } from "socket.io";
import { docker } from "./lib/docker";

interface PrewarmTask {
  tag: string;
  image: string;
  version: string;
}

export class PrewarmManager {
  private queue: PrewarmTask[] = [];
  private isProcessing: boolean = false;
  private io: SocketIOServer | null = null;

  setSocketIO(io: SocketIOServer) {
    this.io = io;
  }

  async addToQueue(version: string, image: string, tag: string) {
    // Under the new tag key tracker, we key by the physical tag (tag), not the base version
    if (this.queue.some(t => t.tag === tag)) return;
    
    this.queue.push({ version, image, tag });
    await dbAdapter.updatePrewarmStatus(tag, "queued", false, image);
    this.broadcastStatus(tag, "queued");

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const task = this.queue[0];
    const fullImage = `${task.image}:${task.tag}`;

    // Inspect through the same Dockerode client used by the deployment lifecycle.
    try {
      await docker.getImage(fullImage).inspect();
      await dbAdapter.updatePrewarmStatus(task.tag, "cached", true, task.image);
      this.broadcastStatus(task.tag, "cached");
      this.finishCurrent();
      return;
    } catch (error: any) {
      if (error?.statusCode !== 404) {
        const code = this.isDockerUnavailable(error) ? "DOCKER_UNAVAILABLE" : "IMAGE_INSPECT_FAILED";
        await this.fail(task, code, error?.message);
        return;
      }
    }

    console.log(`[Prewarm] Starting pull for ${fullImage}...`);
    await dbAdapter.updatePrewarmStatus(task.tag, "pulling", false, task.image);
    this.broadcastStatus(task.tag, "pulling");

    try {
      const stream = await docker.pull(fullImage);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(
          stream,
          (error: Error | null) => error ? reject(error) : resolve(),
          (event: any) => this.broadcastLog(task.tag, JSON.stringify(event)),
        );
      });
      await docker.getImage(fullImage).inspect();
      await dbAdapter.updatePrewarmStatus(task.tag, "cached", true, task.image);
      this.broadcastStatus(task.tag, "cached");
      this.finishCurrent();
    } catch (error: any) {
      const code = this.isDockerUnavailable(error) ? "DOCKER_UNAVAILABLE" : "IMAGE_PULL_FAILED";
      await this.fail(task, code, error?.message);
    }
  }

  private isDockerUnavailable(error: any) {
    return error?.code === "ENOENT" || error?.code === "ECONNREFUSED" || error?.code === "EACCES";
  }

  private finishCurrent() {
    this.queue.shift();
    void this.processQueue();
  }

  private async fail(task: PrewarmTask, code: string, detail?: string) {
    console.error(`[Prewarm] ${code}: ${detail || "unknown error"}`);
    await dbAdapter.updatePrewarmStatus(task.tag, "failed", false, task.image);
    this.broadcastStatus(task.tag, "failed", code);
    this.finishCurrent();
  }

  private broadcastStatus(tag: string, status: string, code?: string) {
    if (this.io) {
      this.io.emit("system:prewarm_status", { tag, status, version: tag, code });
    }
  }

  private broadcastLog(tag: string, log: string) {
    if (this.io) {
      this.io.emit("system:prewarm_log", { tag, log, version: tag });
    }
  }
}

export const prewarmManager = new PrewarmManager();


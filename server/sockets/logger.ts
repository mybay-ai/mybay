import { Server as SocketIOServer, Socket } from "socket.io";
import Docker from "dockerode";
import { PassThrough } from "stream";
import { dbAdapter } from "../db";
import { sanitizeString, sanitizeErrorMessage } from "../utils/sanitizer";

const docker = new Docker();

export function setupSocketLogger(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    // Map of active log streams scoped to this connection to allow concurrent independent watching
    // Key: instanceId -> { stream, subId }
    // Map of active log streams scoped to this connection to allow concurrent independent watching
    // Key: instanceId -> { stream, subId, controller }
    const activeStreams = new Map<string, { stream: any; subId: string; controller?: AbortController }>();

    socket.on("watch_runtime_logs", async ({ instanceId, type }) => {
      const subId = `${instanceId}-${type}-${Date.now()}-${Math.random()}`;
      
      // Stop and clean up any old active stream for this specific instance if any exists
      const old = activeStreams.get(instanceId);
      if (old) {
        if (old.stream) {
          try {
            old.stream.destroy();
          } catch (e) {}
        }
        if (old.controller) {
          try {
            old.controller.abort();
          } catch (e) {}
        }
        activeStreams.delete(instanceId);
      }

      // Pre-register current subInfo to block any late-running timers from previous attempts
      activeStreams.set(instanceId, { stream: null, subId });
      
      // Look up container name and node info from database
      let containerName = `mybay-agent-${instanceId}`;
      try {
        const instance = await dbAdapter.getInstanceById(instanceId);
        if (!instance) {
          socket.emit(`runtime_log_${instanceId}`, {
            type,
            line: "安全审计拦截：实例不存在",
            isError: true,
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Authorization check: socket user must be owner or admin
        const socketUser = (socket as any).user;
        const ownerId = instance.owner_id || instance.user_id;
        const isOwner = ownerId === socketUser?.id;
        const isAdmin = socketUser?.role === "admin";
        if (!isOwner && !isAdmin) {
          socket.emit(`runtime_log_${instanceId}`, {
            type,
            line: "安全审计拦截：您无权查看此实例的日志流",
            isError: true,
            timestamp: new Date().toISOString()
          });
          return;
        }

        if (instance.container_name) {
          containerName = instance.container_name;
        }
      } catch (e: any) {
        console.error("[Logger Socket] DB lookup failed:", e.message);
        socket.emit(`runtime_log_${instanceId}`, {
          type,
          line: "安全审计拦截：无法验证实例权限，访问已被拒绝",
          isError: true,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      const container = docker.getContainer(containerName);
      
      let hasWarnedRaft = false;
      const sendLog = (data: Buffer, isError: boolean) => {
        // Double check socket is connected and this subId is still active
        const active = activeStreams.get(instanceId);
        if (socket.disconnected || !active || active.subId !== subId) return;

        const lines = data.toString().split("\n").filter((l: string) => l.trim().length > 0);
        const maskedLines = lines.map((l: string) => sanitizeString(l));
        maskedLines.forEach((line: string) => {
          const lineLower = line.toLowerCase();
          if (lineLower.includes("raft cli not found") || lineLower.includes("raft cli not found in path")) {
            if (hasWarnedRaft) return;
            hasWarnedRaft = true;
          }
          socket.emit(`runtime_log_${instanceId}`, { type, line, isError, timestamp: new Date().toISOString() });
        });
      };

      const maxAttempts = 15;
      const attemptDelay = 3000;

      const tryStreamLogs = (attempt = 1) => {
        // Validate subscription freshness before launching container.logs
        const active = activeStreams.get(instanceId);
        if (socket.disconnected || !active || active.subId !== subId) return;

        container.logs({
          follow: true,
          stdout: true,
          stderr: true,
          tail: 100
        }, (err, stream) => {
          // Re-validate subscription after async container.logs resolution
          const postActive = activeStreams.get(instanceId);
          if (socket.disconnected || !postActive || postActive.subId !== subId) {
            if (stream) {
              try { (stream as any).destroy(); } catch (e) {}
            }
            return;
          }

          if (err || !stream) {
            console.warn(`[Logger Socket] Attempt ${attempt}/${maxAttempts} failed to attach logs for container ${containerName}:`, err?.message || "No stream");
            
            if (err?.message && err.message.toLowerCase().includes("no such container")) {
              socket.emit(`runtime_log_${instanceId}`, { 
                type, 
                line: `容器尚未创建，部署在创建阶段已失败或被中止`, 
                isError: true, 
                timestamp: new Date().toISOString() 
              });
              return;
            }

            // Send feedback on retry to help understand loading state
            socket.emit(`runtime_log_${instanceId}`, { 
              type, 
              line: `无法连接容器 ${containerName} 的日志流，正在初始化中 (第 ${attempt}/${maxAttempts} 次尝试)...`, 
              isError: false, 
              timestamp: new Date().toISOString() 
            });

            if (attempt < maxAttempts) {
              setTimeout(() => {
                tryStreamLogs(attempt + 1);
              }, attemptDelay);
            } else {
              socket.emit(`runtime_log_${instanceId}`, { 
                type, 
                line: `无法连接容器 ${containerName} 的日志流 (原因: ${sanitizeErrorMessage(err?.message) || "连接超时/容器未运行"})`, 
                isError: true, 
                timestamp: new Date().toISOString() 
              });
            }
            return;
          }

          // Register active stream
          activeStreams.set(instanceId, { stream, subId });

          const outStream = new PassThrough();
          const errStream = new PassThrough();

          docker.modem.demuxStream(stream, outStream, errStream);

          outStream.on("data", (chunk: Buffer) => {
            sendLog(chunk, false);
          });

          errStream.on("data", (chunk: Buffer) => {
            sendLog(chunk, true);
          });

          stream.on("end", () => {
            socket.emit(`runtime_log_${instanceId}`, { type, line: "--- Log stream ended ---", isError: false, timestamp: new Date().toISOString() });
          });

          stream.on("error", (e) => {
            console.warn("[Logger Socket] Stream error:", e.message);
            socket.emit(`runtime_log_${instanceId}`, { type, line: `--- 日志暂不可用，正在初始化中 ---`, isError: false, timestamp: new Date().toISOString() });
          });
        });
      };

      tryStreamLogs();
    });

    socket.on("stop_watch_runtime_logs", (data?: { instanceId?: string }) => {
      const targetId = data?.instanceId;
      if (targetId) {
        const active = activeStreams.get(targetId);
        if (active) {
          if (active.stream) {
            try { active.stream.destroy(); } catch (e) {}
          }
          if (active.controller) {
            try { active.controller.abort(); } catch (e) {}
          }
          activeStreams.delete(targetId);
        }
      } else {
        // Fallback for wildcards: clean all active streams on this socket
        for (const [id, value] of activeStreams.entries()) {
          if (value.stream) {
            try { value.stream.destroy(); } catch (e) {}
          }
          if (value.controller) {
            try { value.controller.abort(); } catch (e) {}
          }
        }
        activeStreams.clear();
      }
    });

    socket.on("disconnect", () => {
      for (const [id, value] of activeStreams.entries()) {
        if (value.stream) {
          try { value.stream.destroy(); } catch (e) {}
        }
        if (value.controller) {
          try { value.controller.abort(); } catch (e) {}
        }
      }
      activeStreams.clear();
    });
  });
}

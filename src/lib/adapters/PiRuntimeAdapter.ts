import { 
  AgentRuntimeAdapter, 
  AgentRuntimeType, 
  RuntimeManifest, 
  DeploymentResult, 
  RuntimeStatus, 
  RuntimeLog, 
  HealthResult, 
  AgentResponse, 
  FileResult, 
  BackupResult 
} from "./types";
import { apiFetch } from "../api";

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtimeType: AgentRuntimeType = "pi";

  readonly manifest: RuntimeManifest = {
    name: "pi-agent",
    displayName: "Pi Agent",
    version: "1.0.0",
    runtime: {
      type: "pi",
      image: "ghcr.io/mybay-ai/pi-agent",
      internalPort: 8080,
    },
    health: {
      endpoint: "/health",
      intervalSeconds: 20,
      timeoutSeconds: 5,
    },
    storage: {
      dataPath: "/opt/pi/data",
      configPath: "/opt/pi/config",
    },
    capabilities: {
      chat: true,
      fileUpload: true,
      scheduledTasks: true,
      browser: true,
      shell: true,
      imChannels: ["feishu", "telegram", "discord", "slack", "wechat", "dingtalk"],
    },
    resources: {
      minimumMemory: "512Mi",
      recommendedMemory: "1Gi",
      minimumCpu: 0.5,
    },
    backup: {
      includePaths: ["/opt/pi/data", "/opt/pi/config"],
      excludePatterns: ["*.log", "cache/*"],
    },
  };

  async deploy(config: Record<string, any>): Promise<DeploymentResult> {
    try {
      const data = await apiFetch("/api/instances", {
        method: "POST",
        body: JSON.stringify({
          ...config,
          runtime_type: "pi",
        }),
      });

      return {
        success: true,
        instanceId: data.id || data.instance?.id,
        runtimeType: this.runtimeType,
        endpointUrl: data.url || data.instance?.url,
      };
    } catch (err: any) {
      return {
        success: false,
        runtimeType: this.runtimeType,
        error: err.message || "Network error during deployment",
      };
    }
  }

  async start(instanceId: string): Promise<void> {
    await apiFetch(`/api/instances/${instanceId}/start`, { method: "POST" });
  }

  async stop(instanceId: string): Promise<void> {
    await apiFetch(`/api/instances/${instanceId}/stop`, { method: "POST" });
  }

  async restart(instanceId: string): Promise<void> {
    await apiFetch(`/api/instances/${instanceId}/restart`, { method: "POST" });
  }

  async upgrade(instanceId: string, version: string): Promise<void> {
    await apiFetch(`/api/instances/${instanceId}/upgrade`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  }

  async getStatus(instanceId: string): Promise<RuntimeStatus> {
    const data = await apiFetch(`/api/instances/${instanceId}`);
    return {
      instanceId,
      runtimeType: this.runtimeType,
      status: data.status || "running",
      healthPort: 8080,
      details: data.physical_status,
    };
  }

  async getLogs(instanceId: string, options?: { lines?: number }): Promise<RuntimeLog[]> {
    const lines = options?.lines || 100;
    try {
      const data = await apiFetch(`/api/instances/${instanceId}/logs?lines=${lines}`);
      const rawLogs: string[] = Array.isArray(data.logs) ? data.logs : (data.logs || "").split("\n");
      return rawLogs.filter(Boolean).map((line) => ({
        timestamp: new Date().toISOString(),
        level: line.includes("ERROR") ? "error" : line.includes("WARN") ? "warn" : "info",
        message: line,
        source: "pi-container",
      }));
    } catch (err) {
      return [];
    }
  }

  async getHealth(instanceId: string): Promise<HealthResult> {
    const checkedAt = new Date().toISOString();
    try {
      const data = await apiFetch(`/api/instances/${instanceId}/health`);
      return {
        healthy: data.status === "ok" || data.healthy === true,
        endpoint: "/health",
        checkedAt,
        latencyMs: data.latencyMs,
        message: data.message || "Healthy",
      };
    } catch (err: any) {
      return {
        healthy: false,
        endpoint: "/health",
        checkedAt,
        message: err.message || "Pi Agent health probe failed",
      };
    }
  }

  async sendMessage(instanceId: string, message: string): Promise<AgentResponse> {
    const data = await apiFetch(`/api/instances/${instanceId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    return {
      runId: data.runId || `run_${Date.now()}`,
      content: data.reply || data.content || "",
      status: "completed",
    };
  }

  async uploadFiles(instanceId: string, files: File[]): Promise<FileResult[]> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    const data = await apiFetch(`/api/instances/${instanceId}/upload`, {
      method: "POST",
      body: formData,
    });
    return data.files || [];
  }

  async backup(instanceId: string): Promise<BackupResult> {
    const data = await apiFetch(`/api/instances/${instanceId}/backup`, { method: "POST" });
    return {
      backupId: data.backupId || `backup_${Date.now()}`,
      instanceId,
      sizeBytes: data.sizeBytes || 0,
      createdAt: new Date().toISOString(),
      downloadUrl: data.downloadUrl,
    };
  }

  async restore(instanceId: string, backupId: string): Promise<void> {
    await apiFetch(`/api/instances/${instanceId}/restore`, {
      method: "POST",
      body: JSON.stringify({ backupId }),
    });
  }

  async destroy(instanceId: string): Promise<void> {
    await apiFetch(`/api/instances/${instanceId}`, { method: "DELETE" });
  }
}

export type AgentRuntimeType = 'hermes' | 'pi' | 'openclaw' | 'custom_docker';

export interface RuntimeStatus {
  instanceId: string;
  runtimeType: AgentRuntimeType;
  status: 'deploying' | 'running' | 'stopped' | 'failed' | 'unhealthy';
  uptimeSeconds?: number;
  cpuPercent?: number;
  memoryUsageBytes?: number;
  healthPort?: number;
  details?: string;
}

export interface RuntimeLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

export interface HealthResult {
  healthy: boolean;
  statusCode?: number;
  latencyMs?: number;
  endpoint?: string;
  checkedAt: string;
  message?: string;
}

export interface AgentResponse {
  runId: string;
  content: string;
  status: 'completed' | 'running' | 'failed';
  tokensUsed?: number;
  error?: string;
}

export interface FileResult {
  fileId: string;
  filename: string;
  sizeBytes: number;
  path: string;
}

export interface BackupResult {
  backupId: string;
  instanceId: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl?: string;
}

export interface DeploymentResult {
  success: boolean;
  instanceId?: string;
  runtimeType: AgentRuntimeType;
  endpointUrl?: string;
  error?: string;
}

export interface RuntimeManifest {
  name: string;
  displayName: string;
  version: string;
  runtime: {
    type: AgentRuntimeType;
    image: string;
    internalPort: number;
  };
  health: {
    endpoint: string;
    intervalSeconds: number;
    timeoutSeconds: number;
  };
  storage: {
    dataPath: string;
    configPath: string;
  };
  capabilities: {
    chat: boolean;
    fileUpload: boolean;
    scheduledTasks: boolean;
    browser: boolean;
    shell: boolean;
    imChannels: string[];
  };
  resources: {
    minimumMemory: string;
    recommendedMemory: string;
    minimumCpu: number;
  };
  backup?: {
    includePaths: string[];
    excludePatterns?: string[];
  };
}

export interface AgentRuntimeAdapter {
  readonly runtimeType: AgentRuntimeType;
  readonly manifest: RuntimeManifest;

  deploy(config: Record<string, any>): Promise<DeploymentResult>;
  start(instanceId: string): Promise<void>;
  stop(instanceId: string): Promise<void>;
  restart(instanceId: string): Promise<void>;
  upgrade(instanceId: string, version: string): Promise<void>;

  getStatus(instanceId: string): Promise<RuntimeStatus>;
  getLogs(instanceId: string, options?: { lines?: number }): Promise<RuntimeLog[]>;
  getHealth(instanceId: string): Promise<HealthResult>;

  sendMessage(instanceId: string, message: string): Promise<AgentResponse>;
  uploadFiles(instanceId: string, files: File[]): Promise<FileResult[]>;

  backup(instanceId: string): Promise<BackupResult>;
  restore(instanceId: string, backupId: string): Promise<void>;
  destroy(instanceId: string): Promise<void>;
}

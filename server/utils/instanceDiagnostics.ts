export type DiagnosticStatus = "pass" | "warning" | "fail" | "checking" | "not_applicable";
export type DiagnosticDomain = "container" | "host" | "dashboard" | "chat" | "model" | "channel";
export type DiagnosticRecoveryAction = "view_logs" | "open_instance_settings" | "open_channel_settings" | "open_password_reset" | "redeploy";

export interface InstanceDiagnosticCheck {
  code: string;
  domain: DiagnosticDomain;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  reasonCode?: string;
  suggestion?: string;
  recoveryAction?: DiagnosticRecoveryAction;
  recheckable: boolean;
}

export interface InstanceDiagnosticInput {
  instance: any;
  context: { containerName: string; networkName: string; host_port?: number; internal_web_port: number };
  inspect?: any | null;
  inspectError?: string | null;
  disk?: { totalBytes: number; freeBytes: number; path: string } | null;
}

const EXTERNAL_CHANNELS = new Set([
  "feishu", "lark", "telegram", "discord", "qq", "qq_bot", "slack", "webhook", "api",
  "wecom", "dingtalk", "whatsapp", "wechat_mp", "wechat", "weixin",
]);

function bytesLabel(value: number) {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const gb = value / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(value / (1024 ** 2)).toFixed(0)} MB`;
}

function parseConfig(instance: any): Record<string, any> {
  if (instance?.config_json && typeof instance.config_json === "object") return instance.config_json;
  try { return instance?.config_json ? JSON.parse(instance.config_json) : {}; } catch { return {}; }
}

function configuredExternalChannels(config: Record<string, any>): string[] {
  const configured = config.channel ?? config.configured_channels ?? config.configuredChannels;
  const raw = Array.isArray(configured) ? configured : configured ? [configured] : [];
  return raw.map((value: unknown) => String(value).trim().toLowerCase()).filter((value: string) => EXTERNAL_CHANNELS.has(value));
}

function check(input: Omit<InstanceDiagnosticCheck, "recheckable"> & { recheckable?: boolean }): InstanceDiagnosticCheck {
  return { ...input, recheckable: input.recheckable !== false };
}

export function buildInstanceDiagnosticReport(input: InstanceDiagnosticInput) {
  const { instance, context, inspect, disk } = input;
  const config = parseConfig(instance);
  const checks: InstanceDiagnosticCheck[] = [];
  const running = !!inspect?.State?.Running;
  const status = String(instance.status || "unknown").toLowerCase();

  checks.push(check({
    code: "CONTAINER_STATE", domain: "container", label: "Docker 容器",
    status: running ? "pass" : "fail",
    detail: inspect ? String(inspect.State?.Status || "unknown") : input.inspectError || "容器不存在",
    reasonCode: running ? undefined : "CONTAINER_NOT_RUNNING",
    suggestion: running ? undefined : "确认 Docker Desktop 正在运行，然后在实例操作菜单中重新启动或重新部署。",
    recoveryAction: running ? undefined : "redeploy",
  }));

  const healthStatus = String(inspect?.State?.Health?.Status || "not_configured");
  checks.push(check({
    code: "CONTAINER_HEALTH", domain: "container", label: "容器健康检查",
    status: !inspect ? "fail" : healthStatus === "healthy" ? "pass" : healthStatus === "starting" ? "checking" : healthStatus === "not_configured" ? "warning" : "fail",
    detail: !inspect ? "容器不可用" : healthStatus,
    reasonCode: !inspect ? "CONTAINER_NOT_FOUND" : healthStatus === "healthy" ? undefined : healthStatus === "not_configured" ? "HEALTHCHECK_NOT_CONFIGURED" : "CONTAINER_UNHEALTHY",
    suggestion: healthStatus === "healthy" ? undefined : healthStatus === "not_configured" ? "当前镜像没有上报 Docker Healthcheck，请结合网关探针判断。" : "查看运行日志中的最近错误，并确认模型和网关配置。",
    recoveryAction: healthStatus === "healthy" || healthStatus === "not_configured" ? undefined : "view_logs",
  }));

  const deploymentMode = String(config.deployment_mode || process.env.DEPLOYMENT_MODE || "desktop").toLowerCase();
  const dashboardEnabled = config.enableDashboard !== false;
  const directAccessMode = deploymentMode === "desktop" || deploymentMode === "lan";
  const ports = Object.values(inspect?.NetworkSettings?.Ports || {}).flatMap((bindings: any) => Array.isArray(bindings) ? bindings : []);
  const expectedPort = context.host_port;
  const mapped = !expectedPort || ports.some((binding: any) => Number(binding?.HostPort) === Number(expectedPort));
  const portApplicable = dashboardEnabled && directAccessMode;
  checks.push(check({
    code: "PORT_MAPPING", domain: "dashboard", label: "本地访问端口",
    status: !portApplicable ? "not_applicable" : mapped ? "pass" : "fail",
    detail: !dashboardEnabled ? "Dashboard 访问已关闭" : !directAccessMode ? "Server 模式由反向代理提供访问" : expectedPort ? (mapped ? `宿主机端口 ${expectedPort} 已映射` : `未找到宿主机端口 ${expectedPort} 的映射`) : "无需固定宿主机端口",
    reasonCode: portApplicable && !mapped ? "PORT_MAPPING_MISSING" : undefined,
    suggestion: portApplicable && !mapped ? "端口映射可能被旧容器占用；注销残留容器后重新部署，系统会自动选择下一可用端口。" : undefined,
    recoveryAction: portApplicable && !mapped ? "redeploy" : undefined,
  }));

  const networks = Object.keys(inspect?.NetworkSettings?.Networks || {});
  const networkOk = networks.includes(context.networkName);
  checks.push(check({
    code: "DOCKER_NETWORK", domain: "container", label: "Docker 网络", status: networkOk ? "pass" : "fail",
    detail: networks.length ? networks.join(", ") : "未连接任何网络",
    reasonCode: networkOk ? undefined : "DOCKER_NETWORK_MISSING",
    suggestion: networkOk ? undefined : `实例应连接网络 ${context.networkName}；建议重新部署以恢复网络拓扑。`,
    recoveryAction: networkOk ? undefined : "redeploy",
  }));

  if (disk) {
    const ratio = disk.totalBytes > 0 ? disk.freeBytes / disk.totalBytes : 0;
    const diskStatus: DiagnosticStatus = disk.freeBytes < 256 * 1024 * 1024 ? "fail" : ratio < 0.1 || disk.freeBytes < 1024 ** 3 ? "warning" : "pass";
    checks.push(check({
      code: "DISK_SPACE", domain: "host", label: "宿主机磁盘空间", status: diskStatus,
      detail: `${bytesLabel(disk.freeBytes)} 可用 / ${bytesLabel(disk.totalBytes)}`,
      reasonCode: diskStatus === "pass" ? undefined : diskStatus === "fail" ? "DISK_SPACE_CRITICAL" : "DISK_SPACE_LOW",
      suggestion: diskStatus === "pass" ? undefined : "清理无用镜像、旧发布包或实例输出文件后再执行部署和升级。",
    }));
  } else {
    checks.push(check({ code: "DISK_SPACE", domain: "host", label: "宿主机磁盘空间", status: "warning", detail: "无法读取磁盘空间", reasonCode: "DISK_SPACE_UNAVAILABLE", suggestion: "确认实例数据目录存在并允许控制面板读取。" }));
  }

  const physicalStatus = String(instance.physical_status || "unknown");
  const physicalOk = !instance.physical_error && !["failed", "missing", "degraded"].includes(physicalStatus.toLowerCase());
  checks.push(check({
    code: "PHYSICAL_STATE", domain: "container", label: "物理状态一致性", status: physicalOk ? "pass" : "fail",
    detail: instance.physical_error || physicalStatus, reasonCode: physicalOk ? undefined : "PHYSICAL_STATE_DIVERGED",
    suggestion: physicalOk ? undefined : "等待协调器完成一次检查；若仍未恢复，请查看实例事件中的错误码。",
    recoveryAction: physicalOk ? undefined : "view_logs",
  }));

  const dashboardAuthReady = !!(config.password && config.webPasswordHash && config.dashboardAuthSecret && config.hermesDashboardAuthSecret);
  checks.push(check({
    code: "DASHBOARD_AUTH", domain: "dashboard", label: "Dashboard 访问保护",
    status: !dashboardEnabled ? "not_applicable" : dashboardAuthReady ? "pass" : "fail",
    detail: !dashboardEnabled ? "Dashboard 访问已关闭" : dashboardAuthReady ? "认证配置完整" : "认证配置缺失或尚未生效",
    reasonCode: dashboardEnabled && !dashboardAuthReady ? "DASHBOARD_AUTH_INCOMPLETE" : undefined,
    suggestion: dashboardEnabled && !dashboardAuthReady ? "在实例操作菜单中重置访问密码，使认证配置重新写入，然后重新检测。" : undefined,
    recoveryAction: dashboardEnabled && !dashboardAuthReady ? "open_password_reset" : undefined,
  }));

  const gatewayReady = instance.gateway_ready === true;
  const gatewayFailed = ["unhealthy", "error", "channel_adapter_failed"].includes(String(instance.gateway_status || "").toLowerCase()) || !!instance.gateway_error;
  checks.push(check({
    code: "GATEWAY", domain: "chat", label: "Agent 网关",
    status: gatewayReady ? "pass" : gatewayFailed ? "fail" : running ? "checking" : "fail",
    detail: instance.gateway_error || instance.gateway_status || (running ? "正在初始化" : "容器未运行"),
    reasonCode: gatewayReady ? undefined : gatewayFailed ? "GATEWAY_UNHEALTHY" : "GATEWAY_INITIALIZING",
    suggestion: gatewayReady ? undefined : gatewayFailed ? "查看运行日志中的网关错误；修复配置后重新检测。" : "等待网关完成初始化，然后重新检测。",
    recoveryAction: gatewayFailed ? "view_logs" : undefined,
  }));

  const provider = String(instance.model_provider || config.provider || "").trim();
  const model = String(instance.model_name || config.model || "").trim();
  const modelConfigStatus = String(instance.model_config_status || "unknown").toLowerCase();
  const modelConfigured = !!provider;
  const modelConfigPass = ["verified", "verified_by_runtime_session", "verification_auth_required"].includes(modelConfigStatus);
  const modelConfigFail = ["failed", "mismatched"].includes(modelConfigStatus);
  checks.push(check({
    code: "MODEL_CONFIG", domain: "model", label: "模型配置",
    status: !modelConfigured ? "not_applicable" : modelConfigPass ? "pass" : modelConfigFail ? "fail" : "checking",
    detail: !modelConfigured ? "未配置 LLM，跳过校验" : `${provider}${model ? ` / ${model}` : ""} · ${modelConfigStatus}`,
    reasonCode: modelConfigFail ? "MODEL_CONFIG_UNAVAILABLE" : modelConfigured && !modelConfigPass ? "MODEL_CONFIG_VERIFYING" : undefined,
    suggestion: modelConfigFail ? "打开实例参数设置，核对凭据、模型名和 Base URL，保存后重新检测。" : modelConfigured && !modelConfigPass ? "模型配置正在同步或等待首次运行验证。" : undefined,
    recoveryAction: modelConfigFail ? "open_instance_settings" : undefined,
  }));

  const runtimeStatus = String(instance.model_runtime_status || "unknown").toLowerCase();
  const runtimeError = instance.model_runtime_error || instance.model_runtime_details;
  checks.push(check({
    code: "MODEL_RUNTIME", domain: "model", label: "模型运行链路",
    status: !modelConfigured ? "not_applicable" : runtimeStatus === "callable" ? "pass" : runtimeError ? "fail" : "checking",
    detail: !modelConfigured ? "未配置 LLM，跳过校验" : runtimeError || runtimeStatus,
    reasonCode: modelConfigured && runtimeStatus !== "callable" ? runtimeError ? "MODEL_RUNTIME_UNAVAILABLE" : "MODEL_RUNTIME_NOT_TESTED" : undefined,
    suggestion: runtimeError ? "先测试模型连接；若配置已更新，请保存并重启容器后重新检测。" : modelConfigured && runtimeStatus !== "callable" ? "等待一次真实会话或模型探针完成验证。" : undefined,
    recoveryAction: runtimeError ? "open_instance_settings" : undefined,
  }));

  const channels = configuredExternalChannels(config);
  const configuredCount = Number(instance.configured_channels ?? channels.length);
  const connectedCount = Number(instance.connected_channels || 0);
  const channelStatuses = instance.channel_status && typeof instance.channel_status === "object" ? instance.channel_status : {};
  const connectedFromStatus = Object.values(channelStatuses).filter((value: any) => ["connected", "ready", "running"].includes(String(value?.status || value).toLowerCase())).length;
  const effectiveConnectedCount = Math.max(connectedCount, connectedFromStatus);
  const channelFailure = Object.values(channelStatuses).some((value: any) => ["config_missing", "auth_failed", "unhealthy", "error", "failed"].includes(String(value?.status || value).toLowerCase()));
  const hasChannels = channels.length > 0 || configuredCount > 0;
  const channelsReady = hasChannels && configuredCount > 0 && effectiveConnectedCount >= configuredCount;
  checks.push(check({
    code: "CHANNEL", domain: "channel", label: "通讯渠道",
    status: !hasChannels ? "not_applicable" : channelsReady ? "pass" : channelFailure ? "fail" : "checking",
    detail: !hasChannels ? "当前实例仅使用 Web 对话" : `${effectiveConnectedCount}/${configuredCount || channels.length} 个渠道已连接`,
    reasonCode: channelFailure ? "CHANNEL_CONFIG_UNAVAILABLE" : hasChannels && !channelsReady ? "CHANNEL_CONNECTING" : undefined,
    suggestion: channelFailure ? "打开渠道设置检查 App 凭据、权限和回调配置，保存后重新检测。" : hasChannels && !channelsReady ? "等待渠道适配器连接；如长时间无变化，请查看实时运行日志。" : undefined,
    recoveryAction: channelFailure ? "open_channel_settings" : undefined,
  }));

  const chatReady = gatewayReady && modelConfigured && modelConfigPass && (!hasChannels || channelsReady) && status === "running";
  const chatConfigurationFailed = !modelConfigured || modelConfigFail || channelFailure;
  checks.push(check({
    code: "CHAT_READINESS", domain: "chat", label: "实例对话就绪",
    status: chatReady ? "pass" : chatConfigurationFailed ? "fail" : gatewayReady ? "checking" : gatewayFailed ? "fail" : "checking",
    detail: chatReady ? "实例运行与对话链路均已就绪" : chatConfigurationFailed ? "实例已运行，但对话配置需要处理" : gatewayReady ? "实例运行中，对话正在初始化" : "等待 Agent 网关就绪",
    reasonCode: chatReady ? undefined : !modelConfigured ? "MODEL_CONFIG_REQUIRED" : modelConfigFail ? "MODEL_CONFIG_UNAVAILABLE" : channelFailure ? "CHANNEL_CONFIG_UNAVAILABLE" : gatewayFailed ? "CHAT_ROUTE_UNAVAILABLE" : "CHAT_INITIALIZING",
    suggestion: chatReady ? undefined : chatConfigurationFailed ? "先处理上方失败的模型或渠道检查项，然后重新检测。" : "等待初始化完成；页面会自动对账最新状态。",
    recoveryAction: chatReady ? undefined : !modelConfigured || modelConfigFail ? "open_instance_settings" : channelFailure ? "open_channel_settings" : gatewayFailed ? "view_logs" : undefined,
  }));

  return {
    generatedAt: new Date().toISOString(),
    instance: { id: instance.id, name: instance.name, status: instance.status, desiredState: instance.desired_state || null },
    capabilities: { deploymentMode, dashboardEnabled, modelConfigured, externalChannels: channels },
    container: { name: context.containerName, id: inspect?.Id || null, image: inspect?.Config?.Image || null, networks },
    checks,
    summary: {
      passed: checks.filter((item) => item.status === "pass").length,
      warnings: checks.filter((item) => item.status === "warning").length,
      failed: checks.filter((item) => item.status === "fail").length,
      checking: checks.filter((item) => item.status === "checking").length,
      notApplicable: checks.filter((item) => item.status === "not_applicable").length,
      applicable: checks.filter((item) => item.status !== "not_applicable").length,
    },
  };
}

export type DiagnosticStatus = "pass" | "warning" | "fail";

export interface InstanceDiagnosticCheck {
  code: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  suggestion?: string;
}

export interface InstanceDiagnosticInput {
  instance: any;
  context: { containerName: string; networkName: string; host_port?: number; internal_web_port: number };
  inspect?: any | null;
  inspectError?: string | null;
  disk?: { totalBytes: number; freeBytes: number; path: string } | null;
}

function bytesLabel(value: number) {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const gb = value / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(value / (1024 ** 2)).toFixed(0)} MB`;
}

export function buildInstanceDiagnosticReport(input: InstanceDiagnosticInput) {
  const { instance, context, inspect, disk } = input;
  const checks: InstanceDiagnosticCheck[] = [];
  const running = !!inspect?.State?.Running;
  checks.push({
    code: "CONTAINER_STATE",
    label: "Docker 容器",
    status: running ? "pass" : "fail",
    detail: inspect ? String(inspect.State?.Status || "unknown") : input.inspectError || "容器不存在",
    suggestion: running ? undefined : "确认 Docker Desktop 正在运行，然后在实例操作菜单中重新启动或重新部署。",
  });

  const healthStatus = String(inspect?.State?.Health?.Status || "not_configured");
  checks.push({
    code: "CONTAINER_HEALTH",
    label: "容器健康检查",
    status: healthStatus === "healthy" ? "pass" : healthStatus === "not_configured" ? "warning" : "fail",
    detail: healthStatus,
    suggestion: healthStatus === "healthy" ? undefined : healthStatus === "not_configured" ? "当前镜像没有上报 Docker Healthcheck，请结合网关探针判断。" : "查看运行日志中的最近错误，并确认模型和网关配置。",
  });

  const ports = Object.values(inspect?.NetworkSettings?.Ports || {}).flatMap((bindings: any) => Array.isArray(bindings) ? bindings : []);
  const expectedPort = context.host_port;
  const mapped = !expectedPort || ports.some((binding: any) => Number(binding?.HostPort) === Number(expectedPort));
  checks.push({
    code: "PORT_MAPPING",
    label: "端口映射",
    status: mapped ? "pass" : "fail",
    detail: expectedPort ? (mapped ? `宿主机端口 ${expectedPort} 已映射` : `未找到宿主机端口 ${expectedPort} 的映射`) : "由反向代理网络提供访问",
    suggestion: mapped ? undefined : "端口映射可能被旧容器占用；注销残留容器后重新部署，系统会自动选择下一可用端口。",
  });

  const networks = Object.keys(inspect?.NetworkSettings?.Networks || {});
  const networkOk = networks.includes(context.networkName);
  checks.push({
    code: "DOCKER_NETWORK",
    label: "Docker 网络",
    status: networkOk ? "pass" : "fail",
    detail: networks.length ? networks.join(", ") : "未连接任何网络",
    suggestion: networkOk ? undefined : `实例应连接网络 ${context.networkName}；建议重新部署以恢复网络拓扑。`,
  });

  if (disk) {
    const ratio = disk.totalBytes > 0 ? disk.freeBytes / disk.totalBytes : 0;
    const diskStatus: DiagnosticStatus = disk.freeBytes < 256 * 1024 * 1024 ? "fail" : ratio < 0.1 || disk.freeBytes < 1024 ** 3 ? "warning" : "pass";
    checks.push({
      code: "DISK_SPACE",
      label: "宿主机磁盘空间",
      status: diskStatus,
      detail: `${bytesLabel(disk.freeBytes)} 可用 / ${bytesLabel(disk.totalBytes)}`,
      suggestion: diskStatus === "pass" ? undefined : "清理无用镜像、旧发布包或实例输出文件后再执行部署和升级。",
    });
  } else {
    checks.push({ code: "DISK_SPACE", label: "宿主机磁盘空间", status: "warning", detail: "无法读取磁盘空间", suggestion: "确认实例数据目录存在并允许控制面板读取。" });
  }

  const physicalStatus = String(instance.physical_status || "unknown");
  const physicalOk = !instance.physical_error && !["failed", "missing", "degraded"].includes(physicalStatus.toLowerCase());
  checks.push({
    code: "PHYSICAL_STATE",
    label: "物理状态一致性",
    status: physicalOk ? "pass" : "fail",
    detail: instance.physical_error || physicalStatus,
    suggestion: physicalOk ? undefined : "等待协调器完成一次检查；若仍未恢复，请查看实例事件中的错误码。",
  });

  return {
    generatedAt: new Date().toISOString(),
    instance: { id: instance.id, name: instance.name, status: instance.status, desiredState: instance.desired_state || null },
    container: { name: context.containerName, id: inspect?.Id || null, image: inspect?.Config?.Image || null, networks },
    checks,
    summary: {
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: checks.filter((check) => check.status === "warning").length,
      failed: checks.filter((check) => check.status === "fail").length,
    },
  };
}

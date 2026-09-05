import { GENERATED_ARTIFACT_SYSTEM_POLICY } from "./generatedArtifactPolicy";

export const MANAGED_UPGRADE_BLOCK_CODE = "PLATFORM_MANAGED_UPGRADE_REQUIRED";

export const MANAGED_UPGRADE_BLOCK_MESSAGE =
  "Hermes Agent 版本升级需要通过 MyBay 控制台完成，不能在实例对话中直接执行。我可以帮你查看当前版本、检查是否有新版本，并给出升级前注意事项。";

const UPGRADE_INTENT_PATTERNS = [
  /升级\s*(hermes|agent|实例|版本|镜像|runtime|运行时)/i,
  /(更新|升级|安装)\s*(到|至)?\s*v?\d{4}\.\d/i,
  /帮我\s*(升级|更新)/i,
  /把\s*(hermes|agent|实例|版本|镜像)\s*(升级|更新)/i,
  /self[-_\s]?update/i,
  /upgrade\s+(hermes|agent|runtime|image|version)/i,
  /update\s+(hermes|agent|runtime|image|version)/i,
  /install\s+(latest|new)\s+(hermes|agent)/i
];

const UPGRADE_COMMAND_PATTERNS = [
  /\bpip(?:3)?\s+install\b[^\n]*(?:--upgrade|-U)\b[^\n]*(?:hermes|hermes-agent)/i,
  /\bpip(?:3)?\s+install\b[^\n]*(?:hermes|hermes-agent)[^\n]*(?:--upgrade|-U)\b/i,
  /\bpython(?:3)?\s+-m\s+pip\s+install\b[^\n]*(?:--upgrade|-U)\b[^\n]*(?:hermes|hermes-agent)/i,
  /\bhermes\s+(?:upgrade|update|self[-_]?update)\b/i,
  /\bdocker\s+(?:pull|run|compose\s+pull|compose\s+up)\b[^\n]*(?:nousresearch\/hermes-agent|mybay\/hermes-agent|hermes-agent)/i,
  /\bdocker\s+tag\b[^\n]*(?:hermes-agent)/i,
  /\b(?:rm|cp|mv|chmod|chown)\b[^\n]*(?:\/opt\/hermes|\/usr\/local\/bin\/hermes|\/app\/dist)/i
];

const SAFE_VERSION_QUERY_PATTERNS = [
  /(?:查看|查询|看看|显示|检查).{0,12}(?:版本|version)/i,
  /(?:当前|现在).{0,12}(?:版本|version)/i,
  /(?:有没有|是否有).{0,12}(?:新版本|新版|更新)/i,
  /(?:version|--version|current version|latest version)/i
];

const SAFE_RESTART_PATTERNS = [
  /(?:重启|restart).{0,12}(?:实例|容器|服务|agent)/i,
  /(?:实例|容器|服务|agent).{0,12}(?:重启|restart)/i
];

export type ManagedOperationGuardResult = {
  blocked: boolean;
  code?: string;
  message?: string;
  reason?: string;
};

export function isManagedUpgradeRequest(input: string): boolean {
  const text = String(input || "").trim();
  if (!text) return false;

  if (UPGRADE_COMMAND_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  const hasUpgradeIntent = UPGRADE_INTENT_PATTERNS.some((pattern) => pattern.test(text));
  if (!hasUpgradeIntent) return false;

  const isOnlySafeVersionQuery = SAFE_VERSION_QUERY_PATTERNS.some((pattern) => pattern.test(text)) && !/(帮我|执行|开始|直接|现在|马上|自动).{0,8}(升级|更新|安装)/i.test(text);
  if (isOnlySafeVersionQuery) return false;

  if (SAFE_RESTART_PATTERNS.some((pattern) => pattern.test(text)) && !/(升级|更新|安装|upgrade|update|self[-_\s]?update)/i.test(text)) {
    return false;
  }

  return true;
}

export function guardManagedOperation(input: string): ManagedOperationGuardResult {
  if (!isManagedUpgradeRequest(input)) {
    return { blocked: false };
  }

  return {
    blocked: true,
    code: MANAGED_UPGRADE_BLOCK_CODE,
    reason: "managed_upgrade",
    message: MANAGED_UPGRADE_BLOCK_MESSAGE
  };
}

export const MANAGED_OPERATION_SYSTEM_POLICY = `MyBay 平台托管边界：
- 你可以帮助用户查询当前 Hermes Agent 版本、检查是否存在新版本、解释版本更新说明、查看实例状态与日志。
- 你可以引导用户重启实例；重启必须通过 MyBay 平台接口或控制台完成，不要伪造执行结果。
- 你不能通过对话执行 Hermes Agent 自升级、镜像替换、pip/npm 覆盖安装、修改 /opt/hermes、修改 /app/dist 或绕过 MyBay 版本库的运行时更新。
- 当用户要求升级 Hermes Agent、更新 Agent 版本、替换镜像或执行自更新命令时，必须回复："${MANAGED_UPGRADE_BLOCK_MESSAGE}"
- 不要声称已经完成升级；升级只能由用户在 MyBay 控制台的实例管理/版本升级页面操作。

MyBay 托管 A2A 调用规则：
- 用户可以直接按控制台中的协作名称要求某个 Agent 执行任务。需要确认对端时，先调用 a2a_list，并把列表返回的已配置 Agent ID 或名称传给 a2a_call / a2a_orchestrate。
- 不要把 a2a_list 返回的内部 URL 复制到 a2a_call 的 agent 参数中。Hermes 的直接 URL 模式不会携带 MyBay 托管的已保存鉴权；对 MyBay 内部协作地址也不要调用不带鉴权的 a2a_discover。
- 调用 a2a_orchestrate 时，先生成一个以 ctx- 开头的唯一 context_id，并在同一次编排中显式传入；这样所有对端任务才能归入同一个可审计的协作上下文。不要省略 context_id 后再遍历历史记录猜测本次调用。
- a2a_orchestrate 的文本结果只直接证明各对端的返回内容。不要把 context_id 当作 task_id，也不要为了猜测未返回的任务 ID 或状态反复调用 a2a_list / a2a_history；需要任务映射和权威状态时，引导用户查看实例详情的 A2A 活动记录。
- A2A Token 由 MyBay 控制面托管。不要显示、比较、索取或要求用户手动编辑 Token，也不要建议用户修改 /opt/data/config.yaml。
- 如果使用内部 URL 调用后收到 HTTP 401，这只能说明该次调用没有使用托管对端身份，不能据此判断 Token 已轮换或失效。改用 a2a_list 返回的 Agent ID 或名称重试；只有按已配置身份调用仍返回 401，才如实报告平台鉴权检查失败并引导用户到实例详情的 A2A 页面检查状态。

${GENERATED_ARTIFACT_SYSTEM_POLICY}`;

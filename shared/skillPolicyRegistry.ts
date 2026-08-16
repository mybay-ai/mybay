
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RuntimeStatus = 'available' | 'beta' | 'coming_soon' | 'admin_only';

export interface SkillPolicy {
  id: string;
  name: string;
  riskLevel: RiskLevel;
  enabledByDefault: boolean;
  userSelectable: boolean;
  adminOnly: boolean;
  requiresConfirmation: boolean;
  requiresSandbox: boolean;
  allowedInProduction: boolean;
  requiredRuntimeGuards: string[];
  warningText: string;
  desc: string;
  requiresKey?: string;
  label?: string;
  placeholder?: string;
  runtimeStatus: RuntimeStatus;
}

export const skillPolicyRegistry: Record<string, SkillPolicy> = {
  browser: {
    id: 'browser',
    name: 'Browser 网页抓取',
    riskLevel: 'high',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: true,
    requiresSandbox: true,
    allowedInProduction: true,
    requiredRuntimeGuards: [
      'restrict-localhost',
      'restrict-internal-network',
      'restrict-metadata-service',
      'ephemeral-profile'
    ],
    warningText: '受限网络访问：禁止访问内网地址与 Metadata 服务。使用临时 Profile。',
    desc: '内置 Chrome 高级网页浏览与网页抓取，支持浏览、模拟点击及全屏幕截图。',
    runtimeStatus: 'coming_soon'
  },
  shell: {
    id: 'shell',
    name: 'Shell 沙箱终端',
    riskLevel: 'high',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: true,
    requiresSandbox: true,
    allowedInProduction: true,
    requiredRuntimeGuards: [
      'non-root-user',
      'no-docker-socket',
      'mount-workspace-only',
      'no-new-privileges',
      'drop-all-capabilities',
      'resource-limits',
      'command-timeout'
    ],
    warningText: '高危能力：必须在独立沙箱容器中运行，仅允许访问实例 Workspace，并禁止挂载 Docker Socket。启用前需要用户明确确认授权。',
    desc: '获取隔离沙盒执行系统 Shell 命令、运行脚本、安装依赖包权限。',
    runtimeStatus: 'coming_soon'
  },
  file_system: {
    id: 'file_system',
    name: 'File System 文件读写',
    riskLevel: 'high',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: true,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: [
      'workspace-root-only',
      'path-traversal-protection',
      'zip-slip-protection',
      'audit-logging'
    ],
    warningText: '高危能力：仅允许访问实例 Workspace。禁止访问系统敏感目录。所有操作将被审计。',
    desc: '拥有本实例专属运行目录的高吞吐文件读、写、修改和解压缩权限。',
    runtimeStatus: 'coming_soon'
  },
  file_read: {
    id: 'file_read',
    name: 'File Read 文件和分稿检索',
    riskLevel: 'low',
    enabledByDefault: true,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: false,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: [],
    warningText: '无敏感安全风险：仅用于解析用户主动上传的文本、PDF 或多媒体输入数据。',
    desc: '允许智能体读取和解析用户上传的特定格式媒体、文档与脚本文案，进行结构化剖析。',
    runtimeStatus: 'available'
  },
  docker: {
    id: 'docker',
    name: 'Docker Engine 容器连接',
    riskLevel: 'critical',
    enabledByDefault: false,
    userSelectable: false,
    adminOnly: true,
    requiresConfirmation: true,
    requiresSandbox: false,
    allowedInProduction: false,
    requiredRuntimeGuards: [
      'admin-audit',
      'explicit-confirmation-text'
    ],
    warningText: '极高危 / 管理员专用：Docker Engine 访问可能等同于宿主机 root 权限。请确保仅在受控环境下启用。',
    desc: '连接控制主机的 Docker Socket，用于动态启动和调度其他微服务。',
    runtimeStatus: 'admin_only'
  },
  crypto: {
    id: 'crypto',
    name: 'Web3 & 合约智能工具',
    riskLevel: 'low',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: false,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: [],
    warningText: '',
    desc: '装配智能合约调试、数字签名和以太坊/Solidity 合约调用沙盒。',
    runtimeStatus: 'coming_soon'
  },
  custom_webhooks: {
    id: 'custom_webhooks',
    name: 'HTTP Webhook 触发插件',
    riskLevel: 'medium',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: false,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: ['egress-filtering'],
    warningText: '可能涉及外部数据传输，请确保 Webhook 地址可信。',
    desc: '允许 Agent 调用外部通用 Webhook 接口、传输 JSON 并轮询响应。',
    runtimeStatus: 'coming_soon'
  },
  tavily_search: {
    id: 'tavily_search',
    name: 'Tavily AI 智能搜索',
    riskLevel: 'low',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: false,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: [],
    warningText: '',
    desc: 'AI 时代的专业搜索引擎，过滤噪声并一键提炼整洁的结构化语料。',
    requiresKey: 'skillTavilyApiKey',
    label: 'Tavily API Key',
    placeholder: '不填保持现有 (tvly-...)',
    runtimeStatus: 'available'
  },
  google_search: {
    id: 'google_search',
    name: 'Google Serper 全局快搜',
    riskLevel: 'low',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: false,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: [],
    warningText: '',
    desc: '基于谷歌生态的极速 Serper API 提取全球谷歌热搜和高质量结果。',
    requiresKey: 'skillSerperApiKey',
    label: 'Serper.dev API Key',
    placeholder: '不填保持现有',
    runtimeStatus: 'available'
  },
  github: {
    id: 'github',
    name: 'GitHub 仓库与 Issue 流水线',
    riskLevel: 'medium',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: false,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: ['token-scope-protection'],
    warningText: '将使用您的 PAT 访问代码库 environment。',
    desc: '自动化对指定托管库进行 Issue 诊断、提交代码以及创建并发 PR。',
    requiresKey: 'skillGithubToken',
    label: 'GitHub Personal Access Token (PAT)',
    placeholder: '不填保持现有 (ghp_...)',
    runtimeStatus: 'coming_soon'
  },
  feishu: {
    id: 'feishu',
    name: 'Feishu 飞书开放平台集成',
    riskLevel: 'medium',
    enabledByDefault: false,
    userSelectable: true,
    adminOnly: false,
    requiresConfirmation: true,
    requiresSandbox: false,
    allowedInProduction: true,
    requiredRuntimeGuards: ['token-scope-protection'],
    warningText: '涉及飞书群聊消息读取与推送权限，请确保 App ID 与 Secret 正确。',
    desc: '允许 Agent 连接飞书开放平台自建应用，实现消息回传、富文本卡片推送、多维表格操作等自动化能力。',
    runtimeStatus: 'coming_soon'
  }
};




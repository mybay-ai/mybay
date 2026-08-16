export interface Credential {
  id: string;
  name: string;
  type: string;
  key: string;
  baseUrl?: string;
  isCustom?: boolean;
  owner?: string;
  createdAt: string;
  secretLabel?: string;
  hasSecret?: boolean;
  provider?: string;
  providerLabel?: string;
  verificationStatus?: 'untested' | 'verified' | 'failed';
  verifiedAt?: string | null;
}

export interface AgentInstance {
  id: string;
  name: string;
  path: string;
  runtime_type?: string;
  status: "deploying" | "initializing" | "running" | "partial_running" | "stopped" | "failed" | "restarting" | "container_starting" | "dashboard_ready" | "gateway_starting" | "gateway_syncing" | "gateway_ready" | "unhealthy" | "frontend_missing_build" | "deleting" | "archiving" | "archived" | "cleanup_failed";
  url: string;
  createdAt: string;
  config?: any;
  cleanupStatus?: "queued" | "cleaning" | "retry_wait" | "failed" | "success" | null;
  cleanupStep?: string | null;
  cleanupErrorCode?: string | null;
  cleanupErrorMessage?: string | null;
  cleanupNextRetryAt?: string | null;
  config_json?: string; // Deprecated: use configSummary
  configSummary?: {
    provider?: string | null;
    model?: string | null;
    baseUrl?: string | null;
    channel?: string;
    skills?: string[];
    limitsCpu?: string;
    limitsMem?: string;
    agentPrompt?: string;
    agentPromptPreview?: string;
    enableDashboard?: boolean;
    hasPassword?: boolean;
    authMode?: string;
    accessProtectionLabel?: string;
    configuredChannels?: string[];
    channelLabel?: string;
    allowMode?: string;
    templateName?: string | null;
    storageExceeded?: boolean;
    telegramAllowedUsers?: string;
    discordAllowedGuilds?: string;
    feishuAppId?: string;
    feishuRegion?: string;
    qqBotAppId?: string;
    qqBotAllowedUsers?: string;
    qqBotAllowedGuilds?: string;
    qqBotAllowedChannels?: string;
    whatsappPhoneNumberId?: string;
    whatsappAllowedUsers?: string;
    whatsappAllowedChannels?: string;
    dingtalkAppKey?: string;
    dingtalkAllowedUsers?: string;
    dingtalkAllowedChats?: string;
    wechatMpAppId?: string;
    wechatMpToken?: string;
    wechatMpEncodingAesKey?: string;
    wechatMpAllowedUsers?: string;
    wechatMpAllowedChats?: string;
    wecomAppId?: string;
    wecomToken?: string;
    wecomEncodingAesKey?: string;
    wecomAgentId?: string;
    wecomAllowedUsers?: string;
    wecomAllowedChats?: string;
    weixinAccountId?: string;
    weixinBaseUrl?: string;
    weixinAllowedUsers?: string;
    weixinAllowedChats?: string;
    webhookUrl?: string;
    configChecks?: {
      provider: { value: string; status: string; type: string; isValid: boolean };
      model: { value: string; status: string; type: string; isValid: boolean };
      baseUrl: { value: string; status: string; type: string; isValid: boolean };
      providerApiKey: { configured: boolean; label: string; status: string; type: string };
    };
    pet?: {
      enabled?: boolean;
      slug?: string;
      render_mode?: string;
      scale?: number;
    };
  };
  allowMode?: string;
  proxyMode?: 'local' | 'lan' | 'traefik' | 'nginx';
  showDebugProxyCommands?: boolean;
  traefikNetwork?: string;
  owner?: string;
  started_at?: string;
  archived?: boolean;
  agent_image?: string;
  agent_image_tag?: string;
  agent_version?: string;
  resolved_version?: string;
  deployment_error?: string;
  physical_status?: string;
  physical_error?: string | null;
  last_reconciled_at?: string;
  model_provider?: string | null;
  model_name?: string | null;
  model_base_url?: string | null;
  model_config_status?: 'pending' | 'written' | 'injected' | 'verified' | 'verified_by_runtime_session' | 'verification_auth_required' | 'mismatched' | 'failed' | null;
  model_config_error?: string | null;
  container_status?: string | null;
  proxy_status?: string | null;
  model_options_status?: string | null;
  model_options_error?: string | null;
  model_runtime_status?: string | null;
  model_runtime_error?: string | null;
  model_runtime_details?: string | null;
  gateway_status?: string;
  gateway_ready?: boolean;
  gateway_checked_at?: string | null;
  gateway_error?: string | null;
  gateway_services?: Record<string, string> | null;
  configured_channels?: number | null;
  connected_channels?: number | null;
  channel_status?: Record<string, string> | null;
  limitsDisk?: string;
  accessBridgeCompatibility?: {
    required: boolean;
    compatible: boolean;
    reason?: "missing_session_complete_router" | "missing_console_service" | "missing_priority" | "has_forwardauth_on_session_complete" | "unknown";
    actionRequired?: "redeploy";
  };
}

export interface OverviewStats {
  totalInstances: number;
  runningInstances: number;
  stoppedInstances: number;
  deployingInstances: number;
  cpuUsage: number;
  memTotal: number;
  memUsed: number;
  diskTotal: number;
  diskUsed: number;
  activeUsers?: number;
}

export interface InstanceStats {
  cpu: number | string;
  memory: number | string;
  memoryPercent?: number;
  status?: string;
  uptime?: number;
  dockerStartedAt?: string | null;
  isRunning?: boolean;
  storageUsedBytes?: number | null;
  storageLimitBytes?: number | null;
  storageUsagePercent?: number | null;
  storageStatus?: "normal" | "warning" | "exceeded" | "unknown";
  storageExceeded?: boolean;
  storageCheckedAt?: string | null;
  error?: string | null;
  message?: string | null;
  accessBridgeCompatibility?: {
    required: boolean;
    compatible: boolean;
    reason?: "missing_session_complete_router" | "missing_console_service" | "missing_priority" | "has_forwardauth_on_session_complete" | "unknown";
    actionRequired?: "redeploy";
  };
}

export interface SetupFormData {
  id?: string;
  runtime_type?: string;
  allowMode?: string;
  // Step 1
  name: string;
  path: string;
  username: string;
  password?: string;
  // Step 2
  image: string;
  imageTag: string;
  port: string;
  enableDashboard: boolean;
  enableApi: boolean;
  apiKey: string;
  limitsCpu?: string;
  limitsMem?: string;
  // Step 3
  provider: string;
  model: string;
  modelBillingMode?: "byok" | "platform";
  platformModelId?: string;
  platformModelName?: string;
  modelCreditMultiplier?: number;
  modelInputCreditMultiplier?: number;
  modelOutputCreditMultiplier?: number;
  providerApiKey?: string;
  providerCredentialId?: string;
  baseUrl?: string;
  isCustomModel?: boolean;
  // Step 4
  channel: string;
  // channel config
  channelMode?: "testing" | "production";
  gatewayAllowAllUsers?: boolean;
  telegramBotToken?: string;
  telegramAllowedUsers?: string;
  telegramAllowedChats?: string;
  discordBotToken?: string;
  discordAllowedGuilds?: string;
  discordAllowedUsers?: string;
  discordAllowedChannels?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuRegion?: "feishu" | "lark";
  feishuAllowedUsers?: string;
  feishuAllowedChats?: string;
  slackBotToken?: string;
  slackSigningSecret?: string;
  slackAppToken?: string;
  slackAllowedUsers?: string;
  slackAllowedChannels?: string;
  dingtalkAppKey?: string;
  dingtalkAppSecret?: string;
  dingtalkRobotSecret?: string;
  dingtalkAllowedUsers?: string;
  dingtalkAllowedChats?: string;
  wechatAppId?: string;
  wechatAppSecret?: string;
  wechatAgentId?: string;
  wechatMpAppId?: string;
  wechatMpAppSecret?: string;
  wechatMpToken?: string;
  wechatMpEncodingAesKey?: string;
  wechatMpAllowedUsers?: string;
  wechatMpAllowedChats?: string;
  wecomAppId?: string;
  wecomAppSecret?: string;
  wecomToken?: string;
  wecomEncodingAesKey?: string;
  wecomAgentId?: string;
  wecomAllowedUsers?: string;
  wecomAllowedChats?: string;
  weixinAccountId?: string;
  weixinToken?: string;
  weixinBaseUrl?: string;
  weixinAllowedUsers?: string;
  weixinAllowedChats?: string;
  qqBotAppId?: string;
  qqBotSecret?: string;
  qqBotAllowedUsers?: string;
  qqBotAllowedGuilds?: string;
  qqBotAllowedChannels?: string;
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
  whatsappAllowedUsers?: string;
  whatsappAllowedChannels?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookAllowedUsers?: string;
  webhookAllowedChannels?: string;
  skills?: string[];
  // Skill Credentials
  skillTavilyApiKey?: string;
  skillSerperApiKey?: string;
  skillGithubToken?: string;
  // Template workflow parameters for DB synchronization
  template_id?: string | null;
  template_slug?: string | null;
  blueprint_id?: string | null;
  blueprint_slug?: string | null;
  template_inputs?: any;
  template_consent_ok?: boolean;
  template_inputs_error?: string | null;
  // Pet & Learn
  pet?: {
    enabled?: boolean;
    slug?: string;
    render_mode?: string;
    scale?: number;
  };
  learn?: {
    enabled?: boolean;
    goals?: string[];
    memory_mode?: string;
    notes?: string;
  };
}

export interface User {
  id: string;
  username: string;
  token?: string;
  role: 'admin' | 'user';
  avatar_url?: string;
}

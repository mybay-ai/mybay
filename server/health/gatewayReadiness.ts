import { dbAdapter } from "../db";
import { runExecInContainer } from "./containerProbe";
import { testTelegramBotReachable, verifyTelegramMessageAfterApproval } from "./channelProbe";

export type WeixinChannelState = {
  configured: boolean;
  platformLoaded: boolean;
  transportConnected: boolean;
  authorizationRequired: boolean;
  authorizationApproved: boolean | null;
  status: string;
  reason: string;
};

export function resolveWeixinChannelState(input: {
  hasCredentials: boolean;
  logsLower: string;
  pendingAuthorizationCount: number;
  approvedAuthorizationCount: number;
  capturedAuthorizationCount: number;
}): WeixinChannelState {
  const { hasCredentials, logsLower, pendingAuthorizationCount, approvedAuthorizationCount, capturedAuthorizationCount } = input;
  const isAuthError = ["weixin auth failed", "weixin token invalid", "ilink unauthorized", "ilink http 401"]
    .some((keyword) => logsLower.includes(keyword));
  const adapterFailed = logsLower.includes("no adapter available for weixin") || logsLower.includes("weixin adapter failed");
  const hasExplicitConnectedLog = ["[weixin] connected", "weixin connected", "weixin ready", "connected to weixin", "weixin gateway ready"]
    .some((keyword) => logsLower.includes(keyword));
  const hasInboundActivity = [" on weixin", "weixin inbound", "weixin message", "weixin update", "received weixin"]
    .some((keyword) => logsLower.includes(keyword));
  const isConnecting = ["weixin starting", "connecting to weixin", "initializing weixin", "ilink bot starting"]
    .some((keyword) => logsLower.includes(keyword));
  // A captured authorization event can only be produced after a real inbound Weixin message.
  // Keep it as durable transport evidence because the iLink adapter does not always log a
  // dedicated connected/ready line and the relevant inbound line can rotate out of the log tail.
  const hasInboundEvidence = hasInboundActivity || capturedAuthorizationCount > 0;
  const isConnected = hasExplicitConnectedLog || hasInboundEvidence;
  const runtimeEvidence = isConnected || isConnecting || isAuthError || adapterFailed || logsLower.includes("weixin") || logsLower.includes("ilink");
  const platformLoaded = hasCredentials && runtimeEvidence;
  const transportConnected = hasCredentials && isConnected && !adapterFailed && !isAuthError;

  if (!hasCredentials) {
    return { configured: false, platformLoaded: false, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "config_missing", reason: "Personal WeChat iLink credentials are missing" };
  }
  if (adapterFailed) {
    return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "adapter_failed", reason: "Personal WeChat adapter failed to load" };
  }
  if (isAuthError) {
    return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "auth_failed", reason: "Personal WeChat iLink credentials were rejected" };
  }
  if (transportConnected) {
    if (pendingAuthorizationCount > 0) {
      return { configured: true, platformLoaded: true, transportConnected: true, authorizationRequired: true, authorizationApproved: false, status: "awaiting_authorization", reason: `Personal WeChat is connected; ${pendingAuthorizationCount} authorization request(s) pending` };
    }
    if (approvedAuthorizationCount > 0) {
      return { configured: true, platformLoaded: true, transportConnected: true, authorizationRequired: true, authorizationApproved: true, status: "connected", reason: "Personal WeChat connected and approved" };
    }
    return { configured: true, platformLoaded: true, transportConnected: true, authorizationRequired: true, authorizationApproved: false, status: "awaiting_authorization", reason: "Personal WeChat is connected; waiting for authorization" };
  }
  if (isConnecting) {
    return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "starting", reason: "Personal WeChat iLink connection is starting" };
  }
  return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "connection_failed", reason: "Personal WeChat iLink connection is not ready" };
}

export async function probeGatewayReadiness(
  container: any,
  instanceId: string,
  logsTail: string,
  enabledChannels: string[] = []
): Promise<{
  gateway_ready: boolean;
  gateway_status: string;
  gateway_error: string | null;
  gateway_services: Record<string, string>;
  checked_at: string;
  pending_auth_count: number;
  configured_channels?: number;
  connected_channels?: number;
  channel_status?: Record<string, any>;
  optional_plugin_status?: string;
  auxiliary_provider_status?: string;
  main_model_status?: string;
  chat_ready?: boolean;
}> {
  const result = {
    gateway_ready: false,
    gateway_status: "unknown",
    gateway_error: null as string | null,
    gateway_services: {} as Record<string, string>,
    checked_at: new Date().toISOString(),
    pending_auth_count: 0,
    configured_channels: 0,
    connected_channels: 0,
    channel_status: {} as Record<string, any>,
    optional_plugin_status: undefined as string | undefined,
    auxiliary_provider_status: undefined as string | undefined,
    main_model_status: undefined as string | undefined,
    chat_ready: false
  };

  try {
    // 0. Check pending auth events from DB first for accurate access control status
    const allAuthEvents = await dbAdapter.getChannelAuthEventsByInstance(instanceId).catch(() => []);
    const pendingEvents = allAuthEvents.filter(e => e.status === 'pending');
    const approvedEvents = allAuthEvents.filter(e => e.status === 'approved');
    result.pending_auth_count = pendingEvents.length;

    // Check if container is actually running
    const state = await container.inspect().catch(() => null);
    if (!state || !state.State?.Running) {
      result.gateway_ready = false;
      result.gateway_status = "stopped";
      result.gateway_error = "Container not running";
      return result;
    }

    // Execute compound shell script inside container
    const cmd = `
echo "=== HTTP PROBES ==="
for port in 9119 8000 8642 8644; do
  if [ "\$port" = "8642" ] || [ "\$port" = "8644" ]; then
    paths="health v1/chat/completions"
  else
    paths="health ready api/health api/ready status"
  fi
  for path in \$paths; do
    url="http://127.0.0.1:\${port}/\${path}"
    if [ -n "\$API_SERVER_KEY" ] && { [ "\$port" = "8642" ] || [ "\$port" = "8644" ]; }; then
      res=\$(curl -s -H "Authorization: Bearer \$API_SERVER_KEY" -o /dev/null -w "%{http_code}" --max-time 1 "\$url" 2>/dev/null || echo "fail")
    else
      res=\$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "\$url" 2>/dev/null || wget -q -S --spider --timeout=1 "\$url" 2>&1 | grep "HTTP/" | awk '{print \$2}' || echo "fail")
    fi
    # 401/403 also prove that an HTTP service is alive but protected by auth.
    if [ "\$res" = "200" ] || [ "\$res" = "201" ] || [ "\$res" = "204" ] || [ "\$res" = "401" ] || [ "\$res" = "403" ] || [ "\$res" = "405" ]; then
      echo "PORT_\${port}_PATH_\${path}: OK (HTTP \$res)"
    fi
  done
done

echo "=== TCP LISTEN PROBES ==="
cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -i ':21C2' >/dev/null && echo "PORT_8642_LISTEN: OK"
cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -i ':21C4' >/dev/null && echo "PORT_8644_LISTEN: OK"

echo "=== NETWORK/DNS ==="
timeout 2 ping -c 1 open.feishu.cn > /dev/null 2>&1 && echo "DNS_open.feishu.cn: OK" || echo "DNS_open.feishu.cn: FAIL"

echo "=== s6 SERVICES ==="
s6_dirs="/run/service /var/run/s6/services /etc/services.d"
for s6_dir in \$s6_dirs; do
  if [ -d "\$s6_dir" ]; then
    for svc in \\\$(ls "\$s6_dir"); do
      if [ "\$svc" != "." ] && [ "\$svc" != ".." ] && [ -d "\$s6_dir/\$svc" ]; then
        stat=\$(s6-svstat "\$s6_dir/\$svc" 2>/dev/null || s6-svstat -o status "\$s6_dir/\$svc" 2>/dev/null)
        if [ -n "\$stat" ]; then
          echo "SERVICE_\$svc: \$stat"
        fi
      fi
    done
  fi
done
`;

    const execOutput = await runExecInContainer(container, cmd);
    const lines = execOutput.split(/\r?\n/);
    
    let hasSuccessfulHttpProbe = false;
    let s6ServicesCount = 0;
    let isApiPortListening = false;
    let isWebhookPortListening = false;

    let dnsOk = true;

    for (const line of lines) {
      if (line.includes("PORT_8642_LISTEN: OK") || line.includes("PORT_8642_PATH_")) {
        isApiPortListening = true;
      }
      if (line.includes("PORT_8644_LISTEN: OK") || line.includes("PORT_8644_PATH_")) {
        isWebhookPortListening = true;
      }

      // 0. DNS Probe
      if (line.includes("DNS_open.feishu.cn: FAIL")) {
        dnsOk = false;
      }

      // 1. HTTP Probe detection
      const httpMatch = line.match(/^PORT_(\d+)_PATH_([a-zA-Z0-9_\/]+):\s*OK/);
      if (httpMatch) {
        hasSuccessfulHttpProbe = true;
      }

      // 2. s6 Service status Parsing
      const svcMatch = line.match(/^SERVICE_([^:]+):\s*(.*)$/);
      if (svcMatch) {
         s6ServicesCount++;
         const svcName = svcMatch[1].trim();
         const svcStat = svcMatch[2].trim();
         let status = "stopped";
         if (svcStat.includes("up (pid") || svcStat.includes("running")) {
           status = "running";
         } else if (svcStat.includes("exit") || svcStat.includes("fail") || svcStat.includes("error")) {
           status = "error";
         } else if (svcStat.includes("down")) {
           status = "stopped";
         } else if (svcStat) {
           status = "starting";
         }
         const key = svcName.replace(/-/g, '_');
         result.gateway_services[key] = status;
      }
    }

    result.chat_ready = isApiPortListening;

    // Determine if process has started successfully
    let processStatus = "unknown";
    
    // Priority A: s6 services status (including modern main-hermes and dashboard)
    if (s6ServicesCount > 0) {
      const services = result.gateway_services;
      const mainServices = ["main_hermes", "gateway_default", "gateway", "dashboard"];
      
      const anyMainRunning = mainServices.some(svc => services[svc] === "running");
      const anyMainStarting = mainServices.some(svc => services[svc] === "starting");
      
      if (anyMainRunning) {
        processStatus = "running";
      } else if (anyMainStarting) {
        processStatus = "starting";
      } else {
        const failedSvc = mainServices.find(svc => services[svc] === "error" || services[svc] === "stopped");
        if (failedSvc) {
          const statusVal = services[failedSvc];
          processStatus = statusVal === "error" ? "unhealthy" : "stopped";
          result.gateway_ready = false;
          result.gateway_status = processStatus;
          result.gateway_error = `gateway service ${failedSvc} is ${statusVal}`;
          return result;
        }
      }
    } else if (hasSuccessfulHttpProbe) {
      processStatus = "running";
    }

    if (processStatus === "starting") {
      result.gateway_ready = false;
      result.gateway_status = "starting";
      result.gateway_error = "gateway process starting...";
      return result;
    }

    // Channels parsed from config/channels
    const activeChannels = Array.from(new Set(enabledChannels.map(ch => ch.toLowerCase()).filter(ch => ch && ch !== 'none' && ch !== 'web')));
    const isTelegramEnabled = activeChannels.length === 0 || activeChannels.includes("telegram");
    const isFeishuEnabled = activeChannels.includes("feishu") || activeChannels.includes("lark");
    const isApiEnabled = activeChannels.includes("api");
    const isWebhookEnabled = activeChannels.includes("webhook");
    const logsLower = logsTail.toLowerCase();
    
    const hasDashboardAuthProviderMissing = [
      "no auth providers are registered",
      "dashboard.basic_auth.username + password_hash",
      "refusing to bind dashboard to 0.0.0.0"
    ].some(keyword => logsLower.includes(keyword));

    if (hasDashboardAuthProviderMissing) {
      result.gateway_ready = false;
      result.gateway_status = "HERMES_DASHBOARD_AUTH_PROVIDER_MISSING";
      result.gateway_error = "新版 Hermes Dashboard 需要在 config.yaml 中配置 dashboard.basic_auth。当前实例未成功注入 Basic Auth provider，请重新部署或联系管理员检查镜像适配。";
      return result;
    }

    const hasDashboardAuthError = [
      "non-loopback dashboard requires an auth provider",
      "hermes_dashboard_insecure no longer disables the auth gate",
      "a non-loopback dashboard requires an auth provider",
      "hermes_dashboard_basic_auth_username"
    ].some(keyword => logsLower.includes(keyword));

    if (hasDashboardAuthError) {
      result.gateway_ready = false;
      result.gateway_status = "dashboard_auth_required";
      result.gateway_error = "新版 Hermes Dashboard 在绑定 0.0.0.0 时必须配置 auth provider。当前 MyBay 通过 HERMES_DASHBOARD_BASIC_AUTH_USERNAME / PASSWORD / SECRET 注入。若实例缺少可恢复的访问密码，请重新进入实例设置并重新保存访问密码后再部署。";
      return result;
    }
    
    // Auto-detection of Telegram if activeChannels is empty and 'none' is not explicitly chosen
    if (activeChannels.length === 0 && !enabledChannels.includes("none") && !enabledChannels.includes("web")) {
      const hasTelegramSpecificLogs = logsLower.includes("telegram polling started") || 
                                      logsLower.includes("connected to telegram") || 
                                      logsLower.includes("telegram bot online") ||
                                      logsLower.includes("telegram gateway ready");
      if (hasTelegramSpecificLogs || allAuthEvents.some(e => e.platform === "telegram")) {
        activeChannels.push("telegram");
      }
    }

    let configuredCount = activeChannels.length;
    let connectedCount = 0;
    const channelStatusMap: Record<string, any> = {};
    const containerEnv = state?.Config?.Env || [];
    const getEnvVal = (key: string) => {
      const entry = containerEnv.find((e: string) => e.startsWith(key + "="));
      return entry ? entry.split("=")[1] : "";
    };

    for (const ch of activeChannels) {
      let pt = ch;
      if (ch === "lark" || ch === "feishu") {
        pt = "feishu";
      } else if (ch === "qqbot" || ch === "qq_bot") {
        pt = "qq_bot";
      }

      const chanPendingCount = pendingEvents.filter(e => e.platform === pt).length;
      const chanApprovedCount = approvedEvents.filter(e => e.platform === pt).length;
      const chanTotalEventsCount = allAuthEvents.filter(e => e.platform === pt).length;

      let configured = true;
      let platformLoaded = false;
      let transportConnected = false;
      let authorizationRequired = false;
      let authorizationApproved: boolean | null = null;
      let status = "unknown";
      let reason = "";

      if (pt === "telegram") {
        const hasToken = getEnvVal("TELEGRAM_BOT_TOKEN").trim().length > 0;
        const hasLogsLoaded = logsLower.includes("telegram") || logsLower.includes("polling") || logsLower.includes("telegram connected") || logsLower.includes("connected to telegram") || logsLower.includes("polling mode") || logsLower.includes("webhook ready");
        const hasEvents = chanTotalEventsCount > 0;

        let botReachable = false;
        let botReachReason = "none";
        if (hasToken) {
          const tokenStr = getEnvVal("TELEGRAM_BOT_TOKEN").trim();
          const reach = await testTelegramBotReachable(tokenStr);
          botReachable = reach.reachable;
          botReachReason = reach.reason || "none";
        }

        platformLoaded = hasToken && (hasLogsLoaded || hasEvents);
        transportConnected = platformLoaded && (
          logsLower.includes("connected") || logsLower.includes("polling mode") || logsLower.includes("webhook ready") || logsLower.includes("ready") || logsLower.includes("inbound")
        );

        if (!hasToken) {
          status = "config_missing";
          reason = "Telegram Bot Token is missing";
        } else if (!botReachable && botReachReason === "invalid_token") {
          status = "auth_failed";
          reason = "Telegram Token 无效";
        } else if (!botReachable) {
          status = "connection_failed";
          reason = `Telegram API 网络不可达 (${botReachReason})`;
        } else {
          authorizationRequired = true;
          let verifiedAfterApproval = false;
          let nextAction = "none";
          
          if (transportConnected) {
            if (chanPendingCount > 0) {
              status = "awaiting_authorization";
              authorizationApproved = false;
              reason = `已连接 · 仍有 ${chanPendingCount} 个待授权用户`;
            } else if (chanApprovedCount > 0) {
              const tgApproved = approvedEvents.filter((e: any) => e.platform === "telegram");
              const verification = verifyTelegramMessageAfterApproval(logsTail, tgApproved);
              
              if (verification.verified) {
                status = "connected";
                authorizationApproved = true;
                verifiedAfterApproval = true;
                nextAction = "none";
                reason = "Telegram connected and verified after approval";
              } else {
                status = "pending";
                authorizationApproved = true;
                verifiedAfterApproval = false;
                reason = "waiting_for_next_message";
                nextAction = "send_telegram_message";
                (channelStatusMap as any)._tempTelegramExtra = {
                  ...((channelStatusMap as any)._tempTelegramExtra || {}),
                  diagnostics: { verificationEvidence: verification.evidence }
                };
              }
            } else {
              status = "awaiting_authorization";
              authorizationApproved = false;
              reason = "已连接 · 等待首个用户验证";
            }
          } else if (botReachable && chanApprovedCount > 0) {
            const tgApproved = approvedEvents.filter((e: any) => e.platform === "telegram");
            const verification = verifyTelegramMessageAfterApproval(logsTail, tgApproved);
              
            if (verification.verified) {
              status = "connected";
              authorizationApproved = true;
              verifiedAfterApproval = true;
              nextAction = "none";
              reason = "Telegram connected and verified after approval";
            } else {
              status = "pending";
              authorizationApproved = true;
              verifiedAfterApproval = false;
              reason = "waiting_for_next_message";
              nextAction = "send_telegram_message";
              (channelStatusMap as any)._tempTelegramExtra = {
                ...((channelStatusMap as any)._tempTelegramExtra || {}),
                diagnostics: { verificationEvidence: verification.evidence }
              };
            }
          } else if (logsLower.includes("connecting") || logsLower.includes("starting")) {
            status = "starting";
            reason = "Telegram starting...";
          } else {
            status = "pending";
            reason = "waiting_for_next_message";
          }
          
          // Save extra flags to merge into the final channel_status
          (channelStatusMap as any)._tempTelegramExtra = {
            ...((channelStatusMap as any)._tempTelegramExtra || {}),
            botReachable,
            botReachReason,
            approvedAuthorizationCount: chanApprovedCount,
            pendingAuthorizationCount: chanPendingCount,
            nextAction,
            verifiedAfterApproval
          };
        }
      } else if (pt === "feishu") {
        const hasCreds = getEnvVal("FEISHU_APP_ID").trim().length > 0 && getEnvVal("FEISHU_APP_SECRET").trim().length > 0;
        const hasLogsLoaded = logsLower.includes("lark") || logsLower.includes("feishu") || logsLower.includes("ws accepted") || logsLower.includes("event subscription") || logsLower.includes("event dispatcher");
        const hasEvents = chanTotalEventsCount > 0;

        const depMissing = logsLower.includes("lark-oapi not installed") || logsLower.includes("lark_oapi not installed") || logsLower.includes("feishu: lark-oapi not installed") || logsLower.includes("feishu: lark-oapi not installed or feishu_app_id/secret not set");
        const adapterFailed = logsLower.includes("no adapter available for feishu") || logsLower.includes("no adapter available for lark");

        platformLoaded = hasCreds && (hasLogsLoaded || hasEvents);
        transportConnected = platformLoaded && !depMissing && !adapterFailed && (
          logsLower.includes("connected") || logsLower.includes("ws accepted") || logsLower.includes("event subscription") || logsLower.includes("unauthorized") || hasEvents
        );

        if (!hasCreds) {
          status = "config_missing";
          reason = "Feishu App ID or App Secret is missing";
        } else if (depMissing) {
          status = "dependency_missing";
          reason = "缺少 Feishu lark-oapi 运行期依赖";
        } else if (adapterFailed) {
          status = "adapter_failed";
          reason = "飞书渠道适配组件加载失败";
        } else {
          authorizationRequired = true;
          if (logsLower.includes("app secret invalid") || logsLower.includes("credential validation failed") || logsLower.includes("auth failed") || logsLower.includes("invalid signature")) {
            status = "auth_failed";
            reason = "Feishu credentials are invalid";
          } else if (transportConnected) {
            if (chanPendingCount > 0) {
              status = "awaiting_authorization";
              authorizationApproved = false;
              reason = `已连接 · 仍有 ${chanPendingCount} 个待授权用户`;
            } else if (chanApprovedCount > 0) {
              status = "connected";
              authorizationApproved = true;
              reason = "Feishu connected and approved";
            } else {
              status = "awaiting_authorization";
              authorizationApproved = false;
              reason = "已连接 · 等待首个用户验证";
            }
          } else if (logsLower.includes("connecting") || logsLower.includes("starting")) {
            status = "starting";
            reason = "Feishu starting...";
          } else {
            status = "connection_failed";
            reason = "Feishu connection failed";
          }
        }
      } else if (pt === "qq_bot") {
        const hasCreds = (getEnvVal("QQ_APP_ID").trim().length > 0 || getEnvVal("QQ_BOT_APP_ID").trim().length > 0) &&
                         (getEnvVal("QQ_CLIENT_SECRET").trim().length > 0 || getEnvVal("QQ_BOT_SECRET").trim().length > 0);
        authorizationRequired = false;

        const isAuthError = [
          "qq auth fail", "qq secret invalid", "qq client secret invalid", "qq credential validation failed",
          "qq authentication failed", "invalid appid", "code: 40001", "code 40001", "authentication failed", "auth failed"
        ].some(keyword => logsLower.includes(keyword));

        const isConnected = [
          "qq connected", "qqbot connected", "qq_bot connected", "qq adapter online", "connected to qq",
          "qq gateway ready", "qq bot online", "qqbot online", "qq portal connection established", "qq adapter connected",
          "qq_bot online", "qqbot connected"
        ].some(keyword => logsLower.includes(keyword));

        const isConnecting = [
          "qqbot starting", "qq_bot connecting", "qq client starting", "qq adapter starting", "initializing qq", "synchronizing qq"
        ].some(keyword => logsLower.includes(keyword));

        const depMissing = logsLower.includes("aiohttp not installed") ||
                           logsLower.includes("httpx not installed") ||
                           logsLower.includes("no module named 'aiohttp'") ||
                           logsLower.includes("no module named 'httpx'") ||
                           logsLower.includes("aiohttp: not found") ||
                           logsLower.includes("httpx: not found") ||
                           logsLower.includes("import error: aiohttp") ||
                           logsLower.includes("import error: httpx") ||
                           (logsLower.includes("no module named") && (logsLower.includes("aiohttp") || logsLower.includes("httpx")));

        const adapterFailed = logsLower.includes("no adapter available for qq") ||
                              logsLower.includes("no adapter available for qqbot") ||
                              logsLower.includes("no adapter available for qq_bot");

        platformLoaded = hasCreds && (isConnected || isConnecting || isAuthError || depMissing || adapterFailed || logsLower.includes("qq"));
        transportConnected = hasCreds && isConnected && !depMissing && !adapterFailed;

        if (!hasCreds) {
          status = "config_missing";
          reason = "QQ BOT：配置未注入";
        } else if (depMissing) {
          status = "dependency_missing";
          reason = "QQ BOT：缺少 aiohttp 或 httpx 运行期依赖";
        } else if (adapterFailed) {
          status = "adapter_failed";
          reason = "QQ BOT：渠道适配组件加载失败";
        } else if (isConnected) {
          status = "connected";
          reason = "QQ BOT：已连接";
        } else if (isAuthError) {
          status = "auth_failed";
          reason = "QQ BOT：认证失败";
        } else if (isConnecting) {
          status = "starting";
          reason = "QQ BOT：同步中";
        } else {
          status = "connection_failed";
          reason = "QQ BOT：连接失败";
        }
      } else if (pt === "dingtalk") {
        const hasCreds = (getEnvVal("DINGTALK_APP_KEY").trim().length > 0 && getEnvVal("DINGTALK_APP_SECRET").trim().length > 0) || getEnvVal("DINGTALK_ROBOT_SECRET").trim().length > 0;
        authorizationRequired = true;

        const isAuthError = [
          "dingtalk auth fail", "dingtalk secret invalid", "sign error", "invalid appkey", "invalid sign"
        ].some(keyword => logsLower.includes(keyword));

        const isConnected = [
          "dingtalk connected", "dingtalk ready", "dingtalk gateway ready", "connected to dingtalk", "dingtalk webhook ready", "dingtalk callback verified"
        ].some(keyword => logsLower.includes(keyword));

        const isConnecting = [
          "dingtalk starting", "connecting to dingtalk", "initializing dingtalk"
        ].some(keyword => logsLower.includes(keyword));

        const depMissing = logsLower.includes("dingtalk dependency missing") || logsLower.includes("dingtalk sdk not found") || logsLower.includes("dingtalk: missing dependencies");
        const adapterFailed = logsLower.includes("no adapter available for dingtalk") || logsLower.includes("dingtalk adapter failed");

        platformLoaded = hasCreds && (isConnected || isConnecting || isAuthError || depMissing || adapterFailed || logsLower.includes("dingtalk"));
        transportConnected = hasCreds && isConnected && !depMissing && !adapterFailed;

        if (!hasCreds) {
          status = "config_missing";
          reason = "钉钉：AppKey/AppSecret 或 RobotSecret 未配置";
        } else if (depMissing) {
          status = "dependency_missing";
          reason = "钉钉：缺少必要依赖包";
        } else if (adapterFailed) {
          status = "adapter_failed";
          reason = "钉钉：适配层加载失败";
        } else if (isConnected) {
          if (chanPendingCount > 0) {
            status = "awaiting_authorization";
            authorizationApproved = false;
            reason = `已连接 · 仍有 ${chanPendingCount} 个待授权用户`;
          } else if (chanApprovedCount > 0) {
            status = "connected";
            authorizationApproved = true;
            reason = "钉钉：已成功连接并绑定";
          } else {
            status = "awaiting_authorization";
            authorizationApproved = false;
            reason = "已连接 · 等待首个用户验证";
          }
        } else if (isAuthError) {
          status = "auth_failed";
          reason = "钉钉：凭证或签名校验失败 (AppSecret/RobotSecret invalid)";
        } else if (isConnecting) {
          status = "starting";
          reason = "钉钉：启动同步中...";
        } else {
          status = "connection_failed";
          reason = "钉钉：连接超时或服务未响应";
        }
      } else if (pt === "wecom") {
        const hasCreds = (getEnvVal("WECOM_APP_ID").trim().length > 0 || getEnvVal("WECOM_CORP_ID").trim().length > 0) &&
                          getEnvVal("WECOM_APP_SECRET").trim().length > 0 &&
                          getEnvVal("WECOM_AGENT_ID").trim().length > 0;
        authorizationRequired = true;

        const isAuthError = [
          "wecom auth fail", "wecom secret invalid", "corpsec invalid", "invalid credential", "invalid corpsecret", "code: 40013", "code 40001", "invalid corpid"
        ].some(keyword => logsLower.includes(keyword));

        const isSigError = [
          "invalid signature", "token mismatch", "aes decrypt failed", "wecom decrypt failed"
        ].some(keyword => logsLower.includes(keyword));

        const isConnected = [
          "wecom connected", "wecom ready", "wecom gateway ready", "connected to wecom", "wecom callback verified", "wecom signature verified"
        ].some(keyword => logsLower.includes(keyword));

        const isConnecting = [
          "wecom starting", "connecting to wecom", "initializing wecom"
        ].some(keyword => logsLower.includes(keyword));

        const depMissing = logsLower.includes("wecom dependency missing") || logsLower.includes("wecom sdk not found");
        const adapterFailed = logsLower.includes("no adapter available for wecom") || logsLower.includes("wecom adapter failed");

        platformLoaded = hasCreds && (isConnected || isConnecting || isAuthError || isSigError || depMissing || adapterFailed || logsLower.includes("wecom"));
        transportConnected = hasCreds && isConnected && !depMissing && !adapterFailed;

        if (!hasCreds) {
          status = "config_missing";
          reason = "企业微信：CorpID/Secret/AgentID 配置不完整";
        } else if (depMissing) {
          status = "dependency_missing";
          reason = "企业微信：缺少必要依赖包";
        } else if (adapterFailed) {
          status = "adapter_failed";
          reason = "企业微信：渠道适配组件加载失败";
        } else if (isConnected) {
          if (chanPendingCount > 0) {
            status = "awaiting_authorization";
            authorizationApproved = false;
            reason = `已连接 · 仍有 ${chanPendingCount} 个待授权用户`;
          } else if (chanApprovedCount > 0) {
            status = "connected";
            authorizationApproved = true;
            reason = "企业微信：已成功连接并绑定";
          } else {
            status = "awaiting_authorization";
            authorizationApproved = false;
            reason = "已连接 · 等待首个用户验证";
          }
        } else if (isAuthError) {
          status = "auth_failed";
          reason = "企业微信：凭证校验失败 (CorpID/Secret invalid)";
        } else if (isSigError) {
          status = "auth_failed";
          reason = "企业微信：回调验签或解密失败 (Token/EncodingAESKey mismatch)";
        } else if (isConnecting) {
          status = "starting";
          reason = "企业微信：启动同步中...";
        } else {
          status = "connection_failed";
          reason = "企业微信：连接失败或回调路由未配置";
        }
      } else if (pt === "wechat_mp") {
        const hasCreds = getEnvVal("WECHAT_MP_APP_ID").trim().length > 0 &&
                          getEnvVal("WECHAT_MP_APP_SECRET").trim().length > 0;
        authorizationRequired = true;

        const isAuthError = [
          "wechat_mp auth fail", "wechat_mp secret invalid", "invalid appsecret", "code: 40001", "code 40001", "invalid credential"
        ].some(keyword => logsLower.includes(keyword));

        const isSigError = [
          "invalid signature", "token mismatch", "aes decrypt failed", "wechat_mp decrypt failed"
        ].some(keyword => logsLower.includes(keyword));

        const isConnected = [
          "wechat_mp connected", "wechat_mp ready", "wechat_mp gateway ready", "connected to wechat_mp", "wechat_mp callback verified", "wechat_mp signature verified"
        ].some(keyword => logsLower.includes(keyword));

        const isConnecting = [
          "wechat_mp starting", "connecting to wechat_mp", "initializing wechat_mp"
        ].some(keyword => logsLower.includes(keyword));

        const depMissing = logsLower.includes("wechat_mp dependency missing") || logsLower.includes("wechat_mp sdk not found") || logsLower.includes("wechat-mp dependency missing");
        const adapterFailed = logsLower.includes("no adapter available for wechat_mp") || logsLower.includes("wechat_mp adapter failed");

        platformLoaded = hasCreds && (isConnected || isConnecting || isAuthError || isSigError || depMissing || adapterFailed || logsLower.includes("wechat_mp"));
        transportConnected = hasCreds && isConnected && !depMissing && !adapterFailed;

        if (!hasCreds) {
          status = "config_missing";
          reason = "微信公众号：AppID/AppSecret 配置不完整";
        } else if (depMissing) {
          status = "dependency_missing";
          reason = "微信公众号：缺少必要依赖包";
        } else if (adapterFailed) {
          status = "adapter_failed";
          reason = "微信公众号：渠道适配组件加载失败";
        } else if (isConnected) {
          if (chanPendingCount > 0) {
            status = "awaiting_authorization";
            authorizationApproved = false;
            reason = `已连接 · 仍有 ${chanPendingCount} 个待授权用户`;
          } else if (chanApprovedCount > 0) {
            status = "connected";
            authorizationApproved = true;
            reason = "微信公众号：已成功连接并绑定";
          } else {
            status = "awaiting_authorization";
            authorizationApproved = false;
            reason = "已连接 · 等待首个用户验证";
          }
        } else if (isAuthError) {
          status = "auth_failed";
          reason = "微信公众号：凭证校验失败 (AppID/Secret invalid)";
        } else if (isSigError) {
          status = "auth_failed";
          reason = "微信公众号：回调验签或解密失败 (Token/EncodingAESKey mismatch)";
        } else if (isConnecting) {
          status = "starting";
          reason = "微信公众号：启动同步中...";
        } else {
          status = "connection_failed";
          reason = "微信公众号：连接失败或回调路由未配置";
        }
      } else if (pt === "weixin") {
        const hasCreds = getEnvVal("WEIXIN_ACCOUNT_ID").trim().length > 0 && getEnvVal("WEIXIN_TOKEN").trim().length > 0;
        const weixinState = resolveWeixinChannelState({ hasCredentials: hasCreds, logsLower, pendingAuthorizationCount: chanPendingCount, approvedAuthorizationCount: chanApprovedCount, capturedAuthorizationCount: chanTotalEventsCount });
        configured = weixinState.configured;
        platformLoaded = weixinState.platformLoaded;
        transportConnected = weixinState.transportConnected;
        authorizationRequired = weixinState.authorizationRequired;
        authorizationApproved = weixinState.authorizationApproved;
        status = weixinState.status;
        reason = weixinState.reason;
      } else if (pt === "api") {
        const hasApiKey = getEnvVal("API_SERVER_KEY").trim().length > 0;
        configured = hasApiKey;
        platformLoaded = hasApiKey && isApiPortListening;
        transportConnected = isApiPortListening;
        authorizationRequired = false;
        if (!hasApiKey) {
          status = "config_missing";
          reason = "API server key is missing";
        } else if (isApiPortListening) {
          status = "connected";
          reason = "API server is listening on port 8642";
        } else {
          status = "connection_failed";
          reason = "API server port 8642 is not listening";
        }
      } else if (pt === "webhook") {
        const webhookEnabled = getEnvVal("WEBHOOK_ENABLED").trim().toLowerCase() === "true";
        const hasWebhookConfig = webhookEnabled || getEnvVal("WEBHOOK_URL").trim().length > 0;
        configured = hasWebhookConfig;
        platformLoaded = hasWebhookConfig && isWebhookPortListening;
        transportConnected = isWebhookPortListening;
        authorizationRequired = false;
        if (!hasWebhookConfig) {
          status = "config_missing";
          reason = "Webhook channel configuration is missing";
        } else if (isWebhookPortListening) {
          status = "connected";
          reason = "Webhook receiver is listening on port 8644";
        } else {
          status = "connection_failed";
          reason = "Webhook receiver port 8644 is not listening";
        }
      } else {
        const chUpper = ch.toUpperCase();
        const hasToken = containerEnv.some((e: string) => e.startsWith(`${chUpper}_BOT_TOKEN=`) || e.startsWith(`${chUpper}_TOKEN=`) || e.startsWith(`${chUpper}_ACCESS_TOKEN=`) || e.startsWith(`${chUpper}_APP_KEY=`));
        
        const isConnected = logsLower.includes(`${ch} connected`) || logsLower.includes(`connected to ${ch}`) || logsLower.includes(`${ch} gateway ready`) || logsLower.includes(`${ch} ready`);
        const isConnecting = logsLower.includes(`${ch} starting`) || logsLower.includes(`connecting to ${ch}`);
        const isAuthError = logsLower.includes(`${ch} auth fail`) || logsLower.includes(`${ch} secret invalid`);

        platformLoaded = hasToken && (isConnected || isConnecting || isAuthError || logsLower.includes(ch));
        transportConnected = hasToken && isConnected;
        authorizationRequired = false;

        if (!hasToken) {
          status = "config_missing";
          reason = `${ch.toUpperCase()} configuration missing`;
        } else if (isConnected) {
          status = "connected";
          reason = `${ch.toUpperCase()} connected successfully`;
        } else if (isAuthError) {
          status = "auth_failed";
          reason = `${ch.toUpperCase()} authentication failed`;
        } else if (isConnecting) {
          status = "starting";
          reason = `${ch.toUpperCase()} starting...`;
        } else {
          status = "connection_failed";
          reason = `${ch.toUpperCase()} connection failed`;
        }
      }

      if (status === "connected") {
        connectedCount++;
      }

      channelStatusMap[ch] = {
        platform: pt,
        configured,
        platformLoaded,
        credentialValid: status === "auth_failed" ? false : (status === "config_missing" ? null : true),
        transportConnected,
        authorizationRequired,
        authorizationApproved,
        pendingAuthorizationCount: chanPendingCount,
        approvedAuthorizationCount: chanApprovedCount,
        status,
        reason,
        ...(pt === "telegram" ? (channelStatusMap as any)._tempTelegramExtra : {})
      };
      
      if (pt === "telegram") {
        delete (channelStatusMap as any)._tempTelegramExtra;
      }
    }

    result.configured_channels = configuredCount;
    result.connected_channels = connectedCount;
    result.channel_status = channelStatusMap;

    // Priority B: Log parsing for platform connected or general running indicators
    const hasLogRunningEvidence = [
      "gateway is now running under s6 supervision",
      "gateway will continue running for cron job execution",
      "cron ticker started",
      "kanban dispatcher",
      "channel directory built",
      "gateway running with",
      "telegram connected",
      "connected to telegram",
      "telegram polling started",
      "telegram gateway ready",
      "gateway started",
      "gateway running",
      "ws accepted",
      "telegram connected successfully",
      "lark connected",
      "feishu connected",
      "[lark] connected",
      "telegram connected (polling mode)",
      "gateway run: inbound message",
      "api call"
    ].some(keyword => logsLower.includes(keyword));

    const s6GatewayRunning = (
      result.gateway_services["main_hermes"] === "running" ||
      result.gateway_services["gateway_default"] === "running" ||
      result.gateway_services["gateway"] === "running" ||
      result.gateway_services["dashboard"] === "running"
    );

    const isGatewayActive = s6GatewayRunning || hasSuccessfulHttpProbe || hasLogRunningEvidence;
    const noAllowlist = logsLower.includes("no user allowlists configured") || logsLower.includes("allowlist is empty");
    const hasPendingAuth = result.pending_auth_count > 0;

    // Advanced logs classification & category scans
    const depMissing = logsLower.includes("lark-oapi not installed") || logsLower.includes("lark_oapi not installed") || logsLower.includes("feishu: lark-oapi not installed") || logsLower.includes("feishu: lark-oapi not installed or feishu_app_id/secret not set");
    const adapterFailed = logsLower.includes("no adapter available for feishu") || logsLower.includes("no adapter available for lark");

    if (logsLower.includes("raft cli not found in path") || logsLower.includes("raft cli not found")) {
      result.optional_plugin_status = "optional_plugin_missing";
    }
    if (logsLower.includes("auxiliary: marking openrouter unhealthy") || logsLower.includes("nous client unavailable")) {
      result.auxiliary_provider_status = "auxiliary_provider_unhealthy";
    }
    if (logsLower.includes("openai client created") && logsLower.includes("provider=deepseek")) {
      result.main_model_status = "main_model_connected";
    }

    if (isGatewayActive) {
      result.gateway_ready = true;
      
      if (isFeishuEnabled && depMissing) {
        result.gateway_status = "channel_adapter_failed";
        result.gateway_error = "⚠️ 飞书连接失败：内核缺少 lark-oapi 依赖包或未成功加载。";
      } else if (isFeishuEnabled && adapterFailed) {
        result.gateway_status = "channel_adapter_failed";
        result.gateway_error = "⚠️ 飞书连接失败：内核加载 Feishu 适配组件失败（No adapter).";
      } else if (isApiEnabled && !isApiPortListening) {
        result.gateway_status = "channel_warning";
        result.gateway_error = "⚠️ API 渠道已启用，但容器内 8642 端口未正常监听（可能 API 服务加载失败，请检查容器日志）。";
      } else if (isWebhookEnabled && !isWebhookPortListening) {
        result.gateway_status = "channel_warning";
        result.gateway_error = "⚠️ Webhook 渠道已启用，但容器内 8644 端口未正常监听（可能 Webhook 服务加载失败，请检查容器日志）。";
      } else if (!dnsOk && isFeishuEnabled) {
          result.gateway_status = "channel_warning";
          result.gateway_error = "⚠️ 实例已运行，但飞书域名 (open.feishu.cn) 解析失败，请检查容器 DNS 配置。";
      } else if (hasPendingAuth) {
        result.gateway_status = "access_control_warning";
        result.gateway_error = `⚠️ 网关正常运行，发现 ${result.pending_auth_count} 个待授权访问请求`;
      } else if (noAllowlist) {
        result.gateway_status = "access_control_warning";
        result.gateway_error = "⚠️ 网关正常运行，但拦截到未授权访问事件，请前往白名单面板处理。";
      } else {
        result.gateway_status = "running";
        result.gateway_error = `✅ 智能网关已运行并就绪（通信模块已载入）`;
      }

      if (!result.gateway_services["gateway_default"]) {
        result.gateway_services["gateway_default"] = "running";
      }
      return result;
    }

    // Identify if any specific error occurred
    if (isFeishuEnabled && (logsLower.includes("lark app secret invalid") || logsLower.includes("app_secret_invalid") || logsLower.includes("app secret invalid"))) {
      result.gateway_ready = false;
      result.gateway_status = "unhealthy";
      result.gateway_error = "飞书/Lark 凭证无效 (invalid App ID/Secret)";
      return result;
    } else if (isFeishuEnabled && (depMissing || adapterFailed)) {
      result.gateway_ready = false;
      result.gateway_status = "channel_adapter_failed";
      result.gateway_error = depMissing ? "飞书连接失败：缺少 lark-oapi 运行期依赖" : "飞书连接失败：适配组件加载异常";
      return result;
    } else if (isTelegramEnabled && (logsLower.includes("telegram bot token invalid") || logsLower.includes("401 unauthorized") && logsLower.includes("bot"))) {
      result.gateway_ready = false;
      result.gateway_status = "unhealthy";
      result.gateway_error = "Telegram Bot Token 校验失败";
      return result;
    } else if (logsLower.includes("cannot find module") || logsLower.includes("import error")) {
      result.gateway_ready = false;
      result.gateway_status = "unhealthy";
      result.gateway_error = "内核模块加载异常";
      return result;
    } else if (
      logsLower.includes("basicauthprovider is password-only") ||
      logsLower.includes("there is no oauth redirect flow")
    ) {
      result.gateway_ready = false;
      result.gateway_status = "hermes_session_cookie_missing";
      result.gateway_error = "Hermes Web UI 访问授权未建立或失效。请在该实例专有的登录页面重新输入访问密码，以进行安全授权与登录态同步。";
      return result;
    }

    // Default: process is up, but platform is still connecting/installing dependencies
    if (processStatus === "running") {
      result.gateway_ready = false;
      result.gateway_status = "starting";
      if (logsLower.includes("lazy-installing") || logsLower.includes("lazy install")) {
          result.gateway_error = "网关依赖包自动预热中...";
      } else if (isFeishuEnabled) {
          result.gateway_error = "等待 Feishu/Lark 通道连接完成...";
      } else {
          result.gateway_error = "Waiting for Hermes messenger gateway to complete initialization...";
      }
      return result;
    }


  } catch (err: any) {
    result.gateway_ready = false;
    result.gateway_status = "error";
    result.gateway_error = "Readiness check failed: " + err.message;
  }

  return result;
}

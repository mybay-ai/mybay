import { Router, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { checkPortInUse, isPortTaken, findAvailablePort } from "../utils";
import Docker from "dockerode";
import os from "os";
import crypto from "crypto";
import { providerRegistry } from "../../shared/providerRegistry";
import { ErrorCodes } from "../../shared/errorCodes";
import { resolveProviderRegistryKey } from "../../shared/providerRegistryUtils";
import { dbAdapter } from "../db";
import { templatesRepo } from "../repositories/templatesRepo";
import { authenticateToken, requireAdmin, AuthenticatedRequest } from "../middlewares/auth";
import { auditLogsRepo } from "../repositories/auditLogsRepo";
import { getClientIp } from "../utils/ip";
import { parseTraefikEnv } from "../infrastructure/traefik/traefikConfig";
import { getDeploymentModeConfig, saveDeploymentModeConfig } from "../services/deploymentMode";
import { sanitizeErrorMessage } from "../utils/sanitizer";
import { applySavedProviderCredential, resolveStoredCredentialApiKey, SavedProviderCredentialError } from "../utils/savedProviderCredential";
import { DEFAULT_INSTANCE_DISK_MB, DEFAULT_MAX_SINGLE_INSTANCE_DISK_MB, DEFAULT_USER_DISK_LIMIT_MB, ALLOWED_DISK_LIMITS } from "../constants/resourceLimits";
import { isAdvancedResourceConfigEnabled } from "../utils/advancedResourceConfigFeature";
import { readStore } from "../localStore";
import { buildDeploymentJourney } from "../services/deploymentJourneyService";
import { formatSystemRequestError as formatError, isSafeUrl } from "../services/system/systemNetworkPolicy";
import { createDeploymentModeRoutes } from "./system/deploymentMode.routes";
import { createSystemSettingsRoutes } from "./system/settings.routes";

const router = Router();
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });

const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req: any) => {
    if (req.user?.id) return `system-test:user:${req.user.id}`;
    return `system-test:ip:${ipKeyGenerator(req.ip)}`;
  },
  message: { error: '检测接口调用频率过高，请稍后重试。' }
});

router.post("/test-llm", authenticateToken, testLimiter, async (req: AuthenticatedRequest, res: Response) => {
  let { provider, model, baseUrl, apiKey, credentialId } = req.body;

  // Resolve credential from DB if ID is provided
  if (credentialId) {
    try {
      const cred = await dbAdapter.getCredentialById(credentialId, req.user.id);
      const credentialData = {
        providerCredentialId: credentialId,
        provider,
        baseUrl,
        providerApiKey: apiKey,
        apiKey: ""
      };
      applySavedProviderCredential(credentialData, cred);
      provider = credentialData.provider;
      baseUrl = credentialData.baseUrl;
      apiKey = credentialData.providerApiKey;
    } catch (err: any) {
      const code = err instanceof SavedProviderCredentialError
        ? err.code
        : "CREDENTIAL_DECRYPT_FAILED";
      const message = code === "CREDENTIAL_NOT_FOUND"
        ? "The selected saved credential no longer exists. Select another credential."
        : "The saved credential cannot be decrypted with the current ENCRYPTION_KEY. Restore the original .env, or save this credential's API Key again.";
      console.error("Failed to resolve saved credential for LLM test:", {
        code,
        credentialId
      });
      return res.status(400).json({
        success: false,
        code,
        error: message,
        message
      });
    }
  }

  if (!provider) {
    return res.json({ success: false, error: "缺少必填参数: provider" });
  }

  const regKey = resolveProviderRegistryKey(provider, model, baseUrl);

  const conf = providerRegistry[regKey];
  if (conf) {
    if (!baseUrl) {
      baseUrl = conf.defaultBaseUrl;
    }
    if (!model) {
      model = conf.defaultModel;
    }
  }

  const strategy = conf ? conf.testStrategy : "openai-chat-completions";

  if (strategy === "no-predeploy-test") {
    return res.json({ success: false, error: `模型服务商 "${conf ? conf.label : provider}" 设置了 no-predeploy-test 策略，不支持运行预配置连通性测试。` });
  }

  if (!model || !baseUrl || (conf?.requiresApiKey !== false && !apiKey)) {
    return res.json({ success: false, error: "缺少必填参数: apiKey, model 或 baseUrl" });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    let url = "";
    let opts: any = { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal };
    let response;

    if (strategy === "anthropic-messages") {
      url = `${baseUrl.replace(/\/$/, "")}/messages`;
      opts.headers["x-api-key"] = apiKey;
      opts.headers["anthropic-version"] = "2023-06-01";
      opts.body = JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }]
      });
    } else if (strategy === "gemini-generate-content") {
      url = `${baseUrl.replace(/\/$/, "")}/models/${model}:generateContent?key=${apiKey}`;
      opts.body = JSON.stringify({
        contents: [{ parts: [{ text: "hi" }] }]
      });
    } else {
      // Default / fallback is openai-chat-completions
      url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      opts.headers["Authorization"] = `Bearer ${apiKey}`;

      // Detect official OpenAI to prefer max_completion_tokens (required by gpt-4.5/5.4/o1/o3 series)
      const isOfficialOpenAI = provider === "openai" || url.includes("api.openai.com");

      const body: any = {
        model,
        messages: [{ role: "user", content: "Reply with OK." }]
      };

      // Use Registry capability if exists, otherwise fallback to heuristic detection
      const tokenParam = conf?.tokenLimitParameter || (isOfficialOpenAI ? "max_completion_tokens" : "max_tokens");
      body[tokenParam] = 16;

      opts.body = JSON.stringify(body);
    }

    if (!(await isSafeUrl(url))) {
      clearTimeout(timeoutId);
      return res.json({ success: false, error: `SSRF 安全拦截: 目标地址 ${url} 不合法或指向了内网私有 IP 范围。` });
    }

    try {
      response = await fetch(url, opts);

      // Auto-retry once if parameter incompatibility is detected (400 Bad Request)
      if (response && response.status === 400) {
        const clonedRes = response.clone();
        const errJson = await clonedRes.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || "";
        const errParam = errJson?.error?.param || "";
        const errCode = errJson?.error?.code || "";

        // Detection criteria for max_tokens vs max_completion_tokens mismatch
        const isTokenParamError = errParam === "max_tokens" ||
                                 errCode === "unsupported_parameter" ||
                                 errMsg.includes("max_completion_tokens") ||
                                 errMsg.includes("max_tokens is not supported");

        if (isTokenParamError) {
          const body = JSON.parse(opts.body);
          if (body.max_tokens) {
            delete body.max_tokens;
            body.max_completion_tokens = 16;
            console.log(`[Test-LLM] Detected max_tokens incompatibility for ${model}. Retrying with max_completion_tokens...`);
          } else if (body.max_completion_tokens) {
            delete body.max_completion_tokens;
            body.max_tokens = 16;
            console.log(`[Test-LLM] Detected max_completion_tokens incompatibility for ${model}. Retrying with max_tokens...`);
          }

          opts.body = JSON.stringify(body);
          response = await fetch(url, opts);
        }
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      return res.json({ success: false, error: `网络请求失败: ${formatError(err)}` });
    }

    clearTimeout(timeoutId);

    if (response.ok) {
      if (credentialId) {
        await dbAdapter.updateCredential(credentialId, req.user.id, { verification_status: "verified", verified_at: new Date().toISOString() }).catch(() => null);
      }
      return res.json({ success: true, message: "测试成功，API配置有效" });
    } else {
      const status = response.status;
      const text = await response.text();
      let errorMsg = `HTTP ${status}`;

      try {
        const json = JSON.parse(text);
        errorMsg = json?.error?.message || json?.error || json?.message || errorMsg;
      } catch(e) {
        errorMsg = text.substring(0, 300) || errorMsg;
      }

      if (status === 401) {
        return res.json({ success: false, error: "认证失败 (401): API Key 可能无效或已过期。" });
      } else if (status === 403) {
        return res.json({ success: false, error: "权限不足 (403): 请检查该 API Key 是否有权访问所选模型。" });
      } else if (status === 404) {
        return res.json({ success: false, error: `资源未找到 (404): 请检查 Base URL 或模型名称 (${model}) 是否正确。` });
      } else if (status === 429) {
        return res.json({ success: false, error: "达到速率限制 (429): 请求过于频繁或账户配额不足。" });
      } else {
        return res.json({ success: false, error: `模型服务返回错误 [${status}]: ${errorMsg}` });
      }
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    return res.json({ success: false, error: `内部错误: ${formatError(err)}` });
  }
});

router.post("/test-channel", authenticateToken, testLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { channel } = req.body;
  if (!channel || channel === "none" || channel === "web" || channel === "api") return res.json({ success: true, message: "该渠道不需要第三方凭据测试，将在实例启动后验证 Chat API readiness" });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const fetchOpts: any = { signal: controller.signal };

  try {
    if (channel === "telegram") {
      const { telegramBotToken } = req.body;
      if (!telegramBotToken) return res.json({ success: false, error: "缺少 Bot Token" });
      const resp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getMe`, fetchOpts);
      const data = await resp.json();
      if (data.ok) return res.json({ success: true, message: `配置有效，Bot名称: ${data.result?.first_name || '未知'}` });
      return res.json({ success: false, error: `Telegram 失败: ${JSON.stringify(data).substring(0, 500)}` });
    } else if (channel === "feishu") {
      let { feishuAppId, feishuAppSecret, feishuRegion } = req.body;

      // Trim values safely
      feishuAppId = typeof feishuAppId === 'string' ? feishuAppId.trim() : '';
      feishuAppSecret = typeof feishuAppSecret === 'string' ? feishuAppSecret.trim() : '';

      // Basic checks
      if (!feishuAppId) {
        return res.json({ success: false, error: "缺少 App ID (例如以 cli_ 开头)" });
      }
      if (!feishuAppSecret) {
        return res.json({ success: false, error: "缺少 App Secret 安全私钥" });
      }

      // Mask detection
      const isSecretMask = /^[•\*·\s]+$/g.test(feishuAppSecret) ||
                           feishuAppSecret.includes("••••") ||
                           feishuAppSecret.includes("***") ||
                           feishuAppSecret === "••••••••••••••••";

      if (isSecretMask) {
        return res.json({
          success: false,
          error: "检测到输入的 App Secret 是安全遮罩（星号/点号）。“测试通道连接”需要输入真实且即时的 App Secret 私钥，不能使用本地带有的遮罩。请在输入框中重新填入来自飞书开放平台的 App Secret 真实值，然后再进行连通测试。"
        });
      }

      // Region check
      const isLark = feishuRegion === "lark";
      const apiDomain = isLark ? "open.larksuite.com" : "open.feishu.cn";
      const url = `https://${apiDomain}/open-apis/auth/v3/tenant_access_token/internal`;

      // Security Logging before request
      const safeId = feishuAppId.length > 10
        ? `${feishuAppId.substring(0, 6)}...${feishuAppId.slice(-4)}`
        : feishuAppId;
      console.log(`[Channel Test] Starting Feishu/Lark connection verification:
        - Mode/Region: ${isLark ? 'Lark (Overseas)' : 'Feishu (China)'}
        - Base URL Domain: ${apiDomain}
        - App ID (masked): ${safeId}
        - App Secret Length: ${feishuAppSecret.length}
        - App Secret Mask Check: ${isSecretMask ? 'YES' : 'NO'}`);

      try {
        const resp = await fetch(url, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ app_id: feishuAppId, app_secret: feishuAppSecret }),
           signal: controller.signal
        });

        const data = await resp.json();

        // Security Logging after response
        console.log(`[Channel Test] Feishu/Lark authentication response:
          - HTTP Status: ${resp.status}
          - Result Code: ${data.code}
          - Result Msg: ${data.msg}`);

        if (data.code === 0) {
          return res.json({ success: true, message: `与 ${isLark ? 'Lark' : '飞书'} 开放平台握手连通成功！已成功签发 tenant_access_token。` });
        }

        // Custom refined error message for app secret invalid
        if (data.code === 10014 || (data.msg && data.msg.toLowerCase().includes("app secret invalid"))) {
          return res.json({
            success: false,
            error: "飞书 App Secret 校验失败 (10014)。请确认您的 App ID 与 App Secret 隶属于同一个应用，且填入的是开放平台‘凭证与基础信息’项下的‘App Secret’，而不是‘Event Subscription(事件订阅)’中的 Verification Token 或 Encrypt Key。"
          });
        }

        return res.json({ success: false, error: `${isLark ? 'Lark' : '飞书'}接口返回: ${data.msg || '未知错误'} (代号: ${data.code})` });
      } catch (err: any) {
        console.error(`[Channel Test] Networking handshake error:`, err);
        return res.json({ success: false, error: "对接渠道或网络握手异常，请检查配置" });
      }
    } else if (channel === "slack") {
      const { slackBotToken } = req.body;
      if (!slackBotToken) return res.json({ success: false, error: "缺少 Bot Token" });
      const resp = await fetch("https://slack.com/api/auth.test", {
         headers: { "Authorization": `Bearer ${slackBotToken}` },
         signal: controller.signal
      });
      const data = await resp.json();
      if (data.ok) return res.json({ success: true, message: "Slack 配置有效，认证成功" });
      return res.json({ success: false, error: `Slack 失败: ${JSON.stringify(data).substring(0, 500)}` });
    } else if (channel === "webhook") {
      const { webhookUrl } = req.body;
      if (!webhookUrl) return res.json({ success: false, error: "缺少 Webhook URL" });
      if (!(await isSafeUrl(webhookUrl))) {
        return res.json({ success: false, error: `SSRF 安全拦截: 目标地址 ${webhookUrl} 指向了内网私有地址范围。` });
      }
      const resp = await fetch(webhookUrl, {
         method: "POST", headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ type: "ping", source: "hermes-console" }),
         signal: controller.signal
      });
      if (resp.ok) return res.json({ success: true, message: `Webhook 测试请求成功 HTTP ${resp.status}` });
      return res.json({ success: false, error: `Webhook 请求失败 HTTP ${resp.status}` });
    } else if (channel === "whatsapp") {
      const { whatsappPhoneNumberId, whatsappAccessToken } = req.body;
      if (!whatsappPhoneNumberId || !whatsappAccessToken) {
        return res.json({ success: false, error: "缺少 WhatsApp 必填参数: Phone Number ID 或 Access Token" });
      }
      const url = `https://graph.facebook.com/v18.0/${whatsappPhoneNumberId}?access_token=${whatsappAccessToken}`;
      if (!(await isSafeUrl(url))) {
        return res.json({ success: false, error: "SSRF 安全验证未通过: WhatsApp API 端点不合法" });
      }
      const resp = await fetch(url, fetchOpts);
      const data = await resp.json();
      if (resp.ok) {
        return res.json({ success: true, message: `WhatsApp 连通成功！Meta Phone ID: ${data.id || whatsappPhoneNumberId}` });
      }
      return res.json({ success: false, error: `WhatsApp 校验失败 HTTP ${resp.status}: ${JSON.stringify(data).substring(0, 500)}` });
    } else if (channel === "dingtalk") {
      const { dingtalkAppKey, dingtalkAppSecret } = req.body;
      if (!dingtalkAppKey || !dingtalkAppSecret) {
        return res.json({ success: false, error: "缺少 钉钉 必填参数: AppKey 或 AppSecret" });
      }
      const url = `https://oapi.dingtalk.com/gettoken?appkey=${dingtalkAppKey}&appsecret=${dingtalkAppSecret}`;
      if (!(await isSafeUrl(url))) {
        return res.json({ success: false, error: "SSRF 安全验证未通过: 钉钉 API 端点不合法" });
      }
      const resp = await fetch(url, fetchOpts);
      const data = await resp.json();
      if (data.errcode === 0 && data.access_token) {
        return res.json({ success: true, message: "钉钉自建应用通道配置成功，Access Token 已握手成功。" });
      }
      return res.json({ success: false, error: `钉钉 API 校验失败 code ${data.errcode}: ${data.errmsg}` });
    } else if (channel === "qq_bot") {
      const { qqBotAppId, qqBotSecret } = req.body;
      if (!qqBotAppId || !qqBotSecret) {
        return res.json({ success: false, error: "缺少 QQ 机器人 必填参数: AppID 或 Secret" });
      }
      return res.json({
        success: true,
        message: "QQ 机器人凭证合法格式校验成功！提示：QQ 官方机器人的 WebSocket 由后端连接，将在容器启动后由 麦贝 Gateway 发起，请确保服务器网络畅通。"
      });
    } else if (channel === "wechat_mp") {
      const { wechatMpAppId, wechatMpAppSecret } = req.body;
      if (!wechatMpAppId || !wechatMpAppSecret) {
        return res.json({ success: false, error: "缺少 微信公众号 必填参数: AppID 或 AppSecret" });
      }
      const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${wechatMpAppId}&secret=${wechatMpAppSecret}`;
      if (!(await isSafeUrl(url))) {
        return res.json({ success: false, error: "SSRF 安全验证未通过: 微信 API 端点不合法" });
      }
      const resp = await fetch(url, fetchOpts);
      const data = await resp.json();
      if (data.access_token) {
        return res.json({ success: true, message: "微信公众号认证凭证通讯连通成功！已被接入。" });
      }
      return res.json({ success: false, error: `微信公众号校验失败 code ${data.errcode}: ${data.errmsg}` });
    } else if (channel === "weixin") {
      const { weixinAccountId, weixinToken, weixinBaseUrl } = req.body;
      if (!weixinAccountId || !weixinToken) {
        return res.json({ success: false, code: ErrorCodes.CREDENTIAL_FIELDS_REQUIRED, error: "缺少个人微信 iLink Bot 必填参数：账号 ID 或 Token" });
      }
      const baseUrl = String(weixinBaseUrl || "https://ilinkai.weixin.qq.com").trim().replace(/\/$/, "");
      let parsedBaseUrl: URL;
      try { parsedBaseUrl = new URL(baseUrl); } catch {
        return res.json({ success: false, code: ErrorCodes.CREDENTIAL_BASE_URL_UNSAFE, error: "个人微信 iLink API 地址无效" });
      }
      if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.hostname !== "ilinkai.weixin.qq.com") {
        return res.json({ success: false, code: ErrorCodes.CREDENTIAL_BASE_URL_UNSAFE, error: "为保护服务器安全，iLink API 只允许使用官方地址" });
      }
      const payload = JSON.stringify({ get_updates_buf: "", base_info: { channel_version: "2.2.0" } });
      const probeController = new AbortController();
      const probeTimeoutId = setTimeout(() => probeController.abort(), 8000);
      let resp: globalThis.Response;
      try {
        resp = await fetch(baseUrl + "/ilink/bot/getupdates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "AuthorizationType": "ilink_bot_token",
            "Authorization": "Bearer " + weixinToken,
            "Content-Length": String(Buffer.byteLength(payload)),
            "X-WECHAT-UIN": Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0))).toString("base64"),
            "iLink-App-Id": "bot",
            "iLink-App-ClientVersion": String((2 << 16) | (2 << 8))
          },
          body: payload,
          signal: probeController.signal
        });
      } catch (error: any) {
        if (error?.name === "AbortError") {
          return res.json({ success: true, message: "个人微信 iLink Bot 已连接，Runtime 启动后将继续接收消息。" });
        }
        throw error;
      } finally {
        clearTimeout(probeTimeoutId);
      }
      const result = await resp.json().catch(() => ({})) as any;
      const ret = result?.ret ?? result?.errcode;
      if (resp.ok && (ret === undefined || ret === 0)) {
        return res.json({ success: true, message: "个人微信 iLink Bot 凭据已验证，iLink API 连通成功。" });
      }
      const reason = String(result?.errmsg || result?.err_msg || "请检查二维码登录凭据是否仍有效").slice(0, 300);
      return res.json({ success: false, error: "个人微信 iLink Bot 连接验证失败" + (ret === undefined ? "" : " (code " + ret + ")") + "：" + reason });
    } else if (channel === "wecom") {
      const { wecomAppId, wecomAppSecret, wecomAgentId } = req.body;
      if (!wecomAppId || !wecomAppSecret || !wecomAgentId) {
        return res.json({ success: false, error: "缺少 企业微信 必填参数: CorpID, AppSecret 或 AgentID" });
      }
      const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${wecomAppId}&corpsecret=${wecomAppSecret}`;
      if (!(await isSafeUrl(url))) {
        return res.json({ success: false, error: "SSRF 安全验证未通过: 企微 API 端点不合法" });
      }
      const resp = await fetch(url, fetchOpts);
      const data = await resp.json();
      if (data.errcode === 0 && data.access_token) {
        return res.json({ success: true, message: `企业微信自建应用配置握手成功！AgentID: ${wecomAgentId}` });
      }
      return res.json({ success: false, error: `企业微信校验失败 code ${data.errcode}: ${data.errmsg}` });
    }

    return res.json({ success: false, error: "此渠道暂不支持真实测试环境连通性" });
  } catch (err: any) {
    return res.json({ success: false, error: `网络异常: ${formatError(err)}` });
  } finally {
    clearTimeout(timeoutId);
  }
});

router.post("/test-skill", authenticateToken, testLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { skillId } = req.body;
  if (!skillId) return res.json({ success: false, error: "缺少技能信息" });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    if (skillId === "tavily_search") {
      const { skillTavilyApiKey } = req.body;
      if (!skillTavilyApiKey) return res.status(400).json({ success: false, error: "缺少 API Key" });
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: skillTavilyApiKey, query: "test" }), signal: controller.signal
      });
      if (resp.ok) return res.json({ success: true, message: "Tavily API Key 测试成功" });
      if (resp.status === 401 || resp.status === 403) return res.json({ success: false, error: "鉴权失败：API Key 无效" });
      return res.json({ success: false, error: `调用失败 HTTP: ${resp.status}` });
    } else if (skillId === "google_search") {
      const { skillSerperApiKey } = req.body;
      if (!skillSerperApiKey) return res.status(400).json({ success: false, error: "缺少 API Key" });
      const resp = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "X-API-KEY": skillSerperApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: "test" }), signal: controller.signal
      });
      if (resp.ok) return res.json({ success: true, message: "Serper API Key 测试成功" });
      if (resp.status === 401 || resp.status === 403) return res.json({ success: false, error: "鉴权失败：API Key 无效" });
      return res.json({ success: false, error: `调用失败 HTTP: ${resp.status}` });
    } else if (skillId === "github") {
      const { skillGithubToken } = req.body;
      if (!skillGithubToken) return res.status(400).json({ success: false, error: "缺少 GitHub Token" });
      const resp = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${skillGithubToken}`, "User-Agent": "hermes-agent" }, signal: controller.signal
      });
      if (resp.ok) return res.json({ success: true, message: "GitHub Token 验证成功" });
      if (resp.status === 401 || resp.status === 403) return res.json({ success: false, error: "鉴权失败：Token 无效" });
      return res.json({ success: false, error: `调用失败 HTTP: ${resp.status}` });
    }

    return res.status(400).json({ success: false, error: "该技能没有测试器" });
  } catch (err: any) {
    return res.json({ success: false, error: `网络异常: ${formatError(err)}` });
  } finally {
    clearTimeout(timeoutId);
  }
});


export default router;

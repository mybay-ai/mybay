import crypto from "crypto";

export type ChannelQrKind = "feishu" | "lark" | "wecom_bot" | "weixin";
export type ChannelQrStatus = "pending" | "completed" | "expired" | "failed" | "cancelled";

export interface ChannelQrResult {
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuRegion?: "feishu" | "lark";
  wecomBotId?: string;
  wecomBotSecret?: string;
  weixinAccountId?: string;
  weixinToken?: string;
  weixinBaseUrl?: string;
}

export interface ChannelQrSession {
  id: string;
  userId: string;
  channel: ChannelQrKind;
  status: ChannelQrStatus;
  qrUrl?: string;
  result?: ChannelQrResult;
  errorCode?: string;
  createdAt: number;
  expiresAt: number;
  pollTimer?: ReturnType<typeof setInterval>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, ChannelQrSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

function baseUrls(channel: "feishu" | "lark") {
  return {
    accounts: channel === "lark" ? "https://accounts.larksuite.com" : "https://accounts.feishu.cn",
    open: channel === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn",
  };
}

async function postForm(url: string, body: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return payload as Record<string, any>;
  } finally {
    clearTimeout(timeout);
  }
}

async function beginFeishu(channel: "feishu" | "lark") {
  const urls = baseUrls(channel);
  const init = await postForm(`${urls.accounts}/oauth/v1/app/registration`, { action: "init" });
  if (!Array.isArray(init.supported_auth_methods) || !init.supported_auth_methods.includes("client_secret")) {
    throw new Error("FEISHU_QR_UNSUPPORTED");
  }
  const result = await postForm(`${urls.accounts}/oauth/v1/app/registration`, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });
  if (!result.device_code || !result.verification_uri_complete) throw new Error("FEISHU_QR_BEGIN_FAILED");
  const qrUrl = new URL(result.verification_uri_complete);
  qrUrl.searchParams.set("from", "hermes");
  qrUrl.searchParams.set("tp", "hermes");
  return {
    qrUrl: qrUrl.toString(),
    deviceCode: String(result.device_code),
    intervalMs: Math.max(2000, Number(result.interval || 5) * 1000),
    expiresAt: Date.now() + Math.min(Number(result.expire_in || 600), 600) * 1000,
    domain: channel,
  };
}

async function pollFeishu(session: ChannelQrSession, deviceCode: string, domain: "feishu" | "lark") {
  const urls = baseUrls(domain);
  const result = await postForm(`${urls.accounts}/oauth/v1/app/registration`, {
    action: "poll",
    device_code: deviceCode,
    tp: "ob_app",
  });
  if (result.client_id && result.client_secret) {
    complete(session, {
      feishuAppId: String(result.client_id),
      feishuAppSecret: String(result.client_secret),
      feishuRegion: domain,
    });
  } else if (["access_denied", "expired_token"].includes(String(result.error || ""))) {
    fail(session, String(result.error).toUpperCase());
  }
}

function classifyQrStartError(error: unknown, channel: ChannelQrKind): string {
  const candidate = error as any;
  const networkCode = String(candidate?.cause?.code || candidate?.code || "");
  if (
    candidate?.name === "AbortError" ||
    ["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(networkCode)
  ) {
    return channel === "weixin" ? "WEIXIN_QR_NETWORK_FAILED" : "QR_NETWORK_FAILED";
  }
  const message = String(candidate?.message || "QR_BEGIN_FAILED");
  return /^[A-Z0-9_]+$/.test(message) ? message : "QR_BEGIN_FAILED";
}

async function beginWeixin() {
  const response = await fetch('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3', {
    headers: { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String((2 << 16) | (2 << 8)), 'user-agent': 'HermesAgent/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || Number(payload.ret ?? 0) !== 0) throw new Error('WEIXIN_QR_SERVICE_FAILED');
  const qrcode = String(payload.qrcode || '');
  const qrUrl = String(payload.qrcode_img_content || '');
  if (!qrcode || !qrUrl) throw new Error('WEIXIN_QR_BEGIN_FAILED');
  return { qrcode, qrUrl, intervalMs: 2000, expiresAt: Date.now() + 8 * 60 * 1000 };
}

async function pollWeixin(session: ChannelQrSession, qrcode: string) {
  const url = 'https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=' + encodeURIComponent(qrcode);
  const response = await fetch(url, {
    headers: { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String((2 << 16) | (2 << 8)), 'user-agent': 'HermesAgent/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({})) as any;
  const status = String(payload.status || 'wait');
  if (status === 'expired') return fail(session, 'EXPIRED');
  if (status !== 'confirmed') return;
  const accountId = String(payload.ilink_bot_id || '');
  const token = String(payload.bot_token || '');
  if (!accountId || !token) return fail(session, 'WEIXIN_QR_RESULT_INVALID');
  complete(session, {
    weixinAccountId: accountId,
    weixinToken: token,
    weixinBaseUrl: String(payload.baseurl || 'https://ilinkai.weixin.qq.com'),
  });
}

async function beginWecomBot() {
  const generate = await fetch("https://work.weixin.qq.com/ai/qc/generate?source=hermes", {
    headers: { "user-agent": "HermesAgent/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await generate.json().catch(() => ({})) as any;
  const data = payload.data || {};
  if (!data.scode || !data.auth_url) throw new Error("WECOM_QR_BEGIN_FAILED");
  return {
    qrUrl: String(data.auth_url),
    scode: String(data.scode),
    intervalMs: 3000,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}

async function pollWecom(session: ChannelQrSession, scode: string) {
  const url = `https://work.weixin.qq.com/ai/qc/query_result?scode=${encodeURIComponent(scode)}`;
  const response = await fetch(url, { headers: { "user-agent": "HermesAgent/1.0" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const payload = await response.json().catch(() => ({})) as any;
  const data = payload.data || {};
  if (String(data.status || "").toLowerCase() !== "success") return;
  const bot = data.bot_info || {};
  if (!bot.botid && !bot.bot_id || !bot.secret) return fail(session, "WECOM_QR_RESULT_INVALID");
  complete(session, { wecomBotId: String(bot.botid || bot.bot_id), wecomBotSecret: String(bot.secret) });
}

function complete(session: ChannelQrSession, result: ChannelQrResult) {
  if (session.status !== "pending") return;
  session.status = "completed";
  session.result = result;
  if (session.pollTimer) clearInterval(session.pollTimer);
}

function fail(session: ChannelQrSession, errorCode: string) {
  if (session.status !== "pending") return;
  session.status = errorCode.includes("EXPIRED") ? "expired" : "failed";
  session.errorCode = errorCode;
  if (session.pollTimer) clearInterval(session.pollTimer);
}

export async function startChannelQrSession(userId: string, channel: ChannelQrKind) {
  const id = crypto.randomUUID();
  const session: ChannelQrSession = { id, userId, channel, status: "pending", createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(id, session);
  session.cleanupTimer = setTimeout(() => {
    if (session.pollTimer) clearInterval(session.pollTimer);
    sessions.delete(id);
  }, SESSION_TTL_MS + 60_000);
  session.cleanupTimer.unref?.();
  try {
    if (channel === "weixin") {
      const started = await beginWeixin();
      session.qrUrl = started.qrUrl;
      session.expiresAt = started.expiresAt;
      session.pollTimer = setInterval(() => void pollWeixin(session, started.qrcode).catch(() => {}), started.intervalMs);
    } else if (channel === "wecom_bot") {
      const started = await beginWecomBot();
      session.qrUrl = started.qrUrl;
      session.expiresAt = started.expiresAt;
      session.pollTimer = setInterval(() => void pollWecom(session, started.scode).catch(() => {}), started.intervalMs);
    } else {
      const started = await beginFeishu(channel);
      session.qrUrl = started.qrUrl;
      session.expiresAt = started.expiresAt;
      session.pollTimer = setInterval(() => void pollFeishu(session, started.deviceCode, started.domain).catch(() => {}), started.intervalMs);
    }
    return session;
  } catch (error) {
    fail(session, classifyQrStartError(error, channel));
    return session;
  }
}

export function getChannelQrSession(userId: string, id: string) {
  const session = sessions.get(id);
  if (!session || session.userId !== userId) return null;
  if (session.status === "pending" && Date.now() >= session.expiresAt) fail(session, "EXPIRED");
  return session;
}

export function cancelChannelQrSession(userId: string, id: string) {
  const session = getChannelQrSession(userId, id);
  if (!session) return null;
  session.status = "cancelled";
  if (session.pollTimer) clearInterval(session.pollTimer);
  return session;
}

export function publicChannelQrSession(session: ChannelQrSession) {
  return {
    id: session.id,
    channel: session.channel,
    status: session.status,
    qrUrl: session.status === "pending" ? session.qrUrl : undefined,
    result: session.status === "completed" ? session.result : undefined,
    errorCode: session.errorCode,
    expiresAt: session.expiresAt,
  };
}

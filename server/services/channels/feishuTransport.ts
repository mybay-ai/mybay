import * as Lark from "@larksuiteoapi/node-sdk";

/** Fixed Feishu endpoint; credentials are never sent to a user-provided URL. */
export class FeishuTransport {
  private token = "";
  private expiresAt = 0;
  private ws: Lark.WSClient | undefined;
  constructor(private appId: string, private appSecret: string) {}

  private async accessToken() {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    const body = await response.json();
    if (!response.ok || body.code !== 0 || !body.tenant_access_token) throw new Error("FEISHU_AUTH_FAILED");
    this.token = body.tenant_access_token;
    this.expiresAt = Date.now() + Math.max(0, Number(body.expire || 0) - 120) * 1000;
    return this.token;
  }

  private async request(path: string, body?: unknown) {
    const token = await this.accessToken();
    const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      // Retain only a numeric API code, never an SDK error/request/config object.
      throw new Error(`FEISHU_API_${Number(result.code) || response.status}`);
    }
    return result;
  }

  async botIdentity(): Promise<string> {
    const result = await this.request("/bot/v3/info/");
    const openId = result.bot?.open_id;
    if (typeof openId !== "string" || !/^ou_[A-Za-z0-9_-]+$/.test(openId)) throw new Error("FEISHU_BOT_NOT_ENABLED");
    return openId;
  }

  async connect(receive: (event: unknown) => void) {
    this.ws = new Lark.WSClient({ appId: this.appId, appSecret: this.appSecret,
      // SDK errors may contain request configuration; the worker reports safe states.
      logger: { debug() {}, info() {}, warn() {}, error() {}, trace() {} },
    });
    await this.ws.start({ eventDispatcher: new Lark.EventDispatcher({
      logger: { debug() {}, info() {}, warn() {}, error() {}, trace() {} },
    }).register({ "im.message.receive_v1": async event => { receive(event); } }) });
  }

  async reply(messageId: string, text: string, uuid: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) throw new Error("FEISHU_INVALID_MESSAGE_ID");
    await this.request(`/im/v1/messages/${messageId}/reply`, { msg_type: "text", content: JSON.stringify({ text }), uuid });
  }

  close() { this.ws?.close({ force: true }); this.ws = undefined; this.token = ""; }
}

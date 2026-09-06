const MAX_RESPONSE_BYTES = 32 * 1024;
const APPROVAL_TIMEOUT_MS = 300_000;
const GUARDED_TOOLS = new Set(["bash", "powershell", "write", "edit"]);

function approvalConfig(env = process.env) {
  const url = String(env.MYBAY_PI_APPROVAL_BRIDGE_URL || "").trim();
  const token = String(env.MYBAY_PI_APPROVAL_BRIDGE_TOKEN || "").trim();
  const sessionId = String(env.MYBAY_PI_SESSION_ID || "").trim();
  if (!/^http:\/\/127\.0\.0\.1:\d+\/internal\/approvals$/.test(url)
    || !/^[a-f0-9]{64}$/.test(token)
    || !/^[A-Za-z0-9_.:-]{8,160}$/.test(sessionId)) return null;
  return { url, token, sessionId };
}

function boundedText(value, maxLength) {
  return Array.from(String(value || ""), (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("").trim().slice(0, maxLength);
}

export function approvalSummary(event) {
  const toolName = boundedText(event?.toolName, 80).toLowerCase();
  const input = event?.input && typeof event.input === "object" && !Array.isArray(event.input) ? event.input : {};
  const rawPath = input.path ?? input.file_path ?? input.filePath;
  const path = typeof rawPath === "string" ? boundedText(rawPath, 300) : "";
  const command = ["bash", "powershell"].includes(toolName) ? boundedText(input.command, 700) : "";
  return {
    toolName,
    title: `Pi 请求执行 ${toolName || "工具"}`,
    description: path ? `将通过 ${toolName} 修改文件：${path}` : `将通过 Pi 执行 ${toolName || "工具"} 操作。`,
    ...(command ? { command } : {}),
  };
}

async function boundedJson(response) {
  if (!response.body) throw new Error("APPROVAL_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("APPROVAL_RESPONSE_LIMIT");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(text);
}

export async function requestApproval(config, event, signal, sessionApprovals = new Set(), fetchImpl = fetch) {
  const summary = approvalSummary(event);
  if (!GUARDED_TOOLS.has(summary.toolName) || sessionApprovals.has(summary.toolName)) return undefined;
  const response = await fetchImpl(config.url, {
    method: "POST",
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(APPROVAL_TIMEOUT_MS)]) : AbortSignal.timeout(APPROVAL_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: config.sessionId,
      approvalId: String(event.toolCallId || ""),
      ...summary,
    }),
  });
  const payload = await boundedJson(response);
  if (!response.ok || payload?.success !== true) {
    return { block: true, reason: payload?.error || `APPROVAL_HTTP_${response.status}`, terminate: true };
  }
  const choice = String(payload.choice || "deny").toLowerCase();
  // "always" is enforced by the bridge on every call so an administrator can
  // revoke it immediately without recycling the long-lived Pi process.
  if (choice === "session") sessionApprovals.add(summary.toolName);
  if (["once", "session", "always"].includes(choice)) return undefined;
  return { block: true, reason: "User denied this tool operation.", terminate: false };
}

export default function register(pi) {
  const config = approvalConfig();
  if (!config) return;
  const sessionApprovals = new Set();
  pi.on("tool_call", (event, ctx) => requestApproval(config, event, ctx?.signal, sessionApprovals));
}

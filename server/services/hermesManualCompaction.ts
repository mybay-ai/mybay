import { PassThrough } from "stream";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,160}$/;
const RESULT_PREFIX = "MYBAY_COMPACTION_JSON:";
const MAX_CAPTURE_BYTES = 128 * 1024;

export interface HermesCompactionResult {
  runtime: "hermes";
  status: "completed" | "aborted" | "failed";
  reason: "manual";
  previousSessionId: string;
  sessionId: string;
  tokensBefore: number | null;
  estimatedTokensAfter: number | null;
  messagesBefore: number | null;
  messagesAfter: number | null;
  error?: string;
}

const HERMES_COMPACTION_SCRIPT = String.raw`
import base64, json, sys
from cli import HermesCLI
from agent.model_metadata import estimate_request_tokens_rough

prefix = "MYBAY_COMPACTION_JSON:"
session_id = sys.argv[1]
payload = {
    "status": "failed", "reason": "manual", "previousSessionId": session_id,
    "sessionId": session_id, "tokensBefore": None, "estimatedTokensAfter": None,
    "messagesBefore": None, "messagesAfter": None,
}
try:
    cli = HermesCLI(resume=session_id, verbose=False, compact=True)
    if not cli._init_agent():
        raise RuntimeError("HERMES_SESSION_INIT_FAILED")
    original_session_id = cli.session_id
    original_history = list(cli.conversation_history)
    system_prompt = getattr(cli.agent, "_cached_system_prompt", "") or ""
    tools = getattr(cli.agent, "tools", None) or None
    tokens_before = estimate_request_tokens_rough(original_history, system_prompt=system_prompt, tools=tools)
    cli._manual_compress("/compress")
    tokens_after = estimate_request_tokens_rough(cli.conversation_history, system_prompt=system_prompt, tools=tools)
    payload.update({
        "previousSessionId": original_session_id,
        "sessionId": cli.session_id,
        "tokensBefore": int(tokens_before),
        "estimatedTokensAfter": int(tokens_after),
        "messagesBefore": len(original_history),
        "messagesAfter": len(cli.conversation_history),
    })
    if len(cli.conversation_history) < len(original_history) and tokens_after < tokens_before:
        payload["status"] = "completed"
    else:
        payload["status"] = "aborted"
        payload["error"] = "HERMES_COMPACTION_NOT_APPLIED"
except Exception as exc:
    payload["error"] = str(exc)[:240] or "HERMES_COMPACTION_FAILED"
encoded = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")
print(prefix + encoded)
`;

function boundedInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseHermesCompactionOutput(output: string): HermesCompactionResult | null {
  const marker = output.split(/\r?\n/).find((line) => line.trim().startsWith(RESULT_PREFIX));
  if (!marker) return null;
  try {
    const encoded = marker.trim().slice(RESULT_PREFIX.length);
    const value = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const previousSessionId = SESSION_ID_PATTERN.test(String(value.previousSessionId || "")) ? String(value.previousSessionId) : "";
    const sessionId = SESSION_ID_PATTERN.test(String(value.sessionId || "")) ? String(value.sessionId) : "";
    if (!previousSessionId || !sessionId) return null;
    const status = value.status === "completed" || value.status === "aborted" ? value.status : "failed";
    return {
      runtime: "hermes",
      status,
      reason: "manual",
      previousSessionId,
      sessionId,
      tokensBefore: boundedInteger(value.tokensBefore),
      estimatedTokensAfter: boundedInteger(value.estimatedTokensAfter),
      messagesBefore: boundedInteger(value.messagesBefore),
      messagesAfter: boundedInteger(value.messagesAfter),
      ...(value.error ? { error: String(value.error).slice(0, 240) } : {}),
    };
  } catch {
    return null;
  }
}

export async function runHermesManualCompaction(options: {
  dockerClient: any;
  instanceId: string;
  sessionId: string;
}): Promise<HermesCompactionResult> {
  if (!SESSION_ID_PATTERN.test(options.sessionId)) throw Object.assign(new Error("INVALID_SESSION_ID"), { statusCode: 400 });
  const container = options.dockerClient.getContainer(`mybay-agent-${options.instanceId}`);
  const exec = await container.exec({
    User: "hermes",
    WorkingDir: "/opt/data",
    AttachStdout: true,
    AttachStderr: true,
    Cmd: ["/usr/bin/timeout", "150", "/opt/hermes/.venv/bin/python", "-c", HERMES_COMPACTION_SCRIPT, options.sessionId],
  });
  const stream: any = await exec.start({ Detach: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let captured = "";
  const capture = (chunk: Buffer) => {
    captured = `${captured}${chunk.toString("utf8")}`.slice(-MAX_CAPTURE_BYTES);
  };
  stdout.on("data", capture);
  stderr.on("data", capture);
  container.modem.demuxStream(stream, stdout, stderr);
  await new Promise<void>((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  const result = parseHermesCompactionOutput(captured);
  if (!result) throw Object.assign(new Error("HERMES_COMPACTION_RESULT_UNAVAILABLE"), { statusCode: 502 });
  return result;
}

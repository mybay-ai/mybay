import http from "node:http";
import { A2A_INTERNAL_PORT } from "../../shared/a2aConfig";
import { resolveLocalInstanceTarget } from "../utils/localInstanceTarget";

export type A2AProbeResult = {
  state: "ready" | "unreachable" | "invalid_card";
  statusCode: number;
  durationMs: number;
  card?: { name?: string; description?: string; url?: string; capabilities?: any; skills?: any[] };
  error?: string;
};

export async function probeA2AAgentCard(instanceId: string, timeoutMs = 3000): Promise<A2AProbeResult> {
  const startedAt = Date.now();
  let target;
  try {
    target = await resolveLocalInstanceTarget(instanceId);
  } catch {
    return { state: "unreachable", statusCode: 0, durationMs: Date.now() - startedAt, error: "PRIVATE_NETWORK_UNAVAILABLE" };
  }

  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: A2AProbeResult) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    const request = http.request({
      hostname: target.hostname,
      port: A2A_INTERNAL_PORT,
      path: "/.well-known/agent-card.json",
      method: "GET",
      headers: { Host: target.hostname, Accept: "application/json" },
      timeout: timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          response.destroy();
          finish({ state: "invalid_card", statusCode: 413, durationMs: Date.now() - startedAt, error: "AGENT_CARD_TOO_LARGE" });
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const statusCode = response.statusCode || 0;
        if (statusCode < 200 || statusCode >= 300) {
          finish({ state: "unreachable", statusCode, durationMs: Date.now() - startedAt, error: "AGENT_CARD_HTTP_ERROR" });
          return;
        }
        try {
          const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!raw || typeof raw !== "object" || !raw.name) throw new Error("invalid card");
          finish({
            state: "ready",
            statusCode,
            durationMs: Date.now() - startedAt,
            card: {
              name: String(raw.name).slice(0, 128),
              description: raw.description ? String(raw.description).slice(0, 500) : undefined,
              url: raw.url ? String(raw.url).slice(0, 500) : undefined,
              capabilities: raw.capabilities,
              skills: Array.isArray(raw.skills) ? raw.skills.slice(0, 100) : [],
            },
          });
        } catch {
          finish({ state: "invalid_card", statusCode, durationMs: Date.now() - startedAt, error: "INVALID_AGENT_CARD" });
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      finish({ state: "unreachable", statusCode: 0, durationMs: Date.now() - startedAt, error: "ETIMEDOUT" });
    });
    request.on("error", (error: any) => {
      finish({ state: "unreachable", statusCode: 0, durationMs: Date.now() - startedAt, error: ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(error?.code) ? error.code : "A2A_CONNECT_FAILED" });
    });
    request.end();
  });
}

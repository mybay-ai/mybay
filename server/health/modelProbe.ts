import { PassThrough } from "node:stream";
import { providerRegistry } from "../../shared/providerRegistry";
export function sanitizeErrorMsg(errorMsg: string | null | undefined): string {
  if (!errorMsg) return "";
  // Regular expression to catch potential API keys (OpenAI, Anthropic, DeepSeek, generic headers, etc.)
  let clean = errorMsg.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-****masked");
  clean = clean.replace(/([a-zA-Z0-9]{4})[a-zA-Z0-9]{12,}([a-zA-Z0-9]{4})/g, "$1****$2");
  return clean;
}

export function normalizeProvider(provider: string): string {
  const p = (provider || '').toLowerCase().trim();
  
  const foundConfig = providerRegistry[p] as any;
  if (foundConfig) {
    return foundConfig.runtimeProvider || foundConfig.providerKey || foundConfig.id;
  }
  
  // try aliases
  for (const conf of Object.values(providerRegistry)) {
    const c = conf as any;
    if (c.aliases && c.aliases.includes(p)) {
      return c.runtimeProvider || c.providerKey || c.id;
    }
  }

  // legacy mapping
  if (p === 'custom' || p === 'custom-openai-compatible' || p === 'openai-compatible' || p === 'openai') return 'openai-api';
  
  return p;
}

export function matchModelNames(actual: string, expected: string): boolean {
  const act = (actual || '').toLowerCase().trim();
  const exp = (expected || '').toLowerCase().trim();
  return act === exp || act.includes(exp) || exp.includes(act);
}

export function checkRecentSessionsForAppliedModel(instanceId: string, expectedProvider: string, expectedModel: string): { success: boolean; sessionCount: number; lastSession?: any } {
  // SQLite is removed from primary and fallback data layers
  return { success: false, sessionCount: 0 };
}

export async function queryEndpoint(container: any, url: string): Promise<{ provider: string; model: string; raw: string; statusCode: number } | null> {
  const cmd = `curl -s -i "${url}" || wget -q -S -O - "${url}"`;
  try {
    const exec = await container.exec({
      Cmd: ['sh', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    return new Promise((resolve) => {
      exec.start({ Detach: false }, (err: any, stream: any) => {
        if (err) {
          resolve(null);
          return;
        }
        
        let output = '';
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        
        stream.on('end', () => {
          const rawRes = (output || "").trim();
          
          let statusCode = 200;
          const firstLine = rawRes.split(/\r?\n/)[0] || "";
          const matchStatus = firstLine.match(/HTTP\/\d\.\d\s+(\d+)/);
          if (matchStatus) {
            statusCode = parseInt(matchStatus[1], 10);
          } else if (rawRes.includes("401 Unauthorized") || rawRes.includes("HTTP/1.1 401") || rawRes.includes("HTTP/1.0 401")) {
            statusCode = 401;
          } else if (rawRes.includes("500 Internal Server Error") || rawRes.includes("HTTP/1.1 500") || rawRes.includes("HTTP/1.0 500")) {
            statusCode = 500;
          }

          if (statusCode === 401) {
            resolve({ provider: "401_unauthorized", model: "401_unauthorized", raw: rawRes, statusCode });
            return;
          }

          let cleanJson = rawRes;
          const jsonStartIndex = rawRes.indexOf('{');
          if (jsonStartIndex !== -1) {
            cleanJson = rawRes.substring(jsonStartIndex);
          }
          
          try {
            const parsed = JSON.parse(cleanJson);
            if (parsed) {
              const provider = parsed.provider || parsed.current_provider || parsed.selected_provider || (parsed.options && parsed.options.provider) || parsed.name || "";
              const model = parsed.model || parsed.current_model || parsed.selected_model || (parsed.options && parsed.options.model) || "";
              if (provider || model) {
                resolve({ provider, model, raw: rawRes, statusCode });
                return;
              }
            }
          } catch (e) {
            // Regex fallback
            const matchP = rawRes.match(/"current_provider"\s*:\s*"([^"]+)"|"provider"\s*:\s*"([^"]+)"/i);
            const matchM = rawRes.match(/"current_model"\s*:\s*"([^"]+)"|"model"\s*:\s*"([^"]+)"/i);
            if (matchP || matchM) {
              resolve({
                provider: matchP ? (matchP[1] || matchP[2]) : "",
                model: matchM ? (matchM[1] || matchM[2]) : "",
                raw: rawRes,
                statusCode
              });
              return;
            }
          }
          resolve({ provider: "", model: "", raw: rawRes, statusCode });
        });
      });
    });
  } catch (e) {
    return null;
  }
}

export async function verifyHermesModelApplied(container: any, internal_web_port: number, expectedProviderStr: string, expectedModelStr: string): Promise<{ ok: boolean; actualProvider: string; actualModel: string; message: string; isAuthRequired?: boolean }> {
  const endpoints = [
    `http://127.0.0.1:${internal_web_port}/api/auth/config`,
    `http://127.0.0.1:${internal_web_port}/api/config`,
    `http://127.0.0.1:${internal_web_port}/api/model/active`,
    `http://127.0.0.1:${internal_web_port}/api/model`,
    `http://127.0.0.1:${internal_web_port}/api/model/options`
  ];

  let bestResult: { provider: string; model: string; endpoint: string; statusCode: number } | null = null;
  let has401 = false;

  for (const url of endpoints) {
    const res = await queryEndpoint(container, url);
    if (res) {
      if (res.statusCode === 401) {
        has401 = true;
      }
      if (res.provider || res.model) {
        if (res.provider !== "401_unauthorized") {
          bestResult = {
            provider: res.provider,
            model: res.model,
            endpoint: url,
            statusCode: res.statusCode
          };
          break;
        }
      }
    }
  }

  if (has401 && (!bestResult || bestResult.provider === "401_unauthorized" || !bestResult.provider)) {
    return {
      ok: false,
      actualProvider: "unauthorized",
      actualModel: "unauthorized",
      isAuthRequired: true,
      message: "Hermes Dashboard API 接口返回了 401 未授权 (Unauthorized)，探针无权读取当前活动模型。"
    };
  }

  if (!bestResult) {
    return {
      ok: false,
      actualProvider: "unknown",
      actualModel: "unknown",
      message: "从所有备选接口中均未能解析出活动的 model/provider，服务器无响应或返回空数据。"
    };
  }

  const actualProvider = bestResult.provider;
  const actualModel = bestResult.model;

  const expP = expectedProviderStr.toLowerCase().trim();
  const expM = expectedModelStr.toLowerCase().trim();
  const actP = actualProvider.toLowerCase().trim();
  const actM = actualModel.toLowerCase().trim();

  const stdExpP = normalizeProvider(expP);
  const actPNormalized = normalizeProvider(actP);

  let pMatch = (actPNormalized === stdExpP);
  if (stdExpP === "openai-api" || stdExpP === "openai") {
    pMatch = (actPNormalized === "openai-api" || actPNormalized === "openai" || actPNormalized === "openai-compatible" || actPNormalized === "custom-openai-compatible");
  }
  
  const mMatch = matchModelNames(actualModel, expectedModelStr);

  if (pMatch && mMatch) {
    return { ok: true, actualProvider, actualModel, message: `模型配置和预期一致 (接口: ${bestResult.endpoint}, Provider: ${actualProvider}, Model: ${actualModel})` };
  } else {
    return { ok: false, actualProvider, actualModel, message: `模型配置不一致: 探测活动接口 ${bestResult.endpoint} 返回结果，预期为 ${stdExpP}/${expectedModelStr}，实际生效为 ${actualProvider}/${actualModel}` };
  }
}

export function shouldRunFunctionalChatProbe(): boolean {
  return process.env.MYBAY_DEPLOY_FUNCTIONAL_CHAT_PROBE === "true";
}

export async function testHermesModelCallable(
  container: any,
  apiKey: string,
  timeoutMs: number = 125000
): Promise<{ success: boolean; message: string }> {
  // We strictly test port 8642 inside the container
  const url = "http://127.0.0.1:8642/v1/chat/completions";
  const body = JSON.stringify({
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 5,
    stream: false
  });

  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let activeStream: any = null;

    const safeResolve = (res: { success: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(res);
    };

    // 1. Start application-level timer immediately, covering the entire lifecycle
    timer = setTimeout(() => {
      if (activeStream) {
        try {
          if (typeof activeStream.destroy === "function") {
            activeStream.destroy();
          } else if (typeof activeStream.end === "function") {
            activeStream.end();
          }
        } catch (e) {}
      }
      safeResolve({
        success: false,
        message: "接口测试调用超时 (Node application-level timeout)"
      });
    }, timeoutMs);

    // 2. Perform container.exec asynchronously
    (async () => {
      try {
        const cmd = [
          "curl",
          "-sS",
          "--connect-timeout", "5",
          "--max-time", "120",
          "-i",
          "-X", "POST",
          url,
          "-H", "Content-Type: application/json"
        ];
        if (apiKey) {
          cmd.push("-H", `Authorization: Bearer ${apiKey}`);
        }
        cmd.push("--data-binary", body);

        // Await the exec setup
        const exec = await container.exec({
          Cmd: cmd,
          AttachStdout: true,
          AttachStderr: true,
        });

        // If the execution setup took too long and timeout already resolved, discard
        if (settled) {
          return;
        }

        // 3. Perform exec.start
        exec.start({ Detach: false }, (err: any, stream: any) => {
          if (settled) {
            if (stream) {
              try {
                if (typeof stream.destroy === "function") stream.destroy();
              } catch (e) {}
            }
            return;
          }

          if (err) {
            safeResolve({
              success: false,
              message: `创建执行实例出错: ${err.message}`
            });
            return;
          }

          activeStream = stream;

          const stdoutStream = new PassThrough();
          const stderrStream = new PassThrough();
          let stdout = "";
          let stderr = "";

          stdoutStream.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
          });
          stderrStream.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
          });

          // Handle stream error
          stream.on("error", (streamErr: any) => {
            safeResolve({
              success: false,
              message: `容器执行流出错: ${streamErr.message}`
            });
          });

          // Use official Dockerode demux support
          container.modem.demuxStream(stream, stdoutStream, stderrStream);

          stream.on("end", () => {
            if (settled) return;

            const rawRes = stdout.trim();
            const firstLine = rawRes.split(/\r?\n/)[0] || "";
            
            let statusCode = 0; // Default to 0, do not default to 200 on failure
            const matchStatus = firstLine.match(/HTTP\/\d\.\d\s+(\d+)/);
            if (matchStatus) {
              statusCode = parseInt(matchStatus[1], 10);
            } else if (rawRes.includes("401 Unauthorized") || rawRes.includes("HTTP/1.1 401")) {
              statusCode = 401;
            } else if (rawRes.includes("500 Internal Server Error") || rawRes.includes("HTTP/1.1 500")) {
              statusCode = 500;
            }

            const lowerRes = rawRes.toLowerCase();
            const cleanResponseText = sanitizeErrorMsg(rawRes);

            if (statusCode >= 400 || statusCode === 0) {
              let errMsg = `HTTP ${statusCode}`;
              if (statusCode === 0) {
                errMsg = "未收到 HTTP 响应或无法解析状态码。";
              }
              try {
                const jsonStart = rawRes.indexOf('{');
                if (jsonStart !== -1) {
                  const parsed = JSON.parse(rawRes.substring(jsonStart));
                  errMsg = parsed.error?.message || parsed.error || parsed.message || errMsg;
                }
              } catch(e) {}
              
              if (lowerRes.includes("api key") && (lowerRes.includes("invalid") || lowerRes.includes("incorrect") || lowerRes.includes("expired"))) {
                errMsg = "API Key 校验未通过，服务商提示 Key 格式或有效性错误。";
              }
              if (lowerRes.includes("insufficient_quota") || lowerRes.includes("quota exceeded") || lowerRes.includes("credit")) {
                errMsg = "账户余额不足或已用尽（Quota Exceeded）。";
              }
              safeResolve({
                success: false,
                message: `接口测试返回错误: ${errMsg}`
              });
              return;
            }

            // Check if it returned a valid OpenAI chat completion
            const jsonStart = rawRes.indexOf('{');
            if (jsonStart === -1) {
              safeResolve({
                success: false,
                message: `接口返回非 JSON 响应: ${cleanResponseText}`
              });
              return;
            }

            try {
              const parsed = JSON.parse(rawRes.substring(jsonStart));
              if (parsed && Array.isArray(parsed.choices) && parsed.choices.length > 0 && parsed.choices[0].message && typeof parsed.choices[0].message.content === 'string') {
                safeResolve({
                  success: true,
                  message: `接口测试成功！模型已正常回复。`
                });
              } else {
                safeResolve({
                  success: false,
                  message: `JSON 响应中缺少 choices 结构: ${JSON.stringify(parsed)}`
                });
              }
            } catch (e: any) {
              safeResolve({
                success: false,
                message: `解析 JSON 失败: ${e.message}. 原始响应: ${cleanResponseText}`
              });
            }
          });
        });
      } catch (e: any) {
        safeResolve({
          success: false,
          message: `执行测试命令出错: ${e.message}`
        });
      }
    })();
  });
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";

export const A2A_SCENARIOS = [
  "hermes-to-pi",
  "pi-to-hermes",
  "parallel",
  "partial-failure",
  "group-cancellation",
  "refresh-recovery",
  "control-restart-recovery",
] as const;

type ScenarioName = typeof A2A_SCENARIOS[number];
type Verdict = "PASS" | "FAIL" | "NOT_RUN";
type RuntimeTarget = { instanceId: string; name: string };
type AcceptanceConfig = {
  baseUrl: string;
  controlContainer?: string;
  auth?: { usernameEnv?: string; passwordEnv?: string };
  runtimes: { hermes: RuntimeTarget; pi: RuntimeTarget };
  maxWaitMs?: number;
  pollMs?: number;
};
type ScenarioResult = {
  name: ScenarioName;
  verdict: Verdict;
  reason?: string;
  durationMs?: number;
  evidence?: Record<string, unknown>;
};

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "expired"]);

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: unknown, max = 160): string {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

export function summarizeResults(results: ScenarioResult[], strict: boolean) {
  const counts = results.reduce((all, result) => ({ ...all, [result.verdict]: all[result.verdict] + 1 }), { PASS: 0, FAIL: 0, NOT_RUN: 0 });
  return { ...counts, accepted: counts.FAIL === 0 && (!strict || counts.NOT_RUN === 0) };
}

export function evaluateCompletedScenario(input: {
  run: Record<string, any>;
  activity: Record<string, any>;
  expectedPeerId: string;
  marker: string;
}): { ok: boolean; reasons: string[]; evidence: Record<string, unknown> } {
  const { run, activity, expectedPeerId, marker } = input;
  const group = isObject(run.groupCollaboration) ? run.groupCollaboration : {};
  const selected = Array.isArray(group.selectedPeerIds) ? group.selectedPeerIds.map(String) : [];
  const activities = Array.isArray(activity.activities) ? activity.activities : [];
  const matching = activities.find((row: any) => row?.direction === "outbound" && String(row?.peerId) === expectedPeerId);
  const reasons: string[] = [];
  if (run.status !== "completed") reasons.push(`host run ended as ${bounded(run.status) || "unknown"}`);
  if (run.groupOutcome !== "completed") reasons.push(`run group outcome is ${bounded(run.groupOutcome) || "unknown"}`);
  if (!/^ctx-mybay-room-[A-Za-z0-9]{1,64}$/.test(String(group.contextId || ""))) reasons.push("run context id is missing or invalid");
  if (selected.length !== 1 || selected[0] !== expectedPeerId) reasons.push("persisted selected peer does not exactly match the expected peer");
  if (activity.groupOutcome !== "completed") reasons.push(`activity group outcome is ${bounded(activity.groupOutcome) || "unknown"}`);
  if (!matching) reasons.push("no matching outbound member activity was retained");
  else if (matching.status !== "completed") reasons.push(`member activity ended as ${bounded(matching.status) || "unknown"}`);
  if (!String(run.partialOutput || "").includes(marker)) reasons.push("host result does not contain the acceptance marker");
  return {
    ok: reasons.length === 0,
    reasons,
    evidence: {
      runId: bounded(run.id),
      runStatus: bounded(run.status),
      contextId: bounded(group.contextId),
      selectedPeerIds: selected,
      groupOutcome: bounded(run.groupOutcome),
      activityGroupOutcome: bounded(activity.groupOutcome),
      memberStatus: matching ? bounded(matching.status) : "missing",
      memberTaskId: matching ? bounded(matching.taskId) : null,
      markerObserved: String(run.partialOutput || "").includes(marker),
    },
  };
}

class ApiClient {
  private cookie = "";
  constructor(private readonly baseUrl: string) {}

  async login(username: string, password: string) {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) throw new Error(`login failed with HTTP ${response.status}`);
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const raw = getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get("set-cookie") || ""];
    this.cookie = raw.map(value => value.split(";", 1)[0]).filter(Boolean).join("; ");
    if (!this.cookie) throw new Error("login response did not set an authentication cookie");
  }

  async request(method: string, route: string, body?: unknown) {
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET" || method === "HEAD" ? {} : { origin: this.baseUrl }),
        cookie: this.cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let value: any = {};
    try { value = text ? JSON.parse(text) : {}; } catch { value = {}; }
    if (!response.ok) throw new Error(`${method} ${route} failed with HTTP ${response.status}: ${bounded(value?.error || value?.code || value?.message)}`);
    return value;
  }
}

function parseArgs(argv: string[]) {
  let configPath = "";
  let outputPath = "";
  let strict = false;
  let selected: ScenarioName[] = ["hermes-to-pi", "pi-to-hermes"];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") configPath = argv[++index] || "";
    else if (arg === "--output") outputPath = argv[++index] || "";
    else if (arg === "--strict") strict = true;
    else if (arg === "--scenarios") {
      const requested = String(argv[++index] || "").split(",").filter(Boolean);
      const invalid = requested.filter(name => !A2A_SCENARIOS.includes(name as ScenarioName));
      if (invalid.length) throw new Error(`unknown scenarios: ${invalid.join(", ")}`);
      selected = requested as ScenarioName[];
    }
  }
  if (!configPath) throw new Error("--config is required");
  return { configPath: path.resolve(configPath), outputPath: outputPath ? path.resolve(outputPath) : "", strict, selected };
}

function readConfig(file: string): AcceptanceConfig {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isObject(value) || !isObject(value.runtimes) || !isObject(value.runtimes.hermes) || !isObject(value.runtimes.pi)) throw new Error("invalid acceptance config");
  const baseUrl = String(value.baseUrl || "").replace(/\/$/, "");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error("baseUrl must be a loopback HTTP URL");
  for (const target of [value.runtimes.hermes, value.runtimes.pi]) {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(String(target.instanceId || "")) || !String(target.name || "").trim()) throw new Error("runtime instanceId and name are required");
  }
  return value as AcceptanceConfig;
}

async function waitForRun(client: ApiClient, instanceId: string, runId: string, maxWaitMs: number, pollMs: number) {
  const deadline = Date.now() + maxWaitMs;
  let last: any = null;
  while (Date.now() < deadline) {
    last = (await client.request("GET", `/api/instances/${instanceId}/runs/${runId}`)).run;
    if (TERMINAL_RUN_STATES.has(String(last?.status))) return last;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`run ${runId} did not become terminal; last state was ${bounded(last?.status) || "unknown"}`);
}

async function preflight(client: ApiClient, host: RuntimeTarget, peer: RuntimeTarget) {
  const status = await client.request("GET", `/api/instances/${host.instanceId}/a2a/status`);
  const member = Array.isArray(status.peers) ? status.peers.find((row: any) => String(row?.id) === peer.instanceId) : null;
  if (status.state !== "ready" || status.toolState !== "ready" || member?.state !== "ready" || member?.setupIssue) {
    throw new Error(`A2A preflight is not ready (caller=${bounded(status.state)}, tools=${bounded(status.toolState)}, peer=${bounded(member?.state)}, issue=${bounded(member?.setupIssue)})`);
  }
  return { callerState: status.state, toolState: status.toolState, peerState: member.state };
}

async function runDirection(client: ApiClient, name: ScenarioName, host: RuntimeTarget, peer: RuntimeTarget, maxWaitMs: number, pollMs: number): Promise<ScenarioResult> {
  const startedAt = Date.now();
  const marker = `MYBAY_A2A_${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  try {
    const preflightEvidence = await preflight(client, host, peer);
    const created = await client.request("POST", `/api/instances/${host.instanceId}/conversations`, { title: `A2A acceptance ${name} ${new Date().toISOString()}` });
    const conversationId = String(created?.conversation?.id || "");
    if (!conversationId) throw new Error("conversation creation returned no id");
    await client.request("PATCH", `/api/instances/${host.instanceId}/conversations/${conversationId}`, {
      collaboration: { mode: "group", peerIds: [peer.instanceId], maxRounds: 1 },
    });
    const submitted = await client.request("POST", `/api/instances/${host.instanceId}/runs`, {
      conversationId,
      requestId: crypto.randomUUID(),
      reasoningEffort: "quick",
      content: `@${peer.name} 主持 Agent 必须使用 A2A 委派工具实际调用该成员，不能自行模拟成员结果。发送给成员的任务是：只返回标记 ${marker}，成员不要调用工具或请求审批。收到真实成员结果后，主持 Agent 的最终回答必须原样包含该成员标记。`,
    });
    const runId = String(submitted.runId || submitted.run?.id || "");
    if (!runId) throw new Error("run submission returned no id");
    const run = await waitForRun(client, host.instanceId, runId, maxWaitMs, pollMs);
    const contextId = String(run?.groupCollaboration?.contextId || "");
    const activity = contextId
      ? await client.request("GET", `/api/instances/${host.instanceId}/a2a/activity?roomContextId=${encodeURIComponent(contextId)}&limit=20`)
      : {};
    const evaluated = evaluateCompletedScenario({ run, activity, expectedPeerId: peer.instanceId, marker });
    return {
      name,
      verdict: evaluated.ok ? "PASS" : "FAIL",
      ...(evaluated.ok ? {} : { reason: evaluated.reasons.join("; ") }),
      durationMs: Date.now() - startedAt,
      evidence: { host: { instanceId: host.instanceId, name: host.name }, peer: { instanceId: peer.instanceId, name: peer.name }, conversationId, ...preflightEvidence, ...evaluated.evidence },
    };
  } catch (error: any) {
    return { name, verdict: "FAIL", reason: bounded(error?.message || error, 500), durationMs: Date.now() - startedAt, evidence: { host: { instanceId: host.instanceId, name: host.name }, peer: { instanceId: peer.instanceId, name: peer.name } } };
  }
}

async function runParallel(client: ApiClient, config: AcceptanceConfig): Promise<ScenarioResult> {
  const startedAt = Date.now();
  const [forward, reverse] = await Promise.all([
    runDirection(client, "parallel", config.runtimes.hermes, config.runtimes.pi, config.maxWaitMs || 180_000, config.pollMs || 1_000),
    runDirection(client, "parallel", config.runtimes.pi, config.runtimes.hermes, config.maxWaitMs || 180_000, config.pollMs || 1_000),
  ]);
  const failed = [forward, reverse].filter(result => result.verdict !== "PASS");
  return {
    name: "parallel",
    verdict: failed.length ? "FAIL" : "PASS",
    ...(failed.length ? { reason: failed.map(result => result.reason || "parallel direction failed").join("; ") } : {}),
    durationMs: Date.now() - startedAt,
    evidence: { directions: [forward.evidence, reverse.evidence] },
  };
}

async function runRefreshRecovery(client: ApiClient, config: AcceptanceConfig): Promise<ScenarioResult> {
  const startedAt = Date.now();
  const baseline = await runDirection(client, "refresh-recovery", config.runtimes.hermes, config.runtimes.pi, config.maxWaitMs || 180_000, config.pollMs || 1_000);
  if (baseline.verdict !== "PASS") return baseline;
  try {
    const evidence = baseline.evidence || {};
    const contextId = String(evidence.contextId || "");
    const taskId = String(evidence.memberTaskId || "");
    const peerId = config.runtimes.pi.instanceId;
    const query = new URLSearchParams({ contextId, taskId, peerId, refreshRemote: "1", roomContextId: contextId, limit: "20" });
    const activity = await client.request("GET", `/api/instances/${config.runtimes.hermes.instanceId}/a2a/activity?${query}`);
    const matching = Array.isArray(activity.activities)
      ? activity.activities.find((row: any) => String(row?.taskId) === taskId && String(row?.peerId) === peerId)
      : null;
    const remoteState = bounded(matching?.remoteMapping?.remoteState);
    const recordState = bounded(matching?.remoteMapping?.recordState);
    const ok = activity.groupOutcome === "completed" && matching?.status === "completed"
      && recordState === "finished" && /completed$/i.test(remoteState);
    return {
      name: "refresh-recovery",
      verdict: ok ? "PASS" : "FAIL",
      ...(ok ? {} : { reason: "refreshed recovery evidence did not converge to a retained completed remote mapping" }),
      durationMs: Date.now() - startedAt,
      evidence: { ...evidence, refreshRequested: true, refreshedMemberStatus: bounded(matching?.status) || "missing", remoteRecordState: recordState || "missing", remoteState: remoteState || "missing" },
    };
  } catch (error: any) {
    return { name: "refresh-recovery", verdict: "FAIL", reason: bounded(error?.message || error, 500), durationMs: Date.now() - startedAt, evidence: baseline.evidence };
  }
}

export function evaluateCancelledScenario(run: any, activity: any, expectedPeerId: string): boolean {
  const member = Array.isArray(activity?.activities)
    ? activity.activities.find((row: any) => row?.direction === "outbound" && String(row?.peerId) === expectedPeerId) : null;
  const mapping = member?.remoteMapping;
  const selected = run?.groupCollaboration?.selectedPeerIds;
  return run?.status === "cancelled" && run?.groupOutcome === "cancelled" && activity?.groupOutcome === "cancelled"
    && Array.isArray(selected) && selected.length === 1 && selected[0] === expectedPeerId
    && member?.status === "cancelled" && Boolean(member?.taskId) && Boolean(mapping?.remoteTaskId)
    && mapping?.cancelState === "confirmed" && mapping?.recordState === "finished"
    && ["task_state_canceled", "task_state_cancelled", "canceled", "cancelled"].includes(String(mapping?.remoteState).toLowerCase());
}

async function runGroupCancellation(client: ApiClient, config: AcceptanceConfig): Promise<ScenarioResult> {
  const startedAt = Date.now();
  const host = config.runtimes.hermes;
  const peer = config.runtimes.pi;
  try {
    const preflightEvidence = await preflight(client, host, peer);
    const created = await client.request("POST", `/api/instances/${host.instanceId}/conversations`, { title: `A2A cancellation acceptance ${new Date().toISOString()}` });
    const conversationId = String(created?.conversation?.id || "");
    await client.request("PATCH", `/api/instances/${host.instanceId}/conversations/${conversationId}`, { collaboration: { mode: "group", peerIds: [peer.instanceId], maxRounds: 1 } });
    const submitted = await client.request("POST", `/api/instances/${host.instanceId}/runs`, {
      conversationId,
      requestId: crypto.randomUUID(),
      reasoningEffort: "balanced",
      content: `@${peer.name} 请执行一项需要持续仔细推理的长任务：逐项生成并复核 100 个编号结论，在全部完成前不要提前返回。`,
    });
    const runId = String(submitted.runId || submitted.run?.id || "");
    const dispatchDeadline = Date.now() + Math.min(config.maxWaitMs || 180_000, 90_000);
    let run: any = null;
    let activity: any = null;
    let member: any = null;
    while (Date.now() < dispatchDeadline) {
      run = (await client.request("GET", `/api/instances/${host.instanceId}/runs/${runId}`)).run;
      const contextId = String(run?.groupCollaboration?.contextId || "");
      if (contextId) {
        activity = await client.request("GET", `/api/instances/${host.instanceId}/a2a/activity?roomContextId=${encodeURIComponent(contextId)}&limit=20`);
        member = Array.isArray(activity.activities) ? activity.activities.find((row: any) => String(row?.peerId) === peer.instanceId) : null;
      }
      if (member && member.status === "in_progress") break;
      if (TERMINAL_RUN_STATES.has(String(run?.status))) throw new Error("member task became terminal before cancellation could be issued");
      await new Promise(resolve => setTimeout(resolve, config.pollMs || 1_000));
    }
    if (!member || member.status !== "in_progress") throw new Error("no in-progress member task was observed before the cancellation deadline");
    const stopped = await client.request("POST", `/api/instances/${host.instanceId}/runs/${runId}/stop`, {});
    run = await waitForRun(client, host.instanceId, runId, config.maxWaitMs || 180_000, config.pollMs || 1_000);
    const contextId = String(run?.groupCollaboration?.contextId || "");
    // A remote ID can arrive after the host stop. Wait for verified persisted
    // compensation, rather than treating the immediate acknowledgement as proof.
    const cancellationDeadline = Date.now() + Math.min(config.maxWaitMs || 180_000, 60_000);
    do {
      run = (await client.request("GET", `/api/instances/${host.instanceId}/runs/${runId}`)).run;
      activity = await client.request("GET", `/api/instances/${host.instanceId}/a2a/activity?roomContextId=${encodeURIComponent(contextId)}&limit=20`);
      if (evaluateCancelledScenario(run, activity, peer.instanceId)) break;
      await new Promise(resolve => setTimeout(resolve, config.pollMs || 1_000));
    } while (Date.now() < cancellationDeadline);
    member = Array.isArray(activity.activities) ? activity.activities.find((row: any) => String(row?.peerId) === peer.instanceId) : null;
    const cancellation = isObject(stopped.groupCancellation) ? stopped.groupCancellation : {};
    const ok = evaluateCancelledScenario(run, activity, peer.instanceId);
    return {
      name: "group-cancellation",
      verdict: ok ? "PASS" : "FAIL",
      ...(ok ? {} : { reason: "host and retained member cancellation evidence did not converge" }),
      durationMs: Date.now() - startedAt,
      evidence: { host: { instanceId: host.instanceId, name: host.name }, peer: { instanceId: peer.instanceId, name: peer.name }, conversationId, runId, contextId, ...preflightEvidence, runStatus: bounded(run.status), groupOutcome: bounded(run.groupOutcome), activityGroupOutcome: bounded(activity.groupOutcome), memberStatus: bounded(member?.status) || "missing", memberTaskId: bounded(member?.taskId), remoteTaskId: bounded(member?.remoteMapping?.remoteTaskId), cancelState: bounded(member?.remoteMapping?.cancelState), remoteState: bounded(member?.remoteMapping?.remoteState), recordState: bounded(member?.remoteMapping?.recordState), cancellation: { attempted: Number(cancellation.attempted) || 0, confirmed: Number(cancellation.confirmed) || 0, unconfirmed: Number(cancellation.unconfirmed) || 0 } },
    };
  } catch (error: any) {
    return { name: "group-cancellation", verdict: "FAIL", reason: bounded(error?.message || error, 500), durationMs: Date.now() - startedAt, evidence: { host: { instanceId: host.instanceId, name: host.name }, peer: { instanceId: peer.instanceId, name: peer.name } } };
  }
}

async function runControlRestartRecovery(client: ApiClient, config: AcceptanceConfig, username: string, password: string): Promise<ScenarioResult> {
  const startedAt = Date.now();
  if (!config.controlContainer) return { name: "control-restart-recovery", verdict: "NOT_RUN", reason: "controlContainer is not configured" };
  if (!/^mybay-[A-Za-z0-9_.-]{1,100}$/.test(config.controlContainer)) return { name: "control-restart-recovery", verdict: "FAIL", reason: "controlContainer is invalid" };
  const baseline = await runDirection(client, "control-restart-recovery", config.runtimes.hermes, config.runtimes.pi, config.maxWaitMs || 180_000, config.pollMs || 1_000);
  if (baseline.verdict !== "PASS") return baseline;
  try {
    const { default: Docker } = await import("dockerode");
    await new Docker().getContainer(config.controlContainer).restart();
    const deadline = Date.now() + 60_000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${config.baseUrl}/api/health`, { signal: AbortSignal.timeout(3_000) });
        healthy = response.ok;
        if (healthy) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    if (!healthy) throw new Error("control plane did not become healthy after restart");
    await client.login(username, password);
    const evidence = baseline.evidence || {};
    const runId = String(evidence.runId || "");
    const contextId = String(evidence.contextId || "");
    const run = (await client.request("GET", `/api/instances/${config.runtimes.hermes.instanceId}/runs/${runId}`)).run;
    const activity = await client.request("GET", `/api/instances/${config.runtimes.hermes.instanceId}/a2a/activity?roomContextId=${encodeURIComponent(contextId)}&limit=20`);
    const evaluated = evaluateCompletedScenario({ run, activity, expectedPeerId: config.runtimes.pi.instanceId, marker: "" });
    const markerIndependentReasons = evaluated.reasons.filter(reason => reason !== "host result does not contain the acceptance marker");
    const sameContext = String(run?.groupCollaboration?.contextId || "") === contextId;
    const ok = markerIndependentReasons.length === 0 && sameContext;
    return {
      name: "control-restart-recovery",
      verdict: ok ? "PASS" : "FAIL",
      ...(ok ? {} : { reason: [...markerIndependentReasons, ...(sameContext ? [] : ["room context changed after restart"])].join("; ") }),
      durationMs: Date.now() - startedAt,
      evidence: { ...evidence, controlRestarted: true, healthRecovered: healthy, persistedRunStatus: bounded(run?.status), persistedGroupOutcome: bounded(run?.groupOutcome), persistedActivityGroupOutcome: bounded(activity?.groupOutcome), sameContext },
    };
  } catch (error: any) {
    return { name: "control-restart-recovery", verdict: "FAIL", reason: bounded(error?.message || error, 500), durationMs: Date.now() - startedAt, evidence: baseline.evidence };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const config = readConfig(args.configPath);
  const usernameEnv = config.auth?.usernameEnv || "MYBAY_ACCEPTANCE_USERNAME";
  const passwordEnv = config.auth?.passwordEnv || "MYBAY_ACCEPTANCE_PASSWORD";
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];
  if (!username || !password) throw new Error(`credentials must be supplied through ${usernameEnv} and ${passwordEnv}`);
  const client = new ApiClient(config.baseUrl);
  await client.login(username, password);
  const results: ScenarioResult[] = [];
  const selected = new Set(args.selected);
  for (const scenario of A2A_SCENARIOS) {
    if (!selected.has(scenario)) {
      results.push({ name: scenario, verdict: "NOT_RUN", reason: "scenario was not selected" });
      continue;
    }
    if (scenario === "hermes-to-pi") results.push(await runDirection(client, scenario, config.runtimes.hermes, config.runtimes.pi, config.maxWaitMs || 180_000, config.pollMs || 1_000));
    else if (scenario === "pi-to-hermes") results.push(await runDirection(client, scenario, config.runtimes.pi, config.runtimes.hermes, config.maxWaitMs || 180_000, config.pollMs || 1_000));
    else if (scenario === "parallel") results.push(await runParallel(client, config));
    else if (scenario === "group-cancellation") results.push(await runGroupCancellation(client, config));
    else if (scenario === "refresh-recovery") results.push(await runRefreshRecovery(client, config));
    else if (scenario === "control-restart-recovery") results.push(await runControlRestartRecovery(client, config, username, password));
    else results.push({ name: scenario, verdict: "NOT_RUN", reason: "scenario is declared but is not implemented by this runner version" });
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    target: { baseUrl: config.baseUrl, runtimes: config.runtimes },
    strict: args.strict,
    results,
    summary: summarizeResults(results, args.strict),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (args.outputPath) {
    fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
    fs.writeFileSync(args.outputPath, serialized, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(serialized);
  if (!report.summary.accepted) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`A2A acceptance failed: ${bounded((error as Error)?.message || error, 500)}\n`);
    process.exitCode = 1;
  });
}

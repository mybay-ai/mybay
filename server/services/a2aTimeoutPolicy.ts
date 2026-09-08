const DEFAULT_A2A_TASK_WAIT_MS = 300_000;
const MIN_A2A_TASK_WAIT_MS = 30_000;
const MAX_A2A_TASK_WAIT_MS = 900_000;

export function resolveA2ATaskWaitMs(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env.MYBAY_A2A_TASK_WAIT_MS);
  if (!Number.isFinite(requested)) return DEFAULT_A2A_TASK_WAIT_MS;
  return Math.min(MAX_A2A_TASK_WAIT_MS, Math.max(MIN_A2A_TASK_WAIT_MS, Math.floor(requested)));
}

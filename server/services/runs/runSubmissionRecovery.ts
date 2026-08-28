import type { RuntimeRequestResult as RunsRequestResult } from "../../runtime/contracts";

export interface IdempotentRunSubmissionOptions {
  submit(): Promise<RunsRequestResult>;
  recover(): Promise<RunsRequestResult>;
  shouldContinue?(): Promise<boolean>;
  sleep?(ms: number): Promise<void>;
  maxSubmitRetries?: number;
  maxRecoveryChecks?: number;
}

export function isTransientRunSubmissionFailure(result: RunsRequestResult): boolean {
  if ([408, 425, 429, 502, 503, 504].includes(Number(result.statusCode))) return true;
  return /TIMEOUT|ECONN|CONNECT|UNAVAILABLE|NOT[_ ]READY|SOCKET|RESET/i.test(String(result.error || ""));
}

export async function submitRunWithIdempotentRecovery({
  submit,
  recover,
  shouldContinue = async () => true,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxSubmitRetries = 2,
  maxRecoveryChecks = 3,
}: IdempotentRunSubmissionOptions): Promise<RunsRequestResult> {
  let result = await submit();
  let submitRetries = 0;

  while (!result.ok && isTransientRunSubmissionFailure(result) && submitRetries < maxSubmitRetries) {
    let confirmedMissing = false;
    for (let recoveryAttempt = 0; recoveryAttempt < maxRecoveryChecks; recoveryAttempt += 1) {
      if (!await shouldContinue()) return result;
      const recovery = await recover();
      if (recovery.ok && recovery.json?.found === true && recovery.json?.id) {
        return { ...recovery, ok: true, json: { ...recovery.json, id: String(recovery.json.id), recovered: true } };
      }
      if (recovery.ok && recovery.json?.found === false) {
        confirmedMissing = true;
        break;
      }
      if (recoveryAttempt + 1 < maxRecoveryChecks) await sleep(Math.min(2_000, 300 * (2 ** recoveryAttempt)));
    }
    if (!confirmedMissing || !await shouldContinue()) return result;
    await sleep(Math.min(2_000, 500 * (2 ** submitRetries)));
    submitRetries += 1;
    result = await submit();
  }
  return result;
}

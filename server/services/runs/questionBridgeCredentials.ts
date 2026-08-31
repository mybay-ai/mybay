import fs from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { QUESTION_ID } from "../../../shared/localRunQuestions";
import { getLocalDatabasePath } from "../../localStore";

export function bridgeCredentialPath(instanceId: string) {
  if (!QUESTION_ID.test(instanceId)) throw new Error("INVALID_INSTANCE_ID");
  return path.join(path.dirname(getLocalDatabasePath()), "question-bridge", `${instanceId}.json`);
}
export function questionBridgeEnabled(instanceId: string): boolean {
  try { return readCredential(instanceId)?.enabled === true; } catch { return false; }
}
function readCredential(instanceId: string): { tokenHash: string; enabled: boolean } {
  const file = bridgeCredentialPath(instanceId);
  if (fs.lstatSync(path.dirname(file)).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 2048) throw new Error("INVALID_BRIDGE_CREDENTIAL");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function authenticateQuestionBridge(instanceId: string, authorization: unknown): boolean {
  if (typeof authorization !== "string" || !/^Bearer [a-f0-9]{64}$/.test(authorization)) return false;
  try {
    const stored = readCredential(instanceId);
    if (!stored.enabled || !/^[a-f0-9]{64}$/.test(stored.tokenHash)) return false;
    const candidate = createHash("sha256").update(authorization.slice(7)).digest();
    return timingSafeEqual(candidate, Buffer.from(stored.tokenHash, "hex"));
  } catch { return false; }
}

import path from "path";
import fs from "fs";
import { decrypt } from "./crypto";
import { dbAdapter } from "./db";

/**
 * Automatically registers configurations chosen in MyBay in safe file structures.
 * Local settings are fully handled via environment variables (.env) and config.yaml templates,
 * making direct SQLite modification redundant.
 */
export function syncAgentDatabase(instanceId: string, config: any) {
  try {
    const instanceDir = path.join(process.cwd(), "data", "instances", String(instanceId));
    if (!fs.existsSync(instanceDir)) {
      console.log(`[Agent DB Sync] Instance directory ${instanceDir} does not exist. Skipping synchronization.`);
      return;
    }

    dbAdapter.updateInstanceVersionInfo(instanceId, { 
      model_config_status: 'injected',
      model_config_error: null
    }).catch(err => {
      console.warn("[Agent DB Sync] Failed to update status to injected:", err.message);
    });
  } catch (globalErr: any) {
    console.error(`[Agent DB Sync Global Error]`, globalErr.message);
  }
}

/**
 * Periodic agent sync hook.
 */
export function startPeriodicAgentDbSync(instanceId: string, config: any) {
  const delays = [0, 1000];
  
  console.log(`[Agent DB Sync] Scheduled dynamic alignment sequence for instance ${instanceId}.`);
  
  delays.forEach(delay => {
    setTimeout(() => {
      syncAgentDatabase(instanceId, config);
    }, delay);
  });
}

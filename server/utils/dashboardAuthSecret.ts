import crypto from "crypto";
import { decrypt, encrypt, tryResolvePlainInstancePassword } from "../crypto";

export function generateDashboardAuthSecret(): string {
  return `mb_dash_${crypto.randomBytes(32).toString("hex")}`;
}

export function isValidDashboardAuthSecret(value: unknown): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 16;
}

function tryDecryptSecret(value: unknown): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  try {
    const decrypted = decrypt(value);
    return isValidDashboardAuthSecret(decrypted) ? decrypted : null;
  } catch {
    return null;
  }
}

export function ensureEncryptedDashboardAuthSecret(config: any): boolean {
  if (!config || typeof config !== "object") {
    return false;
  }

  const plainLoginPassword = tryResolvePlainInstancePassword(config);
  const hermesSecret = tryDecryptSecret(config.hermesDashboardAuthSecret);
  if (hermesSecret && hermesSecret !== plainLoginPassword) {
    const dashboardSecret = tryDecryptSecret(config.dashboardAuthSecret);
    if (dashboardSecret === hermesSecret) {
      return false;
    }
    config.dashboardAuthSecret = encrypt(hermesSecret);
    return true;
  }

  const dashboardSecret = tryDecryptSecret(config.dashboardAuthSecret);
  if (dashboardSecret && dashboardSecret !== plainLoginPassword) {
    config.hermesDashboardAuthSecret = encrypt(dashboardSecret);
    return true;
  }

  const generatedSecret = generateDashboardAuthSecret();
  const encryptedSecret = encrypt(generatedSecret);
  config.hermesDashboardAuthSecret = encryptedSecret;
  config.dashboardAuthSecret = encryptedSecret;
  return true;
}

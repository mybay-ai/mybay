export type WebhookAuthMode = "secret-required" | "legacy-open";
import crypto from "node:crypto";
export type DeploymentMode = "desktop" | "lan" | "server";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function isLegacyOpenWebhookOptInEnabled(value = process.env.MYBAY_ALLOW_LEGACY_OPEN_WEBHOOKS): boolean {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

export function resolveWebhookAuthMode(options: {
  configuredMode?: unknown;
  hasSecret: boolean;
  legacyOptIn?: boolean;
}): WebhookAuthMode {
  if (options.hasSecret) return "secret-required";
  const configuredMode = String(options.configuredMode || "").trim().toLowerCase();
  if (configuredMode === "legacy-open" && options.legacyOptIn === true) return "legacy-open";
  return "secret-required";
}
export function isWebhookSecretValid(received: unknown, expected: string): boolean {
  if (typeof received !== "string" || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}


export function currentDeploymentMode(value = process.env.DEPLOYMENT_MODE): DeploymentMode {
  const normalized = String(value || "desktop").trim().toLowerCase();
  return normalized === "lan" || normalized === "server" ? normalized : "desktop";
}

export function legacyOpenWebhookWarning(mode = currentDeploymentMode()): string {
  const scope = mode === "server"
    ? "PUBLIC SERVER SECURITY WARNING"
    : mode === "lan"
      ? "LAN SECURITY WARNING"
      : "DESKTOP COMPATIBILITY WARNING";
  return `[Webhook Security] ${scope}: MYBAY_ALLOW_LEGACY_OPEN_WEBHOOKS is enabled. Webhooks explicitly configured as legacy-open can run without a secret. Disable this option and configure a webhook secret as soon as possible.`;
}

export function warnIfLegacyOpenWebhooksEnabled(logger: Pick<Console, "warn"> = console): boolean {
  if (!isLegacyOpenWebhookOptInEnabled()) return false;
  logger.warn(legacyOpenWebhookWarning());
  return true;
}

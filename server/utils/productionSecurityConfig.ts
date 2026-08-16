export const KNOWN_INSECURE_PLACEHOLDERS = new Set([
  "change-me-now",
  "changeme",
  "replace-with-a-random-32-byte-secret",
  "replace-with-a-64-character-hex-secret",
  "replace-with-a-64-character-hex-routing-secret",
  "your-secret",
  "your-api-key",
  "example-secret",
  "default-secret",
]);

const HEX_64 = /^[a-fA-F0-9]{64}$/;

function isObviouslyWeakSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^(.)\1+$/.test(normalized) || /^(?:password|secret|jwt|default|changeme)(?:[-_]?\d*)?$/.test(normalized);
}

export class ProductionSecurityConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: string[]) {
    super("Production security configuration is invalid:\n- " + issues.join("\n- "));
    this.name = "ProductionSecurityConfigError";
    this.issues = issues;
  }
}

export function isKnownInsecurePlaceholder(value: unknown): boolean {
  return typeof value === "string" && KNOWN_INSECURE_PLACEHOLDERS.has(value.trim().toLowerCase());
}

export function validateProductionSecurityConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const issues: string[] = [];
  const adminPassword = String(env.LOCAL_ADMIN_PASSWORD || "");
  const jwtSecret = String(env.JWT_SECRET || "");
  const encryptionKey = String(env.ENCRYPTION_KEY || "");
  const routingSecret = String(env.MYBAY_INTERNAL_ROUTING_SECRET || "");

  if (!adminPassword) {
    issues.push("LOCAL_ADMIN_PASSWORD is required in production.");
  } else if (isKnownInsecurePlaceholder(adminPassword)) {
    issues.push("LOCAL_ADMIN_PASSWORD is using a known insecure placeholder. Set a secure password before starting MyBay Open Source in production.");
  } else if (adminPassword.length < 12) {
    issues.push("LOCAL_ADMIN_PASSWORD must be at least 12 characters in production.");
  }

  if (!jwtSecret) {
    issues.push("JWT_SECRET is required in production.");
  } else if (isKnownInsecurePlaceholder(jwtSecret)) {
    issues.push("JWT_SECRET is using a known insecure placeholder. Generate a random secret before starting MyBay Open Source in production.");
  } else if (jwtSecret.length < 32) {
    issues.push("JWT_SECRET must be at least 32 characters in production.");
  } else if (isObviouslyWeakSecret(jwtSecret)) {
    issues.push("JWT_SECRET is obviously weak. Generate a random secret before starting MyBay Open Source in production.");
  }

  if (!encryptionKey) {
    issues.push("ENCRYPTION_KEY is required in production.");
  } else if (isKnownInsecurePlaceholder(encryptionKey) || !HEX_64.test(encryptionKey)) {
    issues.push("ENCRYPTION_KEY must be a randomly generated 64-character hexadecimal value in production.");
  }

  if (!routingSecret) {
    issues.push("MYBAY_INTERNAL_ROUTING_SECRET is required in production.");
  } else if (isKnownInsecurePlaceholder(routingSecret) || !HEX_64.test(routingSecret)) {
    issues.push("MYBAY_INTERNAL_ROUTING_SECRET must be a randomly generated 64-character hexadecimal value in production.");
  }

  if (issues.length) throw new ProductionSecurityConfigError(issues);
}

import { isKnownInsecurePlaceholder } from "./productionSecurityConfig";

const isProd = process.env.NODE_ENV === "production";

function createDevelopmentSecret(envName: string, minLength: number): string {
  const fallback = `mybay_dev_${envName.toLowerCase()}_stable_secret_key_32bytes_long_12345`;
  console.warn(`[SECURITY] WARNING: ${envName} is missing in development. Using stable development secret.`);
  return fallback;
}

/**
 * Validates and retrieves a security secret.
 * In production, it enforces strict presence and length (fail-fast).
 * In development, it generates a temporary per-process value when missing.
 */
function initializeSecret(envName: string, minLength: number = 0): string {
  const value = process.env[envName];

  if (isProd) {
    if (!value || value.length < minLength || isKnownInsecurePlaceholder(value)) {
      console.error(`[SECURITY] CRITICAL: ${envName} is missing or too short in production.`);
      if (value && value.length < minLength) {
        console.error(`Reason: ${envName} must be at least ${minLength} characters long.`);
      }
      console.error(`Please set a strong ${envName} in your environment variables.`);
      process.exit(1);
      throw new Error(`CRITICAL SECURITY ERROR: ${envName} is invalid.`);
    }
    return value;
  }

  if (!value) {
    return createDevelopmentSecret(envName, minLength);
  }
  if (value.length < minLength) {
    console.warn(`[SECURITY] WARNING: ${envName} is shorter than ${minLength} characters. This is unsafe for production.`);
  }
  return value;
}

export const JWT_SECRET = initializeSecret("JWT_SECRET", 32);

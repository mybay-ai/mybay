export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return "";
  if (secret.length <= 4) return "*".repeat(secret.length);
  return secret.substring(0, 2) + "*".repeat(secret.length - 4) + secret.substring(secret.length - 2);
}

export function maskEnvVariables(envVars: { [key: string]: string }): { [key: string]: string } {
  const masked: { [key: string]: string } = {};
  const sensitiveKeys = ["API_KEY", "SECRET", "TOKEN", "PWD", "PASSWORD"];
  
  for (const [key, value] of Object.entries(envVars)) {
    const isSensitive = sensitiveKeys.some(k => key.toUpperCase().includes(k));
    masked[key] = isSensitive ? maskSecret(value) : value;
  }
  return masked;
}

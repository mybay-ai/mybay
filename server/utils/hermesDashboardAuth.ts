import crypto from "crypto";

export class HermesDashboardAuthError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = "HermesDashboardAuthError";
    this.code = "HERMES_DASHBOARD_AUTH_HASH_FAILED";
  }
}

const HERMES_SCRYPT_N = 16_384;
const HERMES_SCRYPT_R = 8;
const HERMES_SCRYPT_P = 1;
const HERMES_SCRYPT_SALT_BYTES = 16;
const HERMES_SCRYPT_DKLEN = 32;

export function extractHermesPasswordHash(output: string): string | null {
  if (!output) return null;
  const lines = output.split(/\r?\n/);
  const scryptRegex = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;
  const bcryptRegex = /^\$2[aby]\$/;
  const argon2Regex = /^\$argon2/;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (scryptRegex.test(line) || bcryptRegex.test(line) || argon2Regex.test(line)) {
      return line;
    }
  }
  return null;
}

export async function generateHermesDashboardPasswordHash(
  plainPassword: string,
  _options?: {
    instanceId?: string;
    image?: string;
    imageTag?: string;
  }
): Promise<string> {
  if (!plainPassword) {
    throw new HermesDashboardAuthError("Hermes Dashboard password is empty.");
  }

  const salt = crypto.randomBytes(HERMES_SCRYPT_SALT_BYTES);
  try {
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(
        plainPassword,
        salt,
        HERMES_SCRYPT_DKLEN,
        {
          N: HERMES_SCRYPT_N,
          r: HERMES_SCRYPT_R,
          p: HERMES_SCRYPT_P,
          maxmem: 64 * 1024 * 1024,
        },
        (error, key) => error ? reject(error) : resolve(key)
      );
    });
    return 'scrypt$' + HERMES_SCRYPT_N + '$' + HERMES_SCRYPT_R + '$' + HERMES_SCRYPT_P + '$' + salt.toString("base64") + '$' + derivedKey.toString("base64");
  } catch (error) {
    throw new HermesDashboardAuthError(
      error instanceof Error ? error.message : "Hermes Dashboard password hash generation failed."
    );
  }
}

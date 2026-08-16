import { isEncryptionKeyConfigured, getEncryptionKeyFingerprint } from "../crypto";

export function buildPasswordConfigSummary(config: any) {
  const rawPassword = typeof config?.password === "string" ? config.password : "";
  const parts = rawPassword ? rawPassword.split(":") : [];

  return {
    hasWebPasswordHash: !!config?.webPasswordHash,
    hasPassword: !!rawPassword,
    passwordParts: parts.length,
    passwordPrefix: rawPassword ? rawPassword.slice(0, 6) : "",
    ivLength: parts.length >= 1 ? parts[0].length / 2 : 0,
    authTagLength: parts.length >= 2 ? parts[1].length / 2 : 0,
    encryptedLength: parts.length >= 3 ? parts[2].length : 0,
    encryptionKeyConfigured: isEncryptionKeyConfigured(),
    encryptionKeyFingerprint: getEncryptionKeyFingerprint()
  };
}

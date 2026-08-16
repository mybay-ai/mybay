import { decrypt } from "../crypto";
import { isMaskedSecretPlaceholder } from "./sanitizer";

export type SavedProviderCredential = {
  key?: string | null;
  encrypted_value?: string | null;
  key_encrypted?: string | null;
  base_url?: string | null;
  type?: string | null;
};

export class SavedProviderCredentialError extends Error {
  constructor(public readonly code: "CREDENTIAL_NOT_FOUND" | "CREDENTIAL_DECRYPT_FAILED") {
    super(code);
  }
}

export function resolveStoredCredentialApiKey(storedKey: string): string {
  try {
    const plainKey = decrypt(storedKey);
    if (!plainKey || isMaskedSecretPlaceholder(plainKey)) {
      throw new SavedProviderCredentialError("CREDENTIAL_DECRYPT_FAILED");
    }
    return plainKey;
  } catch {
    throw new SavedProviderCredentialError("CREDENTIAL_DECRYPT_FAILED");
  }
}

export function applySavedProviderCredential(
  data: Record<string, any>,
  credential: SavedProviderCredential | null | undefined
): void {
  if (!credential) {
    throw new SavedProviderCredentialError("CREDENTIAL_NOT_FOUND");
  }

  const storedKey = credential.key || credential.encrypted_value || credential.key_encrypted;
  if (!storedKey) {
    throw new SavedProviderCredentialError("CREDENTIAL_DECRYPT_FAILED");
  }

  // A saved credential is authoritative. Never allow a stale client-side key
  // to override it, and never pass encrypted-at-rest text into instance config.
  data.providerApiKey = resolveStoredCredentialApiKey(storedKey);
  data.apiKey = "";

  if (!data.baseUrl && credential.base_url) data.baseUrl = credential.base_url;
  if (!data.provider && credential.type) data.provider = credential.type;
}

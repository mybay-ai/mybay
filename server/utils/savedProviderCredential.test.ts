import { describe, expect, it } from "vitest";
import { encrypt } from "../crypto";
import {
  SavedProviderCredentialError,
  applySavedProviderCredential,
  resolveStoredCredentialApiKey,
} from "./savedProviderCredential";

describe("saved provider credential resolution", () => {
  it("decrypts the at-rest value exactly once", () => {
    const plainKey = "sk-valid-provider-key";
    expect(resolveStoredCredentialApiKey(encrypt(plainKey))).toBe(plainKey);
  });

  it("always overrides stale manual keys when a credential is selected", () => {
    const data: Record<string, any> = {
      providerCredentialId: "credential-1",
      providerApiKey: "sk-stale-client-key",
      apiKey: "legacy-stale-key",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
    };

    applySavedProviderCredential(data, {
      key: encrypt("sk-current-saved-key"),
      type: "deepseek",
      base_url: "https://api.deepseek.com/v1",
    });

    expect(data.providerApiKey).toBe("sk-current-saved-key");
    expect(data.apiKey).toBe("");
  });

  it("fails closed when the selected credential is missing", () => {
    expect(() => applySavedProviderCredential({ providerCredentialId: "missing" }, null)).toThrowError(
      new SavedProviderCredentialError("CREDENTIAL_NOT_FOUND")
    );
  });

  it("fails closed when the stored value cannot be decrypted", () => {
    const malformed = "00112233445566778899aabb:00112233445566778899aabbccddeeff:00";
    expect(() => applySavedProviderCredential({}, { key: malformed })).toThrowError(
      new SavedProviderCredentialError("CREDENTIAL_DECRYPT_FAILED")
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  isPrivilegedUser,
  parseInstanceConfigJson,
  resolveProviderCredentialSelection,
} from "./instanceConfigRoutePolicy";

describe("instance config route policy characterization", () => {
  it("accepts object and JSON string configs while normalizing empty and array values", () => {
    const objectConfig = { channel: "web" };
    expect(parseInstanceConfigJson(objectConfig)).toBe(objectConfig);
    expect(parseInstanceConfigJson('{"channel":"api"}')).toEqual({ channel: "api" });
    expect(parseInstanceConfigJson("")).toEqual({});
    expect(parseInstanceConfigJson([])).toEqual({});
  });

  it("keeps the existing parse error contract", () => {
    expect(() => parseInstanceConfigJson("{"))
      .toThrow("[parseInstanceConfigJson] Failed to parse config JSON string:");
  });

  it("distinguishes retaining, selecting, and clearing a saved model credential", () => {
    expect(resolveProviderCredentialSelection({}, { providerCredentialId: "credential-1" })).toEqual({
      explicitlySelected: false,
      selectedCredentialId: "",
      switchingToManual: false,
      requiresNewManualApiKey: false,
    });
    expect(resolveProviderCredentialSelection(
      { providerCredentialId: " credential-2 " },
      { providerCredentialId: "credential-1" },
    )).toMatchObject({
      selectedCredentialId: "credential-2",
      switchingToManual: false,
      requiresNewManualApiKey: false,
    });
    expect(resolveProviderCredentialSelection(
      { providerCredentialId: null },
      { providerCredentialId: "credential-1" },
    )).toMatchObject({ switchingToManual: true, requiresNewManualApiKey: true });
    expect(resolveProviderCredentialSelection(
      { providerCredentialId: null, providerApiKey: "sk-new" },
      { providerCredentialId: "credential-1" },
    )).toMatchObject({ switchingToManual: true, requiresNewManualApiKey: false });
  });

  it("recognizes only admin roles as privileged", () => {
    expect(isPrivilegedUser({ role: "admin" })).toBe(true);
    expect(isPrivilegedUser({ role: "super_admin" })).toBe(true);
    expect(isPrivilegedUser({ role: "user" })).toBe(false);
    expect(isPrivilegedUser(undefined)).toBe(false);
  });
});


import { describe, expect, it } from "vitest";
import { localEditionCapabilities } from "./editionCapabilities";

describe("MyBay Open Source capabilities", () => {
  it("keeps the self-hosted OSS product boundary explicit", () => {
    expect(localEditionCapabilities).toEqual({
      registration: false,
      multiTenant: false,
      billing: false,
      platformModels: false,
      scheduler: true,
      selfHosted: true,
      managedBackup: false,
    });
  });
});

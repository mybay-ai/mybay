import { describe, expect, it } from "vitest";
import { createConfiguredModelEvidence, readLocalModelEvidence } from "./localModelEvidence";

describe("local model evidence", () => {
  it("stores a bounded configured-model snapshot", () => {
    expect(createConfiguredModelEvidence("deepseek-v4-flash")).toEqual({
      version: 1,
      model: "deepseek-v4-flash",
      source: "configured_snapshot",
    });
  });

  it("rejects secrets and unrecognized sources", () => {
    expect(createConfiguredModelEvidence("sk-secret-model")).toBeNull();
    expect(readLocalModelEvidence({ version: 1, model: "deepseek-v4-flash", source: "current_config" })).toBeNull();
  });
});

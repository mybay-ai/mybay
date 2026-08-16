import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureEnvDefault } from "./ensure-env-default.mjs";

const tempDirectories = [];
function createEnv(contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-env-test-"));
  tempDirectories.push(directory);
  const envPath = path.join(directory, ".env");
  fs.writeFileSync(envPath, contents, "utf8");
  return envPath;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Local Pure existing .env upgrade", () => {
  it("adds true when the variable is missing", () => {
    const envPath = createEnv("PORT=3000\n");
    expect(ensureEnvDefault(envPath, "MYBAY_ASYNC_CHAT_RUNS_ENABLED", "true")).toBe(true);
    expect(fs.readFileSync(envPath, "utf8")).toContain("MYBAY_ASYNC_CHAT_RUNS_ENABLED=true");
  });

  it("preserves an explicit false", () => {
    const envPath = createEnv("MYBAY_ASYNC_CHAT_RUNS_ENABLED=false\n");
    expect(ensureEnvDefault(envPath, "MYBAY_ASYNC_CHAT_RUNS_ENABLED", "true")).toBe(false);
    expect(fs.readFileSync(envPath, "utf8")).toBe("MYBAY_ASYNC_CHAT_RUNS_ENABLED=false\n");
  });

  it("is idempotent and never creates duplicate variables", () => {
    const envPath = createEnv("PORT=3000\n");
    ensureEnvDefault(envPath, "MYBAY_ASYNC_CHAT_RUNS_ENABLED", "true");
    ensureEnvDefault(envPath, "MYBAY_ASYNC_CHAT_RUNS_ENABLED", "true");
    const matches = fs.readFileSync(envPath, "utf8").match(/^MYBAY_ASYNC_CHAT_RUNS_ENABLED=/gm) || [];
    expect(matches).toHaveLength(1);
  });
});

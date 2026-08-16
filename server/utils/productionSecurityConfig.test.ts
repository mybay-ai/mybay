import { describe, expect, it } from "vitest";
import { ProductionSecurityConfigError, validateProductionSecurityConfig } from "./productionSecurityConfig";

const secureProductionEnv = () => ({
  NODE_ENV: "production",
  LOCAL_ADMIN_PASSWORD: "correct-horse-battery-staple",
  JWT_SECRET: "jwt_" + "a1b2c3d4".repeat(8),
  ENCRYPTION_KEY: "a1".repeat(32),
  MYBAY_INTERNAL_ROUTING_SECRET: "b2".repeat(32),
}) as NodeJS.ProcessEnv;

describe("production security configuration", () => {
  it("accepts secure production values", () => {
    expect(() => validateProductionSecurityConfig(secureProductionEnv())).not.toThrow();
  });

  it.each([
    ["LOCAL_ADMIN_PASSWORD", "change-me-now"],
    ["JWT_SECRET", "replace-with-a-random-32-byte-secret"],
    ["ENCRYPTION_KEY", "replace-with-a-64-character-hex-secret"],
    ["MYBAY_INTERNAL_ROUTING_SECRET", "replace-with-a-64-character-hex-routing-secret"],
  ])("rejects insecure production %s without disclosing its value", (name, value) => {
    const env = secureProductionEnv();
    env[name] = value;
    let error: unknown;
    try {
      validateProductionSecurityConfig(env);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProductionSecurityConfigError);
    expect(String((error as Error).message)).toContain(name);
    expect(String((error as Error).message)).not.toContain(value);
  });

  it("rejects an obviously weak JWT secret even when it is long", () => {
    const env = secureProductionEnv();
    env.JWT_SECRET = "a".repeat(64);
    expect(() => validateProductionSecurityConfig(env)).toThrow(ProductionSecurityConfigError);
  });

  it("rejects short administrator and JWT secrets", () => {
    const env = secureProductionEnv();
    env.LOCAL_ADMIN_PASSWORD = "short";
    env.JWT_SECRET = "short";
    expect(() => validateProductionSecurityConfig(env)).toThrow(ProductionSecurityConfigError);
  });

  it.each(["development", "test", undefined])("does not block non-production mode %s", (nodeEnv) => {
    expect(() => validateProductionSecurityConfig({ NODE_ENV: nodeEnv } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

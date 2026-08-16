import { describe, expect, it } from "vitest";
import {
  assertRuntimeSatisfiesSkillPolicy,
  createRuntimeSecurityManifest,
  SkillPolicyError,
} from "./skillPolicyEnforcer";
import { skillPolicyRegistry } from "../../shared/skillPolicyRegistry";

describe("SkillPolicyEnforcer", () => {
  const regularRuntime = createRuntimeSecurityManifest({
    runtimeType: "mybay-agent-runtime",
    user: "root",
    capDrop: [],
    securityOpt: ["no-new-privileges:true"],
    binds: ["/host/instance:/opt/data:rw"],
    resourceLimited: true,
  });

  it("allows skills whose declared runtime requirements are actually met", () => {
    expect(() => assertRuntimeSatisfiesSkillPolicy({
      skills: ["file_read"],
      userRole: "admin",
      isProduction: true,
      runtime: regularRuntime,
    })).not.toThrow();
  });

  it("rejects sandbox skills on the ordinary root agent runtime", () => {
    const original = skillPolicyRegistry.shell.runtimeStatus;
    skillPolicyRegistry.shell.runtimeStatus = "available";
    expect(() => assertRuntimeSatisfiesSkillPolicy({
      skills: ["shell"],
      userRole: "admin",
      isProduction: true,
      runtime: regularRuntime,
    })).toThrowError(expect.objectContaining<Partial<SkillPolicyError>>({
      code: "SKILL_RUNTIME_POLICY_UNSATISFIED",
    }));
    skillPolicyRegistry.shell.runtimeStatus = original;
  });

  it("rejects production-disabled Docker access even for an administrator", () => {
    expect(() => assertRuntimeSatisfiesSkillPolicy({
      skills: ["docker"],
      userRole: "admin",
      isProduction: true,
      runtime: regularRuntime,
    })).toThrowError(expect.objectContaining<Partial<SkillPolicyError>>({
      code: "SKILL_NOT_ALLOWED_IN_PRODUCTION",
    }));
  });

  it("does not claim sandbox protection without every required control", () => {
    const incompleteSandbox = createRuntimeSecurityManifest({
      runtimeType: "sandbox-skill-runtime",
      user: "sandbox",
      capDrop: ["ALL"],
      capAdd: ["CHOWN", "SETUID", "SETGID"],
      securityOpt: ["no-new-privileges"],
      readonlyRootfs: true,
      binds: ["/host/instance:/opt/data:rw"],
      resourceLimited: true,
    });
    expect(incompleteSandbox.sandboxed).toBe(false);
  });

  it("rejects an enabled policy when a required guard is missing", () => {
    expect(() => assertRuntimeSatisfiesSkillPolicy({
      skills: ["docker"],
      userRole: "admin",
      isProduction: false,
      runtime: regularRuntime,
    })).toThrowError(expect.objectContaining<Partial<SkillPolicyError>>({
      code: "SKILL_RUNTIME_POLICY_UNSATISFIED",
    }));
  });

  it("rejects coming-soon skills so the API cannot bypass the disabled UI", () => {
    expect(() => assertRuntimeSatisfiesSkillPolicy({
      skills: ["browser"],
      userRole: "admin",
      isProduction: false,
      runtime: regularRuntime,
    })).toThrowError(expect.objectContaining<Partial<SkillPolicyError>>({
      code: "SKILL_NOT_AVAILABLE",
    }));
  });
});

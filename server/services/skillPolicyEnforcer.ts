import { skillPolicyRegistry, type SkillPolicy } from "../../shared/skillPolicyRegistry";

export type RuntimeType = "console-runtime" | "mybay-agent-runtime" | "sandbox-skill-runtime";

export interface RuntimeSecurityManifest {
  runtimeType: RuntimeType;
  sandboxed: boolean;
  guards: ReadonlySet<string>;
}

export class SkillPolicyError extends Error {
  constructor(
    public readonly code:
      | "UNKNOWN_SKILL"
      | "SKILL_NOT_AVAILABLE"
      | "SKILL_ADMIN_ONLY"
      | "SKILL_NOT_ALLOWED_IN_PRODUCTION"
      | "SKILL_RUNTIME_POLICY_UNSATISFIED",
    message: string,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SkillPolicyError";
  }
}

function resolvePolicy(skillId: string): SkillPolicy | undefined {
  return skillPolicyRegistry[skillId === "docker_engine" ? "docker" : skillId];
}

export function createRuntimeSecurityManifest(input: {
  runtimeType?: RuntimeType;
  user?: string;
  capDrop?: string[];
  capAdd?: string[];
  securityOpt?: string[];
  readonlyRootfs?: boolean;
  binds?: string[];
  resourceLimited?: boolean;
}): RuntimeSecurityManifest {
  const runtimeType = input.runtimeType || "mybay-agent-runtime";
  const guards = new Set<string>();
  const binds = input.binds || [];
  const capDrop = (input.capDrop || []).map((value) => value.toUpperCase());
  const capAdd = (input.capAdd || []).map((value) => value.toUpperCase());
  const securityOpt = (input.securityOpt || []).map((value) => value.toLowerCase());
  const user = String(input.user || "root").toLowerCase();

  if (user !== "root" && user !== "0") guards.add("non-root-user");
  if (!binds.some((bind) => bind.includes("/var/run/docker.sock"))) guards.add("no-docker-socket");
  if (binds.every((bind) => bind.includes(":/opt/data:"))) guards.add("mount-workspace-only");
  if (securityOpt.some((value) => value.startsWith("no-new-privileges"))) guards.add("no-new-privileges");
  if (capDrop.includes("ALL") && capAdd.length === 0) guards.add("drop-all-capabilities");
  if (input.resourceLimited) guards.add("resource-limits");

  const sandboxed = runtimeType === "sandbox-skill-runtime"
    && guards.has("non-root-user")
    && guards.has("no-docker-socket")
    && guards.has("mount-workspace-only")
    && guards.has("no-new-privileges")
    && guards.has("drop-all-capabilities")
    && input.readonlyRootfs === true;

  return { runtimeType, sandboxed, guards };
}

export function assertRuntimeSatisfiesSkillPolicy(input: {
  skills: string[];
  userRole?: string;
  isProduction?: boolean;
  runtime: RuntimeSecurityManifest;
}): void {
  const isAdmin = input.userRole === "admin" || input.userRole === "super_admin";

  for (const requestedSkillId of input.skills) {
    const policy = resolvePolicy(requestedSkillId);
    if (!policy) {
      throw new SkillPolicyError("UNKNOWN_SKILL", `Unknown skill: ${requestedSkillId}`, { skillId: requestedSkillId });
    }
    if (policy.runtimeStatus === "coming_soon") {
      throw new SkillPolicyError("SKILL_NOT_AVAILABLE", `Skill ${policy.name} is not available.`, { skillId: policy.id });
    }
    if (policy.adminOnly && !isAdmin) {
      throw new SkillPolicyError("SKILL_ADMIN_ONLY", `Skill ${policy.name} is restricted to administrators.`, { skillId: policy.id });
    }
    if (input.isProduction && !policy.allowedInProduction) {
      throw new SkillPolicyError(
        "SKILL_NOT_ALLOWED_IN_PRODUCTION",
        `Skill ${policy.name} is not allowed in production mode.`,
        { skillId: policy.id },
      );
    }

    const missingGuards = policy.requiredRuntimeGuards.filter((guard) => !input.runtime.guards.has(guard));
    if (policy.requiresSandbox && !input.runtime.sandboxed && !missingGuards.includes("sandbox-runtime")) {
      missingGuards.unshift("sandbox-runtime");
    }
    if (missingGuards.length > 0) {
      throw new SkillPolicyError(
        "SKILL_RUNTIME_POLICY_UNSATISFIED",
        `Runtime cannot safely enable ${policy.name}.`,
        { skillId: policy.id, runtimeType: input.runtime.runtimeType, missingGuards },
      );
    }
  }
}

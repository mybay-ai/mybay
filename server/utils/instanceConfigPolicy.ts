import { assertCanUseChannel } from "../services/entitlements";
import { skillPolicyRegistry } from "../../shared/skillPolicyRegistry";
import { assertRuntimeSatisfiesSkillPolicy, createRuntimeSecurityManifest, SkillPolicyError } from "../services/skillPolicyEnforcer";

export async function validateInstanceConfigPolicy(input: {
  user: any;
  channel: string | string[];
  skills?: string[];
  confirmed_skill_ids?: string[];
  confirm_dangerous_skills?: boolean;
  envAllowsDockerSocket?: boolean;
  settingsAllowsDockerSocket?: boolean;
}): Promise<{ error?: string; message?: string; status: number; metadata?: any; auditLogDetails?: string }> {
  const { user, channel, skills, confirmed_skill_ids, confirm_dangerous_skills, envAllowsDockerSocket, settingsAllowsDockerSocket } = input;

  try {
    await assertCanUseChannel(user, channel);
  } catch (entitlementErr: any) {
    return {
      status: 403,
      error: entitlementErr.code || "PLAN_EXTERNAL_CHANNEL_REQUIRED",
      message: entitlementErr.message
    };
  }

  if (skills && Array.isArray(skills)) {
    for (const skillId of skills) {
      const policy = skillPolicyRegistry[skillId];
      if (!policy) {
        return { status: 400, error: `未知的技能插件: ${skillId}` };
      }
      if (policy.runtimeStatus === 'coming_soon') {
        return { status: 400, error: `技能插件 [${policy.name}] 尚未开发完成或尚未上线。` };
      }
      
      if (policy.adminOnly && user.role !== 'admin' && user.role !== 'super_admin') {
        return {
          status: 403,
          error: `无权启用管理员专用技能: ${policy.name}`,
          auditLogDetails: `用户尝试越权开启管理员技能: ${skillId} (Update)`
        };
      }

      const hasDockerSkill = skillId === "docker" || skillId === "docker_engine";
      if (hasDockerSkill) {
        if (user.role !== 'admin' && user.role !== 'super_admin') {
          return {
            status: 403,
            error: "权限不足，无法启用 Docker 物理机引擎技能",
            auditLogDetails: `非管理员用户尝试越权开启 Docker 技能 (Update)`
          };
        }

        if (envAllowsDockerSocket === false) {
          return { status: 403, error: "服务器安全策略未启用 Docker Socket 挂载，请先配置 ENABLE_DOCKER_SOCKET_SKILL=true" };
        }

        if (settingsAllowsDockerSocket === false) {
          return { status: 403, error: "后台安全设置未允许管理员实例挂载 Docker Socket" };
        }
      }
    }

    const dangerousSkillsInRequest = skills.filter((s: string) => {
      const policy = skillPolicyRegistry[s];
      return policy && policy.requiresConfirmation === true;
    });

    if (dangerousSkillsInRequest.length > 0) {
      const confirmedSkillIds = Array.isArray(confirmed_skill_ids) ? confirmed_skill_ids : [];
      const unconfirmedSkills = dangerousSkillsInRequest.filter((s: string) => {
        if (confirm_dangerous_skills === true) return false;
        return !confirmedSkillIds.includes(s);
      });

      if (unconfirmedSkills.length > 0) {
        return {
          status: 400,
          error: "SKILL_CONFIRMATION_REQUIRED",
          message: "该热更新请求包含需要手动确认授权的敏感技能，请确认后再保存。",
          metadata: { skills: unconfirmedSkills }
        };
      }
    }

    const dockerSocketMounted = Boolean(
      (skills.includes("docker") || skills.includes("docker_engine"))
      && envAllowsDockerSocket
      && settingsAllowsDockerSocket
    );
    const runtime = createRuntimeSecurityManifest({
      runtimeType: "mybay-agent-runtime",
      user: "root",
      capDrop: [],
      securityOpt: user.role === "admin" || user.role === "super_admin" ? [] : ["no-new-privileges:true"],
      binds: dockerSocketMounted
        ? ["instance:/opt/data:rw", "/var/run/docker.sock:/var/run/docker.sock"]
        : ["instance:/opt/data:rw"],
      resourceLimited: true,
    });
    try {
      assertRuntimeSatisfiesSkillPolicy({ skills, userRole: user.role, isProduction: process.env.NODE_ENV === "production", runtime });
    } catch (error) {
      if (!(error instanceof SkillPolicyError)) throw error;
      return { status: 403, error: error.code, message: error.message, metadata: error.detail };
    }
  }

  return { status: 200 };
}

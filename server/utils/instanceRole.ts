import { dbAdapter } from "../db";

export async function resolveInstanceRole(instance: any): Promise<string | undefined> {
  if (instance.user_role) return instance.user_role;
  if (instance.owner_role) return instance.owner_role;

  try {
    const userId = instance.user_id || instance.owner_id;
    if (userId) {
      const user = await dbAdapter.getUserById(userId);
      if (user && user.role) {
        return user.role;
      }
    }
  } catch (e: any) {
    console.warn(`[RoleResolver] Failed to resolve role from database for instance ${instance.id || 'unknown'}: ${e.message}`);
  }

  return undefined;
}

export async function isPrivilegedInstance(instance: any): Promise<boolean> {
  const role = await resolveInstanceRole(instance);
  return role === "admin" || role === "super_admin";
}

export function parseInstanceConfigJson(raw: any): any {
  if (raw === null || raw === undefined || raw === "") {
    return {};
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (error: any) {
      throw new Error(`[parseInstanceConfigJson] Failed to parse config JSON string: ${error.message}`);
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}

export function isPrivilegedUser(user: any): boolean {
  return user?.role === "admin" || user?.role === "super_admin";
}


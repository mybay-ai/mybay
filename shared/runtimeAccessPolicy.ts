export function supportsRuntimeDashboard(runtimeType: unknown): boolean {
  return String(runtimeType || "hermes").trim().toLowerCase() === "hermes";
}

export function normalizeRuntimeAccessDraft<T extends Record<string, any>>(draft: T): T {
  if (supportsRuntimeDashboard(draft.runtime_type)) return draft;
  if (draft.enableDashboard === false && !draft.username && !draft.password) return draft;
  return {
    ...draft,
    enableDashboard: false,
    username: "",
    password: "",
  };
}

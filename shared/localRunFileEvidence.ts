/** Bounded, content-free file evidence shared by runtime persistence and message UI. */
export type LocalFileChange = { path: string; kind: "added" | "modified" | "deleted" | "referenced" | "unknown" };
export type LocalFileEvidence = { version: 1; runId: string; changes: LocalFileChange[] };

export function safeLocalEvidencePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 240) return null;
  let path = value.trim();
  if (!path || /[\\\u0000-\u001f\u007f:%?#*<>|"`$]/.test(path) || path.includes("...") || path.includes("…")) return null;
  if (path.startsWith("/opt/data/")) path = path.slice(10);
  if (path.startsWith("./")) path = path.slice(2);
  if (path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === "..")) return null;
  if (/(^|\/)(\.env[^/]*|\.git|\.ssh|\.hermes)(\/|$)/i.test(path)
    || /(?:secret|token|credential|password|api[_-]?key)/i.test(path)
    || /(?:\.(?:key|pem|crt|sqlite|sqlite3|db)(?:-|$)|(?:^|\/)(?:config\.ya?ml|mybay\.[^/]*\.ya?ml|system\.md|soul\.md)$)/i.test(path)) return null;
  return path;
}

export function classifyLocalFileOperation(value: unknown): LocalFileChange["kind"] | null {
  if (typeof value !== "string") return null;
  const operation = value.toLowerCase();
  if (/^(delete|deleted|remove|removed|unlink|delete_file|remove_file|file\.deleted)$/.test(operation)) return "deleted";
  if (/^(create|created|add|added|write_new|create_file|file\.created)$/.test(operation)) return "added";
  if (/^(edit|edited|modify|modified|update|updated|patch|replace|edit_file|patch_file|file\.modified)$/.test(operation)) return "modified";
  if (/^(write|write_file|file_write|unknown)$/.test(operation)) return "unknown";
  if (/^(read|read_file|file_read|view|view_file|referenced)$/.test(operation)) return "referenced";
  return null;
}

export function mergeLocalFileChanges(changes: LocalFileChange[]): LocalFileChange[] {
  const result = new Map<string, LocalFileChange>();
  for (const change of changes) {
    const path = safeLocalEvidencePath(change.path);
    const kind = classifyLocalFileOperation(change.kind);
    if (!path || !kind) continue;
    const previous = result.get(path)?.kind;
    if (previous && kind === "referenced") continue;
    if (previous === "added" && (kind === "modified" || kind === "unknown")) continue;
    if (result.size >= 20 && !result.has(path)) continue;
    result.set(path, { path, kind });
  }
  return [...result.values()];
}

export function readLocalFileEvidence(value: unknown, runId: string | null | undefined): LocalFileChange[] {
  if (!runId || !value || typeof value !== "object") return [];
  const evidence = value as Partial<LocalFileEvidence>;
  if (evidence.version !== 1 || evidence.runId !== runId || !Array.isArray(evidence.changes)) return [];
  return mergeLocalFileChanges(evidence.changes.slice(0, 100).filter((change): change is LocalFileChange => !!change && typeof change === "object"));
}

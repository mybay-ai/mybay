import { api } from "./api";

export interface InstanceFileItem {
  name: string;
  path: string;
  type: "directory" | "file";
  isSymlink?: boolean;
  mime: string | null;
  size: number | null;
  updatedAt: string;
}

export type InstanceFileFilter = "all" | "document" | "image" | "code" | "other";
export type InstanceFileSort = "name" | "size" | "updated";

function fileCategory(item: InstanceFileItem): Exclude<InstanceFileFilter, "all"> {
  const extension = item.name.split(".").pop()?.toLowerCase() || "";
  if (item.mime?.startsWith("image/") || /^(png|jpg|jpeg|gif|webp|svg|avif|bmp|ico)$/.test(extension)) return "image";
  if (/^(js|jsx|ts|tsx|json|yaml|yml|toml|py|sh|css|html|xml|sql|go|rs|java|c|cpp|h)$/.test(extension)) return "code";
  if (/^(pdf|txt|md|doc|docx|xls|xlsx|csv|ppt|pptx|rtf|odt)$/.test(extension) || item.mime?.startsWith("text/")) return "document";
  return "other";
}

export function filterInstanceFiles(items: InstanceFileItem[], query: string, filter: InstanceFileFilter, sort: InstanceFileSort): InstanceFileItem[] {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => item.name.toLocaleLowerCase().includes(search)
    && (item.type === "directory" || filter === "all" || fileCategory(item) === filter))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      // Keep folders navigable and alphabetic; size/time sorting applies to files.
      if (a.type === "file") {
        const delta = sort === "size" ? (b.size ?? -1) - (a.size ?? -1)
          : sort === "updated" ? (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) : 0;
        if (delta) return delta;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.path.localeCompare(b.path);
    });
}

// Abort is best-effort. The identity check also rejects responses from transports
// that finish after abort, and confirmations from a previous directory/instance.
export function createInstanceFileRequestScope() {
  const lanes = new Map<string, AbortController>();
  let active = true;
  let context = 0;
  return {
    begin(lane: string) {
      lanes.get(lane)?.abort();
      const controller = new AbortController();
      lanes.set(lane, controller);
      if (!active) controller.abort();
      return { signal: controller.signal, isCurrent: () => active && !controller.signal.aborted && lanes.get(lane) === controller };
    },
    cancel(lane: string) { lanes.get(lane)?.abort(); lanes.delete(lane); },
    advanceContext() { context++; },
    captureContext() { const captured = context; return () => active && captured === context; },
    dispose() { active = false; for (const controller of lanes.values()) controller.abort(); lanes.clear(); },
  };
}

export async function downloadInstanceFile(instanceId: string, path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await api.getRaw(`/api/instances/${encodeURIComponent(instanceId)}/files/download?path=${encodeURIComponent(path)}`, { signal });
  return response.blob();
}

export async function prepareInstanceFileDownload(instanceId: string, path: string, signal: AbortSignal): Promise<string> {
  const prefix = `/api/instances/${encodeURIComponent(instanceId)}/files`;
  const query = `?path=${encodeURIComponent(path)}`;
  // Check authorization/export restrictions before handing the attachment to
  // the browser. The download endpoint independently rechecks them at delivery.
  await api.get(`${prefix}/metadata${query}`, { signal });
  signal.throwIfAborted();
  return `${prefix}/download${query}`;
}

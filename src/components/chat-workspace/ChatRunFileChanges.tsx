import { ChevronDown, ChevronRight, FilePlus2, FilePenLine, FileX2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GeneratedArtifact } from "./generatedArtifacts";
import { collectLocalRunFileChanges } from "./localRunFileChanges";
import type { RunExecutionState } from "./run/runTypes";

export function ChatRunFileChanges({ execution, artifacts, onOpen }: { execution?: RunExecutionState | null; artifacts: GeneratedArtifact[]; onOpen?: (path: string) => void }) {
  const { t } = useTranslation("dashboard");
  const [expanded, setExpanded] = useState(false);
  const changes = useMemo(() => collectLocalRunFileChanges(execution, artifacts), [artifacts, execution]);
  if (changes.length === 0) return null;
  const counts = changes.reduce((result, change) => ({ ...result, [change.kind]: result[change.kind] + 1 }), { added: 0, modified: 0, deleted: 0 });
  return (
    <div className="mt-2 rounded-xl border border-outline bg-surface-muted/55" data-chat-file-changes="true">
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-content-secondary">
        <FilePenLine className="h-3.5 w-3.5 text-indigo-500" />
        <span className="min-w-0 flex-1 truncate">{t("chatWorkspace.localFileChangesSummary", counts)}</span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {expanded && <div className="space-y-1 border-t border-outline p-2">
        {changes.map(change => {
          const Icon = change.kind === "added" ? FilePlus2 : change.kind === "deleted" ? FileX2 : FilePenLine;
          return <button key={`${change.kind}:${change.path}`} type="button" disabled={!onOpen || change.kind === "deleted"} onClick={() => onOpen?.(change.path)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-content-muted hover:bg-surface disabled:opacity-55"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate" title={change.path}>{change.path}</span><span>{t(`chatWorkspace.localFileChange_${change.kind}`)}</span></button>;
        })}
      </div>}
    </div>
  );
}

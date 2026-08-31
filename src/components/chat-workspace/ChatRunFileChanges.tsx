import { ChevronDown, ChevronRight, FilePlus2, FilePenLine, FileX2, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getGeneratedArtifactActionPath, type GeneratedArtifact } from "./generatedArtifacts";
import { collectLocalRunFileChanges } from "./localRunFileChanges";
import type { RunExecutionState } from "./run/runTypes";
import { ChatFileDiff } from "./ChatFileDiff";

export function ChatRunFileChanges({ execution, artifacts, onOpen, runId, evidence, instanceId, conversationId }: { execution?: RunExecutionState | null; runId?: string | null; evidence?: unknown; artifacts: GeneratedArtifact[]; onOpen?: (path: string) => void; instanceId?: string; conversationId?: string | null }) {
  const { t } = useTranslation("dashboard");
  const [expanded, setExpanded] = useState(false);
  const changes = useMemo(() => collectLocalRunFileChanges(execution, artifacts, { runId, evidence }), [artifacts, execution, runId, evidence]);
  if (changes.length === 0) return null;
  const counts = changes.reduce((result, change) => ({ ...result, [change.kind]: result[change.kind] + 1 }), { added: 0, modified: 0, deleted: 0, referenced: 0, unknown: 0 });
  const hasChanges = counts.added + counts.modified + counts.deleted > 0;
  return (
    <div className="mt-2 rounded-xl border border-outline bg-surface-muted/55" data-chat-file-changes="true">
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-content-secondary">
        <FilePenLine className="h-3.5 w-3.5 text-indigo-500" />
        <span className="min-w-0 flex-1 truncate">{hasChanges ? t("chatWorkspace.localFileChangesSummary", counts) : t("chatWorkspace.localRelatedFilesSummary", { count: changes.length })}</span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {expanded && <div className="space-y-1 border-t border-outline p-2">
        {changes.map(change => {
          const Icon = change.kind === "added" ? FilePlus2 : change.kind === "deleted" ? FileX2 : change.kind === "modified" ? FilePenLine : FileText;
          return <div key={`${instanceId}:${conversationId}:${runId}:${change.path}`}>
            <button type="button" disabled={!onOpen || change.kind === "deleted"} onClick={() => onOpen?.(getGeneratedArtifactActionPath(change))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-content-muted hover:bg-surface disabled:opacity-55"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate" title={change.path}>{change.path}</span><span>{t(`chatWorkspace.localFileChange_${change.kind}`)}</span></button>
            {instanceId && conversationId && runId && (!execution || ["completed", "failed", "cancelled", "stopped", "expired"].includes(execution.status)) && <ChatFileDiff instanceId={instanceId} conversationId={conversationId} runId={runId} filePath={change.path} />}
          </div>;
        })}
      </div>}
    </div>
  );
}

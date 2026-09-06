import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useFeedback } from "./FeedbackProvider";
import { Button } from "./ui";

type ApprovalPolicy = {
  alwaysApprovedTools?: string[];
};

const TOOL_LABELS: Record<string, string> = {
  bash: "Bash",
  powershell: "PowerShell",
  write: "Write",
  edit: "Edit",
};

export function PiApprovalPolicySection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation("dashboard");
  const { showConfirm, showToast } = useFeedback();
  const [tools, setTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    try {
      const policy = await api.get<ApprovalPolicy>(`/api/instances/${instanceId}/approval-policy`);
      setTools(Array.isArray(policy.alwaysApprovedTools) ? policy.alwaysApprovedTools : []);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = async (tool: string) => {
    const confirmed = await showConfirm({
      title: t("settings_pi_approval_revoke_title"),
      message: t("settings_pi_approval_revoke_message", { tool: TOOL_LABELS[tool] || tool }),
      type: "warning",
      confirmText: t("settings_pi_approval_revoke"),
      cancelText: t("action_cancel"),
    });
    if (!confirmed) return;
    setRevoking(tool);
    try {
      const result = await api.delete(`/api/instances/${instanceId}/approval-policy`, { tool });
      const nextTools = result?.policy?.alwaysApprovedTools;
      setTools(Array.isArray(nextTools) ? nextTools : tools.filter((item) => item !== tool));
      showToast(t("settings_pi_approval_revoke_success"), "success");
    } catch (error: any) {
      showToast(error?.message || t("settings_pi_approval_revoke_failed"), "error");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className="rounded-xl border border-purple-200 bg-surface p-5 shadow-2xs dark:border-purple-800/70">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-purple-600 dark:text-purple-300" />
          <div>
            <h4 className="text-sm font-semibold text-content">{t("settings_pi_approval_title")}</h4>
            <p className="mt-1 text-xs leading-5 text-content-muted">{t("settings_pi_approval_desc")}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading || revoking !== null} onClick={() => void refresh()} className="w-full shrink-0 sm:w-auto">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {t("settings_pi_approval_refresh")}
        </Button>
      </div>

      <div className="mt-4">
        {loading ? (
          <p className="text-xs text-content-muted">{t("settings_pi_approval_loading")}</p>
        ) : unavailable ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            {t("settings_pi_approval_unavailable")}
          </p>
        ) : tools.length === 0 ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            {t("settings_pi_approval_empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => (
              <div key={tool} className="flex flex-col gap-2 rounded-lg border border-outline bg-surface-muted px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-content">{TOOL_LABELS[tool] || tool}</p>
                  <p className="text-[11px] text-content-muted">{t("settings_pi_approval_always_allowed")}</p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={revoking !== null} onClick={() => void revoke(tool)} className="w-full text-rose-600 hover:text-rose-700 dark:text-rose-300 sm:w-auto">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {revoking === tool ? t("settings_pi_approval_revoking") : t("settings_pi_approval_revoke")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

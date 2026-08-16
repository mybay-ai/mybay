import React, { useState } from "react";
import { X, Edit3, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label } from "../ui";
import type { AgentInstance } from "../../types";
import { api } from "../../lib/api";

interface InstanceRenameModalProps {
  instance: AgentInstance;
  onClose: () => void;
  onSave: () => void;
}

export function InstanceRenameModal({ instance, onClose, onSave }: InstanceRenameModalProps) {
  const { t } = useTranslation("dashboard");
  const [name, setName] = useState(instance.name || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("rename_name_required"));
      return;
    }
    if (trimmed.length > 50) {
      setError(t("rename_name_too_long"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.patch(`/api/instances/${instance.id}/rename`, { name: trimmed });
      onSave();
    } catch (err: any) {
      console.error("Failed to rename instance:", err);
      // Safely extract error message
      const errMsg = err?.response?.data?.error || err?.message || t("rename_failed");
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-surface rounded-xl border border-outline shadow-lg w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-surface-muted border border-outline/60 flex items-center justify-center text-content-muted">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-content text-sm">{t("rename_modal_title")}</h3>
              <p className="text-[13px] text-content-muted font-normal">{t("rename_modal_subtitle")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-muted rounded-lg text-content-muted hover:text-content-secondary border border-transparent hover:border-outline/40 transition-colors active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="instance-name" className="text-[13px] font-medium text-content-muted">
              {t("rename_name_label")}
            </Label>
            <Input
              id="instance-name"
              type="text"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder={t("rename_name_placeholder")}
              className="w-full text-content text-sm h-9 rounded-lg border-outline shadow-xs focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
              maxLength={50}
              autoFocus
            />
            <p className="text-[11px] text-content-muted font-normal leading-relaxed">
              {t("rename_name_help")}
            </p>
          </div>

          {error && (
            <div className="p-2.5 bg-red-50/50 border border-red-100 rounded-lg text-[13px] text-red-600 font-normal leading-relaxed flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-outline/60">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={loading}
              className="text-[13px] text-content-muted font-medium h-8.5 rounded-lg border-outline hover:bg-surface-muted"
            >
              {t("action_cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={loading}
              className="text-[13px] font-medium bg-slate-900 hover:bg-slate-800 text-white h-8.5 rounded-lg px-4 transition-colors"
            >
              {loading ? t("saving") : t("save_name")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

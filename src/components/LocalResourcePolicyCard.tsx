import React, { useEffect, useState } from "react";
import { Cpu, HardDrive, Loader2, Save } from "lucide-react";
import { Button, Card } from "./ui";
import { api } from "../lib/api";
import { useFeedback } from "./FeedbackProvider";

type PolicyForm = {
  maxInstanceCount: string;
  unlimitedInstances: boolean;
  defaultCpu: string;
  maxCpu: string;
  defaultMemoryMb: string;
  maxMemoryMb: string;
  defaultDiskMb: string;
};

export function LocalResourcePolicyCard() {
  const { showToast, showAlert } = useFeedback();
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/system/local-resource-policy")
      .then((data) => setForm({
        maxInstanceCount: data.maxInstanceCount === null ? "" : String(data.maxInstanceCount),
        unlimitedInstances: data.maxInstanceCount === null,
        defaultCpu: String(data.defaultCpu),
        maxCpu: String(data.maxCpu),
        defaultMemoryMb: String(data.defaultMemoryMb),
        maxMemoryMb: String(data.maxMemoryMb),
        defaultDiskMb: String(data.defaultDiskMb)
      }))
      .catch((error: any) => showAlert({ title: "Resource policy load failed", message: error.message || "Unable to load local resource policy", type: "error" }))
      .finally(() => setLoading(false));
  }, []);

  const update = (key: keyof PolicyForm, value: string | boolean) => {
    setForm((previous) => previous ? { ...previous, [key]: value } : previous);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const data = await api.patch("/api/system/local-resource-policy", {
        maxInstanceCount: form.unlimitedInstances ? null : Number(form.maxInstanceCount),
        defaultCpu: Number(form.defaultCpu),
        maxCpu: Number(form.maxCpu),
        defaultMemoryMb: Number(form.defaultMemoryMb),
        maxMemoryMb: Number(form.maxMemoryMb),
        defaultDiskMb: Number(form.defaultDiskMb)
      });
      setForm({
        maxInstanceCount: data.maxInstanceCount === null ? "" : String(data.maxInstanceCount),
        unlimitedInstances: data.maxInstanceCount === null,
        defaultCpu: String(data.defaultCpu),
        maxCpu: String(data.maxCpu),
        defaultMemoryMb: String(data.defaultMemoryMb),
        maxMemoryMb: String(data.maxMemoryMb),
        defaultDiskMb: String(data.defaultDiskMb)
      });
      showToast("Local resource policy saved. Redeploy instances to apply it.", "success");
    } catch (error: any) {
      showAlert({ title: "Save failed", message: error.message || "Unable to save local resource policy", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Card className="p-6 flex items-center gap-3 text-sm text-content-muted"><Loader2 className="w-4 h-4 animate-spin" />Loading local resource policy...</Card>;
  }
  if (!form) return null;

  const inputClass = "w-full rounded-xl border border-outline px-3 py-2 text-sm outline-none focus:border-blue-400";
  return (
    <Card className="p-6 bg-surface border border-outline shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-sm font-bold text-content flex items-center gap-2"><Cpu className="w-4 h-4 text-blue-600" />Local instance resource policy</h3>
          <p className="text-xs text-content-muted mt-1">Controls default CPU, memory, disk, and instance limits for new deployments.</p>
        </div>
        <Button onClick={save} disabled={saving} size="sm" className="rounded-xl bg-blue-600 text-white hover:bg-blue-700">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-xs font-semibold text-content-secondary">Default CPU cores
          <input className={inputClass} type="number" min="0.1" step="0.1" value={form.defaultCpu} onChange={(e) => update("defaultCpu", e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-content-secondary">Max CPU cores
          <input className={inputClass} type="number" min="0.1" step="0.1" value={form.maxCpu} onChange={(e) => update("maxCpu", e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-content-secondary">Default memory (MB)
          <input className={inputClass} type="number" min="128" step="128" value={form.defaultMemoryMb} onChange={(e) => update("defaultMemoryMb", e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-content-secondary">Max memory (MB)
          <input className={inputClass} type="number" min="128" step="128" value={form.maxMemoryMb} onChange={(e) => update("maxMemoryMb", e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-content-secondary flex items-center gap-2"><HardDrive className="w-4 h-4 text-content-muted" />Default disk (MB)
          <input className={inputClass} type="number" min="512" step="512" value={form.defaultDiskMb} onChange={(e) => update("defaultDiskMb", e.target.value)} />
        </label>
        <div className="text-xs font-semibold text-content-secondary">
          Max active instances
          <div className="flex gap-2 mt-1">
            <input className={inputClass} disabled={form.unlimitedInstances} type="number" min="1" value={form.maxInstanceCount} onChange={(e) => update("maxInstanceCount", e.target.value)} />
            <label className="flex items-center gap-1 whitespace-nowrap text-xs font-normal"><input type="checkbox" checked={form.unlimitedInstances} onChange={(e) => update("unlimitedInstances", e.target.checked)} />Unlimited</label>
          </div>
        </div>
      </div>
    </Card>
  );
}

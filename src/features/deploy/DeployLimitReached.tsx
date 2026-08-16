import React from "react";
import { ShieldAlert, Server, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui";

interface ExistingInstance {
  id: string;
  name: string;
  status: string;
  url: string | null;
}

interface Props {
  limit: number;
  used: number;
  existingInstances: ExistingInstance[];
  plan: string;
  onManage: () => void;
  onRefresh: () => void;
}

export function DeployLimitReached({ limit, used, existingInstances, onManage, onRefresh }: Props) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-surface rounded-2xl border border-outline shadow-xl shadow-slate-200/50 overflow-hidden">
        <div className="bg-red-50/50 p-8 border-b border-red-50 text-center">
          <div className="inline-flex p-4 bg-surface rounded-2xl text-red-600 mb-6 shadow-sm ring-1 ring-red-100">
            <ShieldAlert className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-extrabold text-content tracking-tight mb-3">
            Local instance limit reached
          </h1>
          <p className="text-content-muted max-w-lg mx-auto leading-relaxed">
            This local deployment allows <span className="font-bold text-content-secondary">{limit}</span> active Agent instance(s). Manage an existing instance, stop one, or delete one before creating another.
          </p>
        </div>

        <div className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div className="space-y-6">
              <h3 className="text-sm font-bold text-content-muted uppercase tracking-widest">Local capacity</h3>
              <div className="bg-surface-muted rounded-2xl p-6 border border-outline space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-content-muted text-sm">Used instances</span>
                  <span className="font-mono font-bold text-content-secondary">{used} / {limit}</span>
                </div>
                <div className="w-full bg-outline rounded-full h-2 overflow-hidden">
                  <div className="bg-red-500 h-full rounded-full transition-all duration-1000" style={{ width: pct + "%" }} />
                </div>
              </div>

              <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-100 text-amber-800 text-[13px] leading-relaxed">
                Adjust the local instance limit in your deployment settings if this machine has enough CPU, memory, and disk capacity.
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-sm font-bold text-content-muted uppercase tracking-widest flex items-center gap-2">
                <Server className="w-4 h-4" /> Active instances
              </h3>
              <div className="space-y-3">
                {existingInstances.map((inst) => (
                  <div key={inst.id} className="group bg-surface p-4 rounded-2xl border border-outline hover:border-blue-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between" onClick={() => inst.id && (window.location.href = "/app/instances?id=" + inst.id)}>
                    <div className="flex flex-col">
                      <span className="font-bold text-content text-sm group-hover:text-blue-600 transition-colors">{inst.name}</span>
                      <span className="text-[11px] text-content-muted font-mono flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        {inst.status.toUpperCase()}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                  </div>
                ))}

                {existingInstances.length === 0 && (
                  <div className="py-8 text-center border-2 border-dashed border-outline rounded-2xl">
                    <p className="text-slate-300 text-[13px]">No active instances found</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mt-8 pt-8 border-t border-outline">
            <Button onClick={onManage} variant="primary" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl font-bold">
              Manage instances
            </Button>
            <Button variant="outline" className="flex-1 bg-surface hover:bg-surface-muted text-content-secondary font-bold h-12 rounded-xl border border-outline flex items-center justify-center gap-2" onClick={() => window.location.href = '/app'}>
              Back to console
            </Button>
            <Button variant="ghost" onClick={onRefresh} className="w-12 h-12 p-0 flex items-center justify-center rounded-xl bg-surface-muted hover:bg-surface-muted text-content-muted" title="Refresh capacity">
              <RefreshCw className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

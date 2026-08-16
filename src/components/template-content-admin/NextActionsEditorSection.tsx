import React from "react";
import { FileJson, AlertCircle, Eye } from "lucide-react";
import { Label, Button } from "../ui";

interface NextActionsEditorSectionProps {
  formNextActionsJson: string;
  handleJsonChange: (val: string) => void;
  jsonError: string;
}

export function NextActionsEditorSection({
  formNextActionsJson,
  handleJsonChange,
  jsonError,
}: NextActionsEditorSectionProps) {
  return (
    <div className="space-y-3 bg-surface-muted/50 p-4 rounded-2xl border border-outline text-left">
      <div className="flex items-center justify-between">
        <Label htmlFor="tempNextActions" className="flex items-center gap-1.5 text-content font-bold">
          <FileJson className="w-4 h-4 text-purple-600" />
          部署下一步推荐动作协议 (next_actions)
        </Label>
        <span className="text-[10px] font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
          JSON Array
        </span>
      </div>
      
      <p className="text-[11px] text-content-muted leading-relaxed">
        控制部署成功后的推荐深链卡片。支持这 5 种预设 actionKey 进行深链路由：
        <span className="font-mono text-[9px] bg-surface border border-outline px-1 py-0.5 rounded mx-0.5 text-purple-700">open_instance_settings</span>
        <span className="font-mono text-[9px] bg-surface border border-outline px-1 py-0.5 rounded mx-0.5 text-purple-700">upload_reference_files</span>
        <span className="font-mono text-[9px] bg-surface border border-outline px-1 py-0.5 rounded mx-0.5 text-purple-700">test_run</span>
        <span className="font-mono text-[9px] bg-surface border border-outline px-1 py-0.5 rounded mx-0.5 text-purple-700">connect_channel</span>
        <span className="font-mono text-[9px] bg-surface border border-outline px-1 py-0.5 rounded mx-0.5 text-purple-700">schedule_first_job</span>
      </p>

      <textarea
        id="tempNextActions"
        value={formNextActionsJson}
        onChange={(e) => handleJsonChange(e.target.value)}
        rows={8}
        className={`flex w-full rounded-lg border bg-slate-900 text-emerald-400 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30 ${
          jsonError ? "border-red-400 focus:border-red-500" : "border-slate-800 focus:border-purple-600"
        }`}
      />

      {jsonError && (
        <div className="text-xs text-red-600 flex items-center gap-1 bg-red-50 p-2 rounded-lg border border-red-100">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{jsonError}</span>
        </div>
      )}

      {/* Live Card-based Preview for next_actions */}
      {!jsonError && formNextActionsJson.trim() && (() => {
        try {
          const actions = JSON.parse(formNextActionsJson);
          if (Array.isArray(actions) && actions.length > 0) {
            return (
              <div className="mt-3 bg-purple-50/40 border border-purple-100 rounded-xl p-3 text-xs space-y-2 text-left">
                <div className="font-bold text-purple-950 flex items-center gap-1 text-[11px] mb-1">
                  <Eye className="w-3.5 h-3.5 text-purple-700" />
                  部署成功页推荐动作(深链卡片)即时预览:
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {actions.map((act: any, idx: number) => (
                    <div key={idx} className="bg-surface border border-outline rounded-xl p-3 flex items-start justify-between shadow-sm">
                      <div className="space-y-1 pr-2 text-left">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-content text-[11px]">{act.label || "未命名推荐动作"}</span>
                          {act.isPrimary && (
                            <span className="bg-blue-100 text-blue-800 text-[9px] px-1.5 py-0.5 rounded font-medium">
                              主要推荐
                            </span>
                          )}
                        </div>
                        {act.description && <p className="text-content-muted text-[10px] leading-relaxed">{act.description}</p>}
                        <div className="text-[9px] text-purple-600 font-mono">
                          动作深链键: <span className="font-bold">{act.actionKey || act.action || "未配置"}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" type="button" disabled className="h-7 text-[10px] whitespace-nowrap">
                        执行前往
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
        } catch {
          return null;
        }
      })()}
    </div>
  );
}

import React from "react";
import { CheckSquare, Eye, ArrowRight, Lock } from "lucide-react";
import { Label } from "../ui";

interface ListItemsConfigSectionProps {
  formReadiness: string;
  setFormReadiness: (val: string) => void;
  formPostDeploy: string;
  setFormPostDeploy: (val: string) => void;
  formLimitations: string;
  setFormLimitations: (val: string) => void;
}

export function ListItemsConfigSection({
  formReadiness,
  setFormReadiness,
  formPostDeploy,
  setFormPostDeploy,
  formLimitations,
  setFormLimitations,
}: ListItemsConfigSectionProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-bold text-content-muted tracking-wider uppercase border-l-2 border-blue-500 pl-2 flex items-center gap-1">
        列表项精细配置 <span className="text-[10px] font-normal text-content-muted lowercase">(每行输入一个条目)</span>
      </h4>

      <div className="grid grid-cols-1 gap-6">
        {/* Readiness Checklist */}
        <div className="space-y-1 text-left">
          <Label htmlFor="tempReadiness" className="flex items-center gap-1.5 text-xs text-content-secondary font-semibold">
            <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
            部署准备清单 (readiness_checklist)
          </Label>
          <textarea
            id="tempReadiness"
            value={formReadiness}
            onChange={(e) => setFormReadiness(e.target.value)}
            placeholder="准备 API 密钥&#10;准备目标渠道 Webhook 链接&#10;设定库存警戒数值"
            rows={3}
            className="flex w-full rounded-lg border border-outline bg-surface/50 px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-content mt-1 shadow-sm"
          />
          
          {/* Live Preview for Readiness */}
          {formReadiness.split("\n").map(l => l.trim()).filter(Boolean).length > 0 && (
            <div className="mt-1.5 bg-blue-50/40 border border-blue-100/60 rounded-xl p-3 text-xs space-y-1">
              <div className="font-bold text-blue-900/80 mb-1.5 flex items-center gap-1 text-[11px]">
                <Eye className="w-3 h-3" />
                清单视觉呈现预览:
              </div>
              <div className="space-y-1.5 pl-1">
                {formReadiness.split("\n").map((line, idx) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  return (
                    <div key={idx} className="flex items-center gap-2 text-content-secondary">
                      <input type="checkbox" disabled checked={false} className="w-3.5 h-3.5 text-blue-500 border-outline-strong rounded flex-shrink-0" />
                      <span className="text-content-secondary text-[11px] font-medium">{trimmed}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Post Deploy Guide */}
        <div className="space-y-1 text-left">
          <Label htmlFor="tempPost" className="flex items-center gap-1.5 text-xs text-content-secondary font-semibold">
            <ArrowRight className="w-3.5 h-3.5 text-emerald-500" />
            部署成功指南 (post_deploy_guide)
          </Label>
          <textarea
            id="tempPost"
            value={formPostDeploy}
            onChange={(e) => setFormPostDeploy(e.target.value)}
            placeholder="步骤一：前往渠道设置连接你的飞书自建应用&#10;步骤二：前往文件管理上传你的竞品大纲&#10;步骤三：确认定时自动任务分发"
            rows={3}
            className="flex w-full rounded-lg border border-outline bg-surface/50 px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-content mt-1 shadow-sm"
          />

          {/* Live Preview for Post Deploy Guide */}
          {formPostDeploy.split("\n").map(l => l.trim()).filter(Boolean).length > 0 && (
            <div className="mt-1.5 bg-emerald-50/30 border border-emerald-100/60 rounded-xl p-3 text-xs">
              <div className="font-bold text-emerald-900/80 mb-1.5 flex items-center gap-1 text-[11px]">
                <Eye className="w-3 h-3" />
                成功指南有序步骤预览:
              </div>
              <ol className="space-y-1.5 list-decimal pl-4">
                {formPostDeploy.split("\n").map((line, idx) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  return (
                    <li key={idx} className="text-content-secondary text-[11px] font-medium leading-relaxed">
                      {trimmed}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>

        {/* Limitations */}
        <div className="space-y-1 text-left">
          <Label htmlFor="tempLimits" className="flex items-center gap-1.5 text-xs text-content-secondary font-semibold">
            <Lock className="w-3.5 h-3.5 text-amber-500" />
            技术局限性说明 (limitations)
          </Label>
          <textarea
            id="tempLimits"
            value={formLimitations}
            onChange={(e) => setFormLimitations(e.target.value)}
            placeholder="受平台防爬限制，频繁请求可能会触发 IP 锁定&#10;暂不支持全自动直接发布，提供核心选题及草稿导出"
            rows={2}
            className="flex w-full rounded-lg border border-outline bg-surface/50 px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-content mt-1 shadow-sm"
          />

          {/* Live Preview for Limitations */}
          {formLimitations.split("\n").map(l => l.trim()).filter(Boolean).length > 0 && (
            <div className="mt-1.5 bg-amber-50/30 border border-amber-100/60 rounded-xl p-3 text-xs">
              <div className="font-bold text-amber-900/80 mb-1.5 flex items-center gap-1 text-[11px]">
                <Eye className="w-3.5 h-3.5 text-amber-500" />
                局限性警示条目预览:
              </div>
              <ul className="space-y-1.5 pl-1">
                {formLimitations.split("\n").map((line, idx) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  return (
                    <li key={idx} className="flex items-start gap-1.5 text-[11px] text-content-secondary font-medium leading-relaxed text-left">
                      <span className="text-amber-500 font-bold flex-shrink-0">•</span>
                      <span>{trimmed}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

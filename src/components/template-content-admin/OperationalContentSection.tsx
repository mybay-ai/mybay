import React from "react";
import { Label, Input } from "../ui";

interface OperationalContentSectionProps {
  activeSubTab: "workflows" | "blueprints";
  formTargetAudience: string;
  setFormTargetAudience: (val: string) => void;
  formBusinessValue: string;
  setFormBusinessValue: (val: string) => void;
  formAutomationResult: string;
  setFormAutomationResult: (val: string) => void;
}

export function OperationalContentSection({
  activeSubTab,
  formTargetAudience,
  setFormTargetAudience,
  formBusinessValue,
  setFormBusinessValue,
  formAutomationResult,
  setFormAutomationResult,
}: OperationalContentSectionProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-bold text-content-muted tracking-wider uppercase border-l-2 border-blue-500 pl-2">
        商业运营字段 (标准治理)
      </h4>

      <div>
        <Label htmlFor="tempAudience">适合人群 (target_audience)</Label>
        <Input
          id="tempAudience"
          value={formTargetAudience}
          onChange={(e: any) => setFormTargetAudience(e.target.value)}
          placeholder="例如: 适合跨境独立站卖家、DTC品牌出海运营团队"
        />
      </div>

      <div>
        <Label htmlFor="tempValue">商业价值 (business_value)</Label>
        <textarea
          id="tempValue"
          value={formBusinessValue}
          onChange={(e) => setFormBusinessValue(e.target.value)}
          placeholder="用克制、专业的话术描述降本增效成果，切忌夸大其词"
          rows={3}
          className="flex w-full rounded-lg border border-outline bg-surface/50 px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-content mt-1 shadow-sm"
        />
      </div>

      {activeSubTab === "workflows" && (
        <div>
          <Label htmlFor="tempResult">自动化成果 (automation_result)</Label>
          <textarea
            id="tempResult"
            value={formAutomationResult}
            onChange={(e) => setFormAutomationResult(e.target.value)}
            placeholder="如: 已自动执行 1,420 次跑批，成功提炼 28 个分析话题..."
            rows={2}
            className="flex w-full rounded-lg border border-outline bg-surface/50 px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-content mt-1 shadow-sm"
          />
        </div>
      )}
    </div>
  );
}

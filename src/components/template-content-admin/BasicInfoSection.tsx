import React from "react";
import { Label, Input } from "../ui";

interface BasicInfoSectionProps {
  isCreating: boolean;
  formId: string;
  setFormId: (val: string) => void;
  formSlug: string;
  setFormSlug: (val: string) => void;
  formName: string;
  setFormName: (val: string) => void;
  formDescription: string;
  setFormDescription: (val: string) => void;
  formCategory: string;
  setFormCategory: (val: string) => void;
  formSortOrder: string | number;
  setFormSortOrder: (val: string | number) => void;
  formIsActive: boolean;
  setFormIsActive: (val: boolean) => void;
}

export function BasicInfoSection({
  isCreating,
  formId,
  setFormId,
  formSlug,
  setFormSlug,
  formName,
  setFormName,
  formDescription,
  setFormDescription,
  formCategory,
  setFormCategory,
  formSortOrder,
  setFormSortOrder,
  formIsActive,
  setFormIsActive,
}: BasicInfoSectionProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-bold text-content-muted tracking-wider uppercase border-l-2 border-blue-500 pl-2">
        基础属性配置
      </h4>
      
      {isCreating && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-surface-muted p-3 rounded-xl border border-outline">
          <div>
            <Label htmlFor="tempId">模板唯一 ID *</Label>
            <Input
              id="tempId"
              value={formId}
              onChange={(e: any) => {
                const val = e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, "");
                setFormId(val);
                if (!formSlug) {
                  setFormSlug(val);
                }
              }}
              placeholder="仅限小写字母、数字和连字符(-)"
              required
            />
            <span className="text-[10px] text-content-muted mt-0.5 block">仅支持小写字母、数字和连字符(-)</span>
          </div>
          <div>
            <Label htmlFor="tempSlug">模板唯一 Slug *</Label>
            <Input
              id="tempSlug"
              value={formSlug}
              onChange={(e: any) => {
                const val = e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, "");
                setFormSlug(val);
              }}
              placeholder="仅限小写字母、数字 and 连字符(-)"
              required
            />
            <span className="text-[10px] text-content-muted mt-0.5 block">用于部署深链策略，与 ID 保持一致即可</span>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="tempName">展示名称</Label>
          <Input
            id="tempName"
            value={formName}
            onChange={(e: any) => setFormName(e.target.value)}
            placeholder="请输入模板展示名称"
            required
          />
        </div>
        <div>
          <Label htmlFor="tempCategory">标签分类</Label>
          <Input
            id="tempCategory"
            value={formCategory}
            onChange={(e: any) => setFormCategory(e.target.value)}
            placeholder="如 ecommerce, social, utility"
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="tempDesc">核心方案描述</Label>
        <textarea
          id="tempDesc"
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
          placeholder="对模板功能与效果的极简概括..."
          rows={3}
          className="flex w-full rounded-lg border border-outline bg-surface/50 px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-content mt-1 shadow-sm"
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center bg-surface-muted p-3 rounded-xl border border-outline">
        <div>
          <Label htmlFor="tempSortOrder">展示排序权重</Label>
          <Input
            id="tempSortOrder"
            type="number"
            value={formSortOrder}
            onChange={(e: any) => setFormSortOrder(e.target.value)}
            placeholder="数字越小，在模版中心展示越靠前"
            required
          />
        </div>
        <div className="flex items-center gap-2 h-full mt-6">
          <input
            type="checkbox"
            id="tempIsActive"
            checked={formIsActive}
            onChange={(e) => setFormIsActive(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-outline-strong rounded focus:ring-blue-500 cursor-pointer"
          />
          <label htmlFor="tempIsActive" className="text-sm font-semibold text-content cursor-pointer select-none">
            立即对所有用户生效发布 (is_active)
          </label>
        </div>
      </div>
    </div>
  );
}

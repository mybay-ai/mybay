import React from "react";
import { X, HelpCircle, Save, Info } from "lucide-react";
import { Button, Card } from "../ui";
import { useFeedback } from "../FeedbackProvider";
import { TemplateItem } from "./types";
import { BasicInfoSection } from "./BasicInfoSection";
import { OperationalContentSection } from "./OperationalContentSection";
import { ListItemsConfigSection } from "./ListItemsConfigSection";
import { NextActionsEditorSection } from "./NextActionsEditorSection";
import { getBusinessValueString, parseArrayField } from "./utils";

interface TemplateEditorPanelProps {
  isCreating: boolean;
  isEditing: boolean;
  activeSubTab: "workflows" | "blueprints";
  selectedItem: TemplateItem | null;
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
  formTargetAudience: string;
  setFormTargetAudience: (val: string) => void;
  formBusinessValue: string;
  setFormBusinessValue: (val: string) => void;
  formAutomationResult: string;
  setFormAutomationResult: (val: string) => void;
  formReadiness: string;
  setFormReadiness: (val: string) => void;
  formPostDeploy: string;
  setFormPostDeploy: (val: string) => void;
  formLimitations: string;
  setFormLimitations: (val: string) => void;
  formNextActionsJson: string;
  handleJsonChange: (val: string) => void;
  jsonError: string;
  handleSubmit: (e: React.FormEvent) => void;
  handleDelete: (item: TemplateItem) => void;
  onCancel: () => void;
  loading: boolean;
  checkFieldsStatus: (item: TemplateItem) => {
    status: string;
    text: string;
    color: string;
    missingLabels?: string[];
  };
  lastPublishedAt?: string;
}

export function TemplateEditorPanel({
  isCreating,
  isEditing,
  activeSubTab,
  selectedItem,
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
  formTargetAudience,
  setFormTargetAudience,
  formBusinessValue,
  setFormBusinessValue,
  formAutomationResult,
  setFormAutomationResult,
  formReadiness,
  setFormReadiness,
  formPostDeploy,
  setFormPostDeploy,
  formLimitations,
  setFormLimitations,
  formNextActionsJson,
  handleJsonChange,
  jsonError,
  handleSubmit,
  handleDelete,
  onCancel,
  loading,
  checkFieldsStatus,
  lastPublishedAt
}: TemplateEditorPanelProps) {
  const { showToast, showAlert, showConfirm } = useFeedback();

  if (!isEditing && !isCreating) return null;

  const changedFields: string[] = [];
  if (isEditing && selectedItem) {
    if (formName !== (selectedItem.name || "")) changedFields.push("名称");
    if (formDescription !== (selectedItem.description || "")) changedFields.push("描述");
    if (formCategory !== (selectedItem.category || "")) changedFields.push("分类");
    if (String(formSortOrder) !== String(selectedItem.sort_order || 0)) changedFields.push("排序权重");
    if (formIsActive !== (selectedItem.is_active !== false)) changedFields.push("启用状态");
    if (formTargetAudience !== (selectedItem.target_audience || "")) changedFields.push("目标受众");
    if (formBusinessValue !== getBusinessValueString(selectedItem.business_value)) changedFields.push("商业价值");
    if (activeSubTab === "workflows" && formAutomationResult !== (selectedItem.automation_result || "")) changedFields.push("自动化运行结果");
    if (formReadiness !== parseArrayField(selectedItem.readiness_checklist)) changedFields.push("启动前准备");
    if (formPostDeploy !== parseArrayField(selectedItem.post_deploy_guide)) changedFields.push("部署后指南");
    if (formLimitations !== parseArrayField(selectedItem.limitations)) changedFields.push("使用限制");

    let origNextActionsJson = "[]";
    if (selectedItem.next_actions) {
      let rawJson = selectedItem.next_actions;
      if (typeof rawJson === "string") {
        try { rawJson = JSON.parse(rawJson); } catch {}
      }
      origNextActionsJson = JSON.stringify(rawJson, null, 2);
    }
    if (formNextActionsJson !== origNextActionsJson) changedFields.push("下一步动作");
  }

  const handlePrePublishSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing) {
      // Build a temporary item reflecting the current form state
      const tempItem: TemplateItem = {
        id: formId || (selectedItem?.id || ""),
        name: formName,
        description: formDescription,
        category: formCategory,
        sort_order: Number(formSortOrder) || 0,
        is_active: formIsActive,
        target_audience: formTargetAudience,
        business_value: formBusinessValue,
        automation_result: formAutomationResult,
        readiness_checklist: formReadiness,
        post_deploy_guide: formPostDeploy,
        limitations: formLimitations,
        next_actions: formNextActionsJson
      };
      
      const fs = checkFieldsStatus(tempItem);
      if (fs.status === "partial" && fs.missingLabels && fs.missingLabels.length > 0) {
        const confirmed = await showConfirm({
          title: "模板发布内容确认",
          message: `当前模板仍缺少 ${fs.missingLabels.join("、")}等推荐运营字段，确认仍要强制发布吗？`,
          type: "warning",
          confirmText: "仍要发布",
          cancelText: "返回补充"
        });
        if (!confirmed) {
          return;
        }
      }
    }
    handleSubmit(e);
  };

  return (
    <div className="lg:col-span-7">
      <Card className="border border-outline shadow-md text-left">
        <div className="flex items-center justify-between border-b border-outline pb-4 mb-4">
          <div>
            <span className="text-xs font-bold font-mono tracking-wider bg-blue-100 text-blue-800 uppercase px-2 py-1 rounded-md">
              {isCreating ? "新建工作流" : (activeSubTab === "workflows" ? "Workflow" : "Blueprint")}
            </span>
            <h3 className="text-lg font-bold text-content mt-2">
              {isCreating ? "新建自定义工作流模板" : (
                <>编辑模板: <span className="text-content-secondary font-mono font-normal text-sm ml-1">{selectedItem?.id}</span></>
              )}
            </h3>
          </div>
          <button 
            type="button"
            onClick={onCancel}
            className="p-1 text-content-muted hover:text-content-secondary rounded-lg hover:bg-control-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Data source status indicator */}
        {!isCreating && selectedItem && (() => {
          const fs = checkFieldsStatus(selectedItem);
          return (
            <div className={`mb-4 px-3 py-2.5 rounded-xl border ${fs.color} text-xs flex flex-col gap-1.5`}>
              <div className="flex items-center gap-1.5 font-semibold">
                <HelpCircle className="w-4 h-4 flex-shrink-0" />
                <span>{fs.text}</span>
              </div>
              {fs.missingLabels && fs.missingLabels.length > 0 && (
                <div className="pl-5 text-amber-800/80 font-medium">
                  <span className="opacity-80">当前缺少: </span>
                  {fs.missingLabels.join("、")}
                </div>
              )}
            </div>
          );
        })()}

        {/* Unsaved Changes Preview */}
        {isEditing && changedFields.length > 0 && (
          <div className="mb-4 px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50/50 text-xs flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-amber-800">
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>当前为草稿修改，尚未发布</span>
            </div>
            <div className="pl-5 text-amber-700/80 font-medium">
              <span className="opacity-80">本次修改了: </span>
              {changedFields.join("、")}
            </div>
          </div>
        )}

        <form onSubmit={handlePrePublishSave} className="space-y-6">
          {/* Last Published Info */}
          {isEditing && lastPublishedAt && (
            <div className="text-xs text-content-muted font-medium">
              最近一次发布/更新: <span className="font-mono bg-control-hover px-1.5 py-0.5 rounded text-content-secondary">{lastPublishedAt}</span>
            </div>
          )}

          {/* Section A: Basic Fields */}
          <BasicInfoSection
            isCreating={isCreating}
            formId={formId}
            setFormId={setFormId}
            formSlug={formSlug}
            setFormSlug={setFormSlug}
            formName={formName}
            setFormName={setFormName}
            formDescription={formDescription}
            setFormDescription={setFormDescription}
            formCategory={formCategory}
            setFormCategory={setFormCategory}
            formSortOrder={formSortOrder}
            setFormSortOrder={setFormSortOrder}
            formIsActive={formIsActive}
            setFormIsActive={setFormIsActive}
          />

          {/* Section B: Target & Business Values */}
          <OperationalContentSection
            activeSubTab={activeSubTab}
            formTargetAudience={formTargetAudience}
            setFormTargetAudience={setFormTargetAudience}
            formBusinessValue={formBusinessValue}
            setFormBusinessValue={setFormBusinessValue}
            formAutomationResult={formAutomationResult}
            setFormAutomationResult={setFormAutomationResult}
          />

          {/* Section C: Line Arrays with Live Preview */}
          <ListItemsConfigSection
            formReadiness={formReadiness}
            setFormReadiness={setFormReadiness}
            formPostDeploy={formPostDeploy}
            setFormPostDeploy={setFormPostDeploy}
            formLimitations={formLimitations}
            setFormLimitations={setFormLimitations}
          />

          {/* Section D: JSON Field next_actions with Live Cards Preview */}
          <NextActionsEditorSection
            formNextActionsJson={formNextActionsJson}
            handleJsonChange={handleJsonChange}
            jsonError={jsonError}
          />

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-outline">
            {isEditing && selectedItem && activeSubTab === "workflows" && selectedItem.is_system !== true && (
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDelete(selectedItem)}
                disabled={loading}
                className="mr-auto text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              >
                🗑️ 删除模板
              </Button>
            )}
            <Button 
              type="button" 
              variant="outline" 
              onClick={onCancel}
              disabled={loading}
            >
              取消编辑
            </Button>
            <Button 
              type="submit" 
              variant="primary" 
              disabled={loading || !!jsonError || (isEditing && changedFields.length === 0)}
              className="gap-2"
            >
              <Save className="w-4 h-4" />
              {loading ? (isCreating ? "保存中..." : "发布中...") : (isCreating ? "保存内容" : "保存并发布内容")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

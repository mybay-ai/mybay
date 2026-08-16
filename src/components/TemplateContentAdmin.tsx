import React, { useState, useEffect } from "react";
import { 
  CheckCircle2, 
  AlertCircle, 
  Layers,
  Plus
} from "lucide-react";
import { Button, Card } from "./ui";
import { useFeedback } from "./FeedbackProvider";
import { api } from "../lib/api";

import { TemplateItem } from "./template-content-admin/types";
import { TemplateAuditPanel } from "./template-content-admin/TemplateAuditPanel";
import { TemplateListPanel } from "./template-content-admin/TemplateListPanel";
import { TemplateEditorPanel } from "./template-content-admin/TemplateEditorPanel";
import { 
  checkFieldsStatus, 
  getBusinessValueString, 
  parseArrayField 
} from "./template-content-admin/utils";

export function TemplateContentAdmin({ currentUser }: { currentUser: any }) {
  const { showToast, showAlert, showConfirm } = useFeedback();
  const isAdmin = currentUser?.role === 'admin' || (currentUser?.role as string) === 'super_admin';
  const [activeSubTab, setActiveSubTab] = useState<"workflows" | "blueprints">("workflows");
  
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Filtering states
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  
  // Batch states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Edit State
  const [selectedItem, setSelectedItem] = useState<TemplateItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formId, setFormId] = useState("");
  const [formSlug, setFormSlug] = useState("");
  
  // Form values
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formSortOrder, setFormSortOrder] = useState<string | number>(0);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formTargetAudience, setFormTargetAudience] = useState("");
  const [formBusinessValue, setFormBusinessValue] = useState("");
  const [formAutomationResult, setFormAutomationResult] = useState("");
  
  // Line-by-line arrays
  const [formReadiness, setFormReadiness] = useState("");
  const [formPostDeploy, setFormPostDeploy] = useState("");
  const [formLimitations, setFormLimitations] = useState("");
  
  // JSON field for next_actions
  const [formNextActionsJson, setFormNextActionsJson] = useState("");
  const [jsonError, setJsonError] = useState("");

  useEffect(() => {
    fetchItems();
    fetchAuditLogs();
  }, [activeSubTab]);

  const fetchItems = async (skipClearMsg: boolean = false) => {
    setLoading(true);
    if (!skipClearMsg) {
      setError("");
      setSuccessMsg("");
    }
    setSelectedIds([]); // Reset selection on sub tab change or fetch
    try {
      const url = `/api/admin/template-content/${activeSubTab}`;
      const data = await api.get(url);
      setItems(data || []);
      return data || [];
    } catch (err: any) {
      console.error("Fetch templates error:", err);
      setError(err.message || "加载模板列表失败");
      return [];
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setLogsLoading(true);
    try {
      const logs = await api.get("/api/admin/template-content/audit-logs");
      setAuditLogs(logs || []);
    } catch (err) {
      console.error("Fetch template audit logs error:", err);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleToggleActive = async (item: TemplateItem) => {
    setError("");
    setSuccessMsg("");
    setLoading(true);
    try {
      const url = `/api/admin/template-content/${activeSubTab}/${item.id}`;
      await api.patch(url, {
        is_active: !item.is_active
      });
      setSuccessMsg(`操作成功！已将模板「${item.name || item.id}」设为 ${!item.is_active ? "「生效中」" : "「已下架」"}。`);
      if (selectedItem?.id === item.id) {
        setFormIsActive(!item.is_active);
        setSelectedItem({ ...selectedItem, is_active: !item.is_active });
      }
      await fetchItems(true);
      await fetchAuditLogs();
    } catch (err: any) {
      console.error("Toggle active status error:", err);
      setError(err.response?.data?.error || err.message || "切换状态失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkStatus = async (isActive: boolean, targetIds: string[]) => {
    setError("");
    setSuccessMsg("");
    setLoading(true);
    try {
      const url = `/api/admin/template-content/${activeSubTab}/bulk-status`;
      await api.patch(url, {
        ids: targetIds,
        is_active: isActive
      });
      setSuccessMsg(`批量操作成功！已将 ${targetIds.length} 个模板设为 ${isActive ? "「生效中」" : "「已下架」"}。`);
      setSelectedIds(prev => prev.filter(id => !targetIds.includes(id)));
      await fetchItems(true);
      await fetchAuditLogs();
    } catch (err: any) {
      console.error("Bulk status update error:", err);
      setError(err.message || "批量更新状态失败");
    } finally {
      setLoading(false);
    }
  };

  const startCreate = () => {
    setIsEditing(false);
    setSelectedItem(null);
    setFormId("");
    setFormSlug("");
    setFormName("");
    setFormDescription("");
    setFormCategory("general");
    setFormSortOrder(10);
    setFormIsActive(true);
    setFormTargetAudience("");
    setFormBusinessValue("");
    setFormAutomationResult("");
    setFormReadiness("");
    setFormPostDeploy("");
    setFormLimitations("");
    setFormNextActionsJson("[]");
    setJsonError("");
    setError("");
    setSuccessMsg("");
    setIsCreating(true);
  };

  const startEdit = (item: TemplateItem) => {
    setIsCreating(false);
    setSelectedItem(item);
    setFormName(item.name || "");
    setFormDescription(item.description || "");
    setFormCategory(item.category || "");
    setFormSortOrder(item.sort_order || 0);
    setFormIsActive(item.is_active !== false);
    setFormTargetAudience(item.target_audience || "");
    
    setFormBusinessValue(getBusinessValueString(item.business_value));
    setFormAutomationResult(item.automation_result || "");
    
    setFormReadiness(parseArrayField(item.readiness_checklist));
    setFormPostDeploy(parseArrayField(item.post_deploy_guide));
    setFormLimitations(parseArrayField(item.limitations));
    
    // JSON formatting for next_actions
    if (item.next_actions) {
      let rawJson = item.next_actions;
      if (typeof rawJson === "string") {
        try {
          rawJson = JSON.parse(rawJson);
        } catch {
          // ignore
        }
      }
      setFormNextActionsJson(JSON.stringify(rawJson, null, 2));
    } else {
      setFormNextActionsJson("[]");
    }
    
    setJsonError("");
    setIsEditing(true);
  };

  const startClone = (item: TemplateItem) => {
    setIsEditing(false);
    setSelectedItem(null);
    setIsCreating(true);
    setFormId("");
    setFormSlug("");
    setFormName(`${item.name} 副本`);
    setFormDescription(item.description || "");
    setFormCategory(item.category || "general");
    setFormSortOrder(item.sort_order || 0);
    setFormIsActive(false);
    setFormTargetAudience(item.target_audience || "");
    
    setFormBusinessValue(getBusinessValueString(item.business_value));
    setFormAutomationResult(item.automation_result || "");
    
    setFormReadiness(parseArrayField(item.readiness_checklist));
    setFormPostDeploy(parseArrayField(item.post_deploy_guide));
    setFormLimitations(parseArrayField(item.limitations));
    
    if (item.next_actions) {
      let rawJson = item.next_actions;
      if (typeof rawJson === "string") {
        try {
          rawJson = JSON.parse(rawJson);
        } catch {
          // ignore
        }
      }
      setFormNextActionsJson(JSON.stringify(rawJson, null, 2));
    } else {
      setFormNextActionsJson("[]");
    }
    
    setJsonError("");
    setError("");
    setSuccessMsg("");
  };

  const handleJsonChange = (val: string) => {
    setFormNextActionsJson(val);
    if (!val.trim()) {
      setJsonError("");
      return;
    }
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) {
        setJsonError("必须是一个 JSON 数组 (e.g. [ { \"action\": \"...\" } ])");
      } else {
        // Validate keys
        const hasBadItem = parsed.some(item => typeof item !== "object" || item === null);
        if (hasBadItem) {
          setJsonError("数组项必须是对象");
        } else {
          setJsonError("");
        }
      }
    } catch (e: any) {
      setJsonError(`JSON 格式非法: ${e.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) {
      await createItem();
    } else {
      await saveItem(e);
    }
  };

  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    setError("");
    setSuccessMsg("");

    if (formCategory === "__system_archived__") {
      setError("该分类名称为系统保留值，请使用其他分类名");
      return;
    }

    // Validate sort_order
    const sortOrderStr = String(formSortOrder).trim();
    if (!sortOrderStr) {
      setError("排序权重不能为空");
      return;
    }
    const parsedSortOrder = Number(sortOrderStr);
    if (!Number.isFinite(parsedSortOrder) || !Number.isInteger(parsedSortOrder)) {
      setError("排序权重必须是有效整数");
      return;
    }

    // Validate JSON next_actions
    let parsedNextActions = null;
    if (formNextActionsJson.trim()) {
      try {
        parsedNextActions = JSON.parse(formNextActionsJson);
        if (!Array.isArray(parsedNextActions)) {
          setError("「下一步推荐动作」必须是个合法的 JSON 数组结构");
          return;
        }
      } catch (err: any) {
        setError(`「下一步推荐动作」JSON 语法错误: ${err.message}`);
        return;
      }
    }

    // Split line arrays
    const splitLines = (str: string): string[] => {
      return str
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);
    };

    const readiness_checklist = splitLines(formReadiness);
    const post_deploy_guide = splitLines(formPostDeploy);
    const limitations = splitLines(formLimitations);

    const payload: any = {
      name: formName,
      description: formDescription,
      category: formCategory,
      sort_order: parsedSortOrder,
      is_active: formIsActive,
      target_audience: formTargetAudience || null,
      business_value: formBusinessValue || null,
      readiness_checklist,
      post_deploy_guide,
      limitations,
      next_actions: parsedNextActions
    };

    if (activeSubTab === "workflows") {
      payload.automation_result = formAutomationResult || null;
    }

    setLoading(true);
    try {
      const url = `/api/admin/template-content/${activeSubTab}/${selectedItem.id}`;
      await api.patch(url, payload);
      setSuccessMsg("保存成功！内容已安全同步。");
      const latestItems = await fetchItems(true);
      await fetchAuditLogs();
      const matched = latestItems.find((item: any) => item.id === selectedItem.id);
      if (matched) {
        startEdit(matched);
      } else {
        setIsEditing(false);
        setSelectedItem(null);
      }
    } catch (err: any) {
      console.error("Save template error:", err);
      setError(err.message || "保存模板内容失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item: TemplateItem) => {
    if (!item) return;
    setError("");
    setSuccessMsg("");

    if (item.is_system === true) {
      setError("系统内置模板不允许删除");
      return;
    }

    const confirmed = await showConfirm({
      title: "确认删除模板",
      message: `您确定要删除/归档自定义工作流模板「${item.name || item.id}」吗？\n\n删除后该模板将从管理可见列表中隐藏并停用，此操作不可逆。`,
      type: "danger",
      confirmText: "确定删除",
      cancelText: "取消"
    });
    if (!confirmed) {
      return;
    }

    setLoading(true);
    try {
      const url = `/api/admin/template-content/workflows/${item.id}`;
      await api.delete(url);
      setSuccessMsg(`自定义工作流模板「${item.name || item.id}」已成功删除并归档！`);
      showToast("模板已删除", "success");
      
      // Close editing state and return to list
      setIsEditing(false);
      setSelectedItem(null);
      
      // Refresh items (keeping the success message) and audit logs
      await fetchItems(true);
      await fetchAuditLogs();
    } catch (err: any) {
      console.error("Delete template error:", err);
      setError(err?.data?.error || err?.message || "删除模板失败，请检查网络或权限。");
    } finally {
      setLoading(false);
    }
  };

  const createItem = async () => {
    setError("");
    setSuccessMsg("");

    const cleanId = formId.trim();
    const cleanSlug = formSlug.trim();
    const cleanName = formName.trim();

    if (!cleanId) {
      setError("模板 ID 不能为空");
      return;
    }
    const idRegex = /^[a-z0-9\-]+$/;
    if (!idRegex.test(cleanId)) {
      setError("模板 ID 格式不正确，仅支持小写字母、数字和连字符(-)");
      return;
    }

    if (!cleanSlug) {
      setError("模板 Slug 不能为空");
      return;
    }
    if (!idRegex.test(cleanSlug)) {
      setError("模板 Slug 格式不正确，仅支持小写字母、数字和连字符(-)");
      return;
    }

    if (!cleanName) {
      setError("模板名称不能为空");
      return;
    }

    if (formCategory === "__system_archived__") {
      setError("该分类名称为系统保留值，请使用其他分类名");
      return;
    }

    const sortOrderStr = String(formSortOrder).trim();
    if (!sortOrderStr) {
      setError("排序权重不能为空");
      return;
    }
    const parsedSortOrder = Number(sortOrderStr);
    if (!Number.isFinite(parsedSortOrder) || !Number.isInteger(parsedSortOrder)) {
      setError("排序权重必须是有效整数");
      return;
    }

    let parsedNextActions = [];
    if (formNextActionsJson.trim()) {
      try {
        parsedNextActions = JSON.parse(formNextActionsJson);
        if (!Array.isArray(parsedNextActions)) {
          setError("「下一步推荐动作」必须是个合法的 JSON 数组结构");
          return;
        }
      } catch (err: any) {
        setError(`「下一步推荐动作」JSON 语法错误: ${err.message}`);
        return;
      }
    }

    const splitLines = (str: string): string[] => {
      return str
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);
    };

    setLoading(true);
    try {
      const payload = {
        id: cleanId,
        slug: cleanSlug,
        name: cleanName,
        description: formDescription,
        category: formCategory,
        sort_order: parsedSortOrder,
        is_active: formIsActive,
        target_audience: formTargetAudience || null,
        business_value: formBusinessValue || null,
        automation_result: formAutomationResult || null,
        readiness_checklist: splitLines(formReadiness),
        post_deploy_guide: splitLines(formPostDeploy),
        limitations: splitLines(formLimitations),
        next_actions: parsedNextActions
      };

      const res = await api.post("/api/admin/template-content/workflows", payload);
      
      setIsCreating(false);
      const latestItems = await fetchItems(true);
      await fetchAuditLogs();
      
      // Set success message after fetching is complete
      setSuccessMsg(`创建自定义工作流模板「${cleanName}」成功！`);
      
      const targetId = res?.data?.id || cleanId;
      const matched = latestItems.find((item: any) => item.id === targetId);
      if (matched) {
        startEdit(matched);
      }
    } catch (err: any) {
      console.error("Create template error:", err);
      setError(err.message || "创建自定义模板失败");
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <Card className="max-w-md mx-auto mt-12 p-8 text-center border-red-100">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-content mb-2">访问受限</h3>
        <p className="text-content-secondary text-sm mb-4">此页面仅限平台管理员访问。若有疑问，请联系 system 用户组。</p>
      </Card>
    );
  }

  // Get dynamic category values for current table list
  const uniqueCategories = Array.from(new Set(items.map(item => item.category).filter(Boolean))) as string[];

  // Perform client-side filter and stable sort
  const filteredAndSortedItems = items
    .filter(item => {
      // 1. Text Search Query
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || (
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.category || "").toLowerCase().includes(q) ||
        (item.description || "").toLowerCase().includes(q)
      );

      // 2. Status Filter
      let matchesStatus = true;
      if (statusFilter === "active") {
        matchesStatus = item.is_active !== false;
      } else if (statusFilter === "inactive") {
        matchesStatus = item.is_active === false;
      }

      // 3. Category Filter
      let matchesCategory = true;
      if (categoryFilter !== "all") {
        matchesCategory = item.category === categoryFilter;
      }

      return matchesSearch && matchesStatus && matchesCategory;
    })
    .sort((a, b) => {
      const sortA = a.sort_order ?? 0;
      const sortB = b.sort_order ?? 0;
      if (sortA !== sortB) {
        return sortA - sortB;
      }
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });

  let lastPublishedAt = "";
  if (isEditing && selectedItem && auditLogs.length > 0) {
    const match = auditLogs.find(log => {
      if (!log.details) return false;
      const isUpdateOrCreate = log.action?.includes('UPDATE') || log.action?.includes('CREATE');
      if (!isUpdateOrCreate) return false;
      
      const id = selectedItem.id;
      // Precise text boundary matching to prevent partial ID matches (e.g. flow-a vs flow-a-copy)
      if (log.details.includes(`模板 ${id}。`)) return true; // UPDATE
      if (log.details.includes(`ID: ${id},`)) return true; // CREATE
      if (log.details.includes('涉及 ID:')) { // BULK UPDATE
        const parts = log.details.split('涉及 ID:');
        if (parts.length > 1) {
          const ids = parts[1].split(',').map((s: string) => s.trim());
          if (ids.includes(id)) return true;
        }
      }
      return false;
    });

    if (match) {
      lastPublishedAt = new Date(match.timestamp).toLocaleString("zh-CN", { hour12: false });
    } else {
      lastPublishedAt = "暂无发布记录";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="text-left">
          <h2 className="text-2xl font-bold tracking-tight text-content flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-600" />
            模板内容管理台
          </h2>
          <p className="text-content-muted text-sm mt-1">
            实时修改 Workflow（自定义多任务流）与 Blueprint（行业预装方案）的核心文案及深链策略
          </p>
        </div>
        
        {/* Toggle between Workflows & Blueprints */}
        <div className="flex flex-wrap items-center gap-3 self-start sm:self-center">
          <div className="flex bg-control-hover/80 p-1 rounded-xl border border-outline">
            <button
              type="button"
              onClick={() => {
                setActiveSubTab("workflows");
                setIsEditing(false);
                setIsCreating(false);
                setCategoryFilter("all");
                setStatusFilter("all");
              }}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeSubTab === "workflows"
                  ? "bg-surface text-content shadow-sm"
                  : "text-content-secondary hover:text-content"
              }`}
            >
              工作流 (Workflows)
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSubTab("blueprints");
                setIsEditing(false);
                setIsCreating(false);
                setCategoryFilter("all");
                setStatusFilter("all");
              }}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeSubTab === "blueprints"
                  ? "bg-surface text-content shadow-sm"
                  : "text-content-secondary hover:text-content"
              }`}
            >
              行业预设 (Blueprints)
            </button>
          </div>

          {activeSubTab === "workflows" && (
            <Button
              type="button"
              onClick={startCreate}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs h-9 px-4 flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              新建工作流模板
            </Button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-start gap-3 text-left">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">{successMsg}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start gap-3 text-left">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Templates List */}
        <TemplateListPanel
          items={items}
          filteredAndSortedItems={filteredAndSortedItems}
          loading={loading}
          selectedItem={selectedItem}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          activeSubTab={activeSubTab}
          startEdit={startEdit}
          startClone={startClone}
          handleToggleActive={handleToggleActive}
          handleBulkStatus={handleBulkStatus}
          isEditingOrCreating={isEditing || isCreating}
          uniqueCategories={uniqueCategories}
          checkFieldsStatus={checkFieldsStatus}
        />

        {/* Right Side: Detailed Editing Form */}
        <TemplateEditorPanel
          isCreating={isCreating}
          isEditing={isEditing}
          activeSubTab={activeSubTab}
          selectedItem={selectedItem}
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
          formTargetAudience={formTargetAudience}
          setFormTargetAudience={setFormTargetAudience}
          formBusinessValue={formBusinessValue}
          setFormBusinessValue={setFormBusinessValue}
          formAutomationResult={formAutomationResult}
          setFormAutomationResult={setFormAutomationResult}
          formReadiness={formReadiness}
          setFormReadiness={setFormReadiness}
          formPostDeploy={formPostDeploy}
          setFormPostDeploy={setFormPostDeploy}
          formLimitations={formLimitations}
          setFormLimitations={setFormLimitations}
          formNextActionsJson={formNextActionsJson}
          handleJsonChange={handleJsonChange}
          jsonError={jsonError}
          handleSubmit={handleSubmit}
          handleDelete={handleDelete}
          onCancel={() => {
            setIsEditing(false);
            setIsCreating(false);
            setSelectedItem(null);
          }}
          loading={loading}
          checkFieldsStatus={checkFieldsStatus}
          lastPublishedAt={lastPublishedAt}
        />
      </div>

      {/* Recent Template Audit Logs Section */}
      <TemplateAuditPanel auditLogs={auditLogs} logsLoading={logsLoading} />
    </div>
  );
}

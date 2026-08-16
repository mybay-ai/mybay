import React from "react";
import { Search, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui";
import { useFeedback } from "../FeedbackProvider";
import { TemplateItem } from "./types";

interface TemplateListPanelProps {
  items: TemplateItem[];
  filteredAndSortedItems: TemplateItem[];
  loading: boolean;
  selectedItem: TemplateItem | null;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  statusFilter: "all" | "active" | "inactive";
  setStatusFilter: (val: "all" | "active" | "inactive") => void;
  categoryFilter: string;
  setCategoryFilter: (val: string) => void;
  activeSubTab: "workflows" | "blueprints";
  startEdit: (item: TemplateItem) => void;
  startClone?: (item: TemplateItem) => void;
  handleToggleActive?: (item: TemplateItem) => void;
  handleBulkStatus: (isActive: boolean, targetIds: string[]) => void;
  isEditingOrCreating: boolean;
  uniqueCategories: string[];
  checkFieldsStatus: (item: TemplateItem) => {
    status: string;
    text: string;
    color: string;
  };
}

export function TemplateListPanel({
  filteredAndSortedItems,
  loading,
  selectedItem,
  selectedIds,
  setSelectedIds,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  categoryFilter,
  setCategoryFilter,
  activeSubTab,
  startEdit,
  startClone,
  handleToggleActive,
  handleBulkStatus,
  isEditingOrCreating,
  uniqueCategories,
  checkFieldsStatus
}: TemplateListPanelProps) {
  const visibleSelectedIds = selectedIds.filter(id => filteredAndSortedItems.some(item => item.id === id));
  const { t } = useTranslation("admin");
  const { showToast, showAlert, showConfirm } = useFeedback();

  return (
    <div className={`lg:col-span-5 space-y-4 ${isEditingOrCreating ? "hidden lg:block" : "lg:col-span-12"}`}>
      <div className="space-y-3 bg-surface-muted p-4 rounded-2xl border border-outline">
        {/* Search Input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模板 ID、名称、描述或分类..."
              className="pl-9 h-10 w-full rounded-lg border border-outline bg-surface px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-content"
            />
          </div>
          {searchQuery && (
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
              清除
            </Button>
          )}
        </div>

        {/* Quick Select Filters */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <label className="text-[11px] font-bold text-content-muted block mb-1">生效状态</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-9 w-full rounded-lg border border-outline bg-surface px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-content font-medium"
            >
              <option value="all">显示全部状态</option>
              <option value="active">🟢 仅看生效中</option>
              <option value="inactive">⚫️ 仅看已下架</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-content-muted block mb-1">标签分类</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 w-full rounded-lg border border-outline bg-surface px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-content font-medium"
            >
              <option value="all">显示全部分类</option>
              {uniqueCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Batch Actions Bar */}
      {visibleSelectedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center justify-between text-xs font-semibold text-content-secondary animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">{visibleSelectedIds.length}</span>
            <span>已选择当前筛选模板项目</span>
          </div>
          <div className="flex items-center gap-2">
             <Button
              variant="outline"
              size="sm"
              className="bg-surface hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-content-secondary text-[11px] h-7 px-2.5 font-bold"
              onClick={async () => {
                const confirmed = await showConfirm({
                  title: "确认批量上架",
                  message: `您确定要将当前已选的 ${visibleSelectedIds.length} 个模板批量上架（启用）吗？`,
                  type: "info",
                  confirmText: "确定上架",
                  cancelText: "取消"
                });
                if (confirmed) {
                  await handleBulkStatus(true, visibleSelectedIds);
                  showToast("已成功提交上架", "success");
                }
              }}
            >
              🟢 批量上架
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-surface hover:bg-control-hover text-content-secondary text-[11px] h-7 px-2.5 font-bold"
              onClick={async () => {
                const confirmed = await showConfirm({
                  title: "确认批量下架",
                  message: `您确定要将当前已选的 ${visibleSelectedIds.length} 个模板批量下架（停用）吗？`,
                  type: "warning",
                  confirmText: "确定下架",
                  cancelText: "取消"
                });
                if (confirmed) {
                  await handleBulkStatus(false, visibleSelectedIds);
                  showToast("已成功提交下架", "success");
                }
              }}
            >
              ⚫️ 批量下架
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-content-muted hover:text-content-secondary text-[11px] h-7 px-2"
              onClick={() => setSelectedIds(prev => prev.filter(id => !visibleSelectedIds.includes(id)))}
            >
              取消选择
            </Button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-outline rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-muted/50 border-b border-outline text-xs text-content-muted font-semibold">
                <th className="p-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={filteredAndSortedItems.length > 0 && filteredAndSortedItems.map(item => item.id).every(id => selectedIds.includes(id))}
                    onChange={(e) => {
                      const allFilteredIds = filteredAndSortedItems.map(item => item.id);
                      if (e.target.checked) {
                        setSelectedIds(prev => Array.from(new Set([...prev, ...allFilteredIds])));
                      } else {
                        setSelectedIds(prev => prev.filter(id => !allFilteredIds.includes(id)));
                      }
                    }}
                    className="w-4 h-4 text-blue-600 border-outline-strong rounded focus:ring-blue-500 cursor-pointer"
                    title="全选当前筛选结果"
                  />
                </th>
                <th className="p-4">模板名称</th>
                <th className="p-4 hidden sm:table-cell">分类 / 排序</th>
                <th className="p-4 text-center">状态</th>
                <th className="p-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline text-sm text-content-secondary">
              {loading && filteredAndSortedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-content-muted">
                    {t("template_data_loading")}
                  </td>
                </tr>
              ) : filteredAndSortedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-content-muted">
                    未找到匹配的模板内容项
                  </td>
                </tr>
              ) : (
                filteredAndSortedItems.map(item => {
                  const isSelected = selectedIds.includes(item.id);
                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50/40 transition-colors cursor-pointer ${
                        selectedItem?.id === item.id ? "bg-blue-50/20" : ""
                      } ${isSelected ? "bg-blue-55/10" : ""}`}
                      onClick={() => startEdit(item)}
                    >
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(prev => [...prev, item.id]);
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== item.id));
                            }
                          }}
                          className="w-4 h-4 text-blue-600 border-outline-strong rounded focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-content line-clamp-1">{item.name}</div>
                        <div className="text-xs text-content-muted font-mono line-clamp-1">{item.id}</div>
                        {(() => {
                          const fs = checkFieldsStatus(item);
                          return (
                            <div className={`mt-1 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border ${fs.color} font-medium`}>
                              {fs.text}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="p-4 hidden sm:table-cell">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-control-hover text-content-secondary text-xs font-medium mr-2">
                          {item.category}
                        </span>
                        <span className="text-content-muted font-mono text-xs">#{item.sort_order}</span>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (handleToggleActive) handleToggleActive(item);
                          }}
                          title="点击快速切换启停状态"
                          className="hover:opacity-80 transition-opacity focus:outline-none"
                        >
                        {item.is_active !== false ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-xs font-semibold">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-none"></span>
                            生效中
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-content-muted bg-control-hover px-2 py-0.5 rounded-full text-xs font-semibold">
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
                            已下架
                          </span>
                        )}
                        </button>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          {activeSubTab === "workflows" && startClone && (
                             <Button 
                               variant="outline" 
                               size="sm" 
                               className="text-content-muted bg-surface"
                               onClick={() => startClone(item)}
                               title="克隆此模板"
                             >
                               复制
                             </Button>
                          )}
                          <Button 
                            variant={selectedItem?.id === item.id ? "primary" : "outline"} 
                            size="sm" 
                            onClick={() => startEdit(item)}
                          >
                            编辑
                            <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

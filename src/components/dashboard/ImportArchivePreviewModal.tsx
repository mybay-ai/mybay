import React, { useState, useRef, useEffect } from "react";
import { X, Upload, CheckCircle2, AlertTriangle, FileText, Layers, Settings, HelpCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui";
import { getAuthToken } from "../../lib/auth";
import { useFeedback } from "../FeedbackProvider";

interface ImportArchivePreviewModalProps {
  onClose: () => void;
  onRefresh?: () => void;
}

interface PreviewResponse {
  valid: boolean;
  archiveVersion: number;
  redacted: boolean;
  sourceInstanceId: string;
  sourceInstanceName: string;
  exportedAt: string;
  includedSections: string[];
  hasUploads: boolean;
  hasOutputs: boolean;
  configPreview: {
    provider: string;
    model: string;
    templateId: string;
    templateSlug: string;
    channel: string;
    enableDashboard: boolean;
  };
  businessConfigPreview: {
    hasBusinessConfig: boolean;
    sections: string[];
  };
  templateInputsPreview: {
    hasTemplateInputs: boolean;
    keys: string[];
  };
  warnings: string[];
}

export function ImportArchivePreviewModal({ onClose, onRefresh }: ImportArchivePreviewModalProps) {
  const { t } = useTranslation("dashboard");
  const { showToast } = useFeedback();
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cloneName, setCloneName] = useState("");
  const [clonePath, setClonePath] = useState("");
  const [cloneLoading, setCloneLoading] = useState(false);

  useEffect(() => {
    if (previewData) {
      const baseName = previewData.sourceInstanceName || "agent";
      setCloneName(`${baseName}-CLONE`);
      
      const slug = baseName.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setClonePath(`${slug}-clone`);
    }
  }, [previewData]);

  const handleCloneSubmit = async () => {
    if (!file || !cloneName.trim() || !clonePath.trim()) return;

    setCloneLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", cloneName.trim());
    formData.append("path", clonePath.trim());

    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/instances/import-archive/create", {
        method: "POST",
        headers,
        body: formData,
      });

      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || t("import_archive_http_error", { status: response.status }));
      }

      // Success!
      showToast(resData.message || "实例克隆成功，已设为未启动（待补配置）", "success");
      
      if (onRefresh) {
        onRefresh();
      }
      onClose();
    } catch (err: any) {
      console.error("Backup clone failed:", err);
      setError(err.message || "克隆创建实例失败，请检查配置或稍后重试");
    } finally {
      setCloneLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.toLowerCase().endsWith(".zip")) {
        setFile(droppedFile);
        setError(null);
      } else {
        setError(t("import_archive_zip_only_error"));
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.name.toLowerCase().endsWith(".zip")) {
        setFile(selectedFile);
        setError(null);
      } else {
        setError(t("import_archive_zip_only_error"));
      }
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleUploadAndValidate = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/instances/import-archive/preview", {
        method: "POST",
        headers,
        body: formData,
      });

      const resData = await response.json();

      if (!response.ok || resData.valid === false) {
        throw new Error(resData.error || t("import_archive_http_error", { status: response.status }));
      }

      setPreviewData(resData);
    } catch (err: any) {
      console.error("Backup verification failed:", err);
      setError(err.message || t("import_archive_generic_error"));
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setFile(null);
    setPreviewData(null);
    setError(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-[110] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-surface rounded-2xl border border-outline shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-outline shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-content text-base">{t("import_archive_preview_title")}</h3>
              <p className="text-[13px] text-content-muted font-normal mt-0.5">{t("import_archive_subtitle")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-muted rounded-xl text-content-muted hover:text-content-secondary border border-transparent hover:border-slate-150 transition-colors active:scale-95"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {!previewData ? (
            // Upload & Verify Stage
            <div className="space-y-4">
              <p className="text-[13px] text-content-muted leading-relaxed font-normal">
                {t("import_archive_preview_desc")}
              </p>

              {/* Drag Zone */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={triggerFileInput}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${
                  dragActive
                    ? "border-emerald-500 bg-emerald-50/20"
                    : file
                    ? "border-outline-strong bg-surface-muted/50"
                    : "border-outline hover:border-outline-strong hover:bg-surface-muted/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileChange}
                  className="hidden"
                />
                
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
                  file ? "bg-control-hover text-content-secondary" : "bg-emerald-50 text-emerald-600"
                }`}>
                  <Upload className="w-6 h-6" />
                </div>

                {file ? (
                  <div className="space-y-1">
                    <p className="text-[13px] font-semibold text-content-secondary break-all px-4">{file.name}</p>
                    <p className="text-[11px] text-content-muted font-normal">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[13px] font-semibold text-content-secondary">
                      {t("import_archive_select_file")}
                    </p>
                    <p className="text-[11px] text-content-muted font-normal">
                      {t("import_archive_drop_hint")}
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-50/50 border border-red-100 rounded-xl text-[13px] text-red-600 font-medium leading-relaxed flex items-start gap-2.5 animate-in fade-in duration-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <span>{error}</span>
                </div>
              )}

              {/* Action */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="outline" onClick={onClose} disabled={loading} className="rounded-xl h-10 text-[13px]">
                  {t("import_archive_cancel")}
                </Button>
                <Button
                  onClick={handleUploadAndValidate}
                  disabled={!file || loading}
                  className="rounded-xl h-10 px-6 font-semibold shadow-md bg-slate-800 hover:bg-slate-900 text-white text-[13px]"
                >
                  {loading ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t("import_archive_validate")}...
                    </span>
                  ) : (
                    t("import_archive_validate")
                  )}
                </Button>
              </div>
            </div>
          ) : (
            // Preview Analysis Stage
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Valid Status Header */}
              <div className="p-4.5 bg-emerald-50/40 border border-emerald-100/60 rounded-2xl flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-[13px] font-bold text-emerald-800">{t("import_archive_valid")}</h4>
                  <p className="text-[13px] text-emerald-600/90 font-normal mt-0.5">
                    {t("import_archive_success_desc")}
                  </p>
                </div>
              </div>

              {/* Basic Information */}
              <div className="bg-surface-muted/60 border border-outline rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2.5 border-b border-outline/50">
                  <FileText className="w-4 h-4 text-content-muted" />
                  <span className="text-[13px] font-bold text-content-secondary">{t("import_archive_metadata_title")}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block uppercase tracking-wider">{t("import_archive_source_instance")}</span>
                    <span className="font-semibold text-content-secondary block break-all">{previewData.sourceInstanceName}</span>
                    <span className="font-mono text-[9px] text-content-muted block mt-0.5">{previewData.sourceInstanceId}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block uppercase tracking-wider">{t("import_archive_exported_time")}</span>
                    <span className="font-semibold text-content-secondary block">
                      {new Date(previewData.exportedAt).toLocaleString() || previewData.exportedAt}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block uppercase tracking-wider">{t("import_archive_schema_version")}</span>
                    <span className="font-mono font-semibold text-content-secondary">v{previewData.archiveVersion}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block uppercase tracking-wider">{t("import_archive_redacted_title")}</span>
                    <span className="font-semibold text-emerald-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {t("import_archive_redacted_value")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sections Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-content-muted" />
                  <span className="text-[13px] font-bold text-content-secondary">{t("import_archive_sections_title")}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {previewData.includedSections.map((sec) => (
                    <span
                      key={sec}
                      className="inline-flex items-center px-2.5 py-1 rounded-lg bg-control-hover border border-outline/40 text-[11px] font-semibold text-content-secondary capitalize"
                    >
                      {sec === "manifest" && t("import_archive_section_manifest")}
                      {sec === "config" && t("import_archive_section_config")}
                      {sec === "business-config" && t("import_archive_section_business")}
                      {sec === "template-inputs" && t("import_archive_section_template_inputs")}
                      {sec === "uploads" && t("import_archive_section_uploads")}
                      {sec === "outputs" && t("import_archive_section_outputs")}
                    </span>
                  ))}
                </div>
              </div>

              {/* Config Details */}
              <div className="bg-surface-muted/60 border border-outline rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2.5 border-b border-outline/50">
                  <Settings className="w-4 h-4 text-content-muted" />
                  <span className="text-[13px] font-bold text-content-secondary">{t("import_archive_config_title")}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px] font-medium">
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block">{t("import_archive_provider_label")}</span>
                    <span className="font-semibold text-content-secondary capitalize">{previewData.configPreview.provider || "--"}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block">{t("import_archive_model_label")}</span>
                    <span className="font-mono text-[13px] text-content-secondary font-semibold">{previewData.configPreview.model || "--"}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block">{t("import_archive_template_label")}</span>
                    <span className="font-semibold text-content-secondary block max-w-full truncate">
                      {previewData.configPreview.templateSlug || previewData.configPreview.templateId || t("import_archive_custom_workspace")}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-content-muted font-normal block">{t("import_archive_channel_label")}</span>
                    <span className="font-semibold text-content-secondary capitalize">{previewData.configPreview.channel || "--"}</span>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <span className="text-[11px] text-content-muted font-normal block mb-1">{t("import_archive_business_config_label")}</span>
                    {previewData.businessConfigPreview.hasBusinessConfig ? (
                      <div className="flex flex-wrap gap-1.5">
                        {previewData.businessConfigPreview.sections.map((sec) => (
                          <span
                            key={sec}
                            className="inline-block px-1.5 py-0.5 rounded-md bg-slate-200/50 border border-outline text-[9px] font-mono font-medium text-content-secondary"
                          >
                            {sec}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-content-muted text-[13px] font-normal italic">{t("import_archive_none_declared")}</span>
                    )}
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <span className="text-[11px] text-content-muted font-normal block mb-1">{t("import_archive_template_keys_label")}</span>
                    {previewData.templateInputsPreview.hasTemplateInputs ? (
                      <div className="flex flex-wrap gap-1.5">
                        {previewData.templateInputsPreview.keys.map((key) => (
                          <span
                            key={key}
                            className="inline-block px-1.5 py-0.5 rounded-md bg-indigo-50/50 border border-indigo-100 text-[9px] font-mono font-medium text-indigo-600"
                          >
                            {key}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-content-muted text-[13px] font-normal italic">{t("import_archive_none_declared")}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Clone Inputs Configuration */}
              <div className="bg-surface-muted border border-outline/60 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2.5 border-b border-outline/50">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span className="text-[13px] font-bold text-content">导入为新智能体实例</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
                  <div className="space-y-1.5">
                    <label className="text-[13px] text-content-muted font-bold block">新实例名称</label>
                    <input
                      type="text"
                      value={cloneName}
                      disabled={cloneLoading}
                      onChange={(e) => setCloneName(e.target.value)}
                      placeholder="例如: MyAgent-CLONE"
                      className="w-full px-3.5 py-2 rounded-xl border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-[13px] font-medium text-content-secondary transition-all placeholder:text-content-muted disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] text-content-muted font-bold block">新访问路径 (Slug)</label>
                    <input
                      type="text"
                      value={clonePath}
                      disabled={cloneLoading}
                      onChange={(e) => {
                        const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                        setClonePath(val);
                      }}
                      placeholder="placeholder: 例如: my-agent-clone"
                      className="w-full px-3.5 py-2 rounded-xl border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-[13px] font-mono text-content-secondary transition-all placeholder:text-content-muted disabled:opacity-60"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-content-muted font-normal leading-normal">
                  提示：备份包中隐藏了所有敏感 API 密钥和账号密码。克隆创建出的新实例状态设为 <span className="font-semibold text-content-muted">“未启动（待补配置）”</span>，您需要手动进入新实例的“设置”中重新补齐配置。
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50/50 border border-red-100 rounded-xl text-[13px] text-red-600 font-medium leading-relaxed flex items-start gap-2.5 animate-in fade-in duration-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <span>{error}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-outline shrink-0">
                <Button 
                  variant="ghost" 
                  onClick={resetState} 
                  disabled={cloneLoading} 
                  className="text-content-muted hover:text-content-secondary h-10 text-[13px]"
                >
                  {t("import_archive_reset")}
                </Button>
                <div className="flex gap-3">
                  <Button 
                    variant="outline" 
                    onClick={onClose} 
                    disabled={cloneLoading} 
                    className="rounded-xl h-10 text-[13px] text-content-muted hover:text-content-secondary"
                  >
                    {t("import_archive_cancel")}
                  </Button>
                  <Button
                    onClick={handleCloneSubmit}
                    disabled={cloneLoading || !cloneName.trim() || !clonePath.trim()}
                    className="rounded-xl h-10 px-6 font-bold shadow-md bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] disabled:opacity-50"
                  >
                    {cloneLoading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        正在克隆导入...
                      </span>
                    ) : (
                      "立即克隆导入"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

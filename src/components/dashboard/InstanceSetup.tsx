import { getAuthToken } from "../../lib/auth";
import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Briefcase, Bell, Settings, LayoutDashboard, Globe, MessageSquare, FileText, Users, PenTool, CheckCircle2 } from "lucide-react";
import { Button, Card } from "../ui";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../FeedbackProvider";
import { resolveSchema, SetupSchema, SetupSection, SetupField } from "./instance-setup-schema";

interface BusinessConfig {
  shopUrl?: string;
  monitorSkus?: string;
  delayThreshold?: string;
  refundAlert?: boolean;
  notifyChannels?: string;
  [key: string]: any;
}

const getIconComponent = (iconName: string) => {
  switch (iconName) {
    case "Settings": return <Settings className="w-4 h-4" />;
    case "Globe": return <Globe className="w-4 h-4" />;
    case "Bell": return <Bell className="w-4 h-4" />;
    case "MessageSquare": return <MessageSquare className="w-4 h-4" />;
    case "FileText": return <FileText className="w-4 h-4" />;
    case "Users": return <Users className="w-4 h-4" />;
    case "PenTool": return <PenTool className="w-4 h-4" />;
    default: return <Settings className="w-4 h-4" />;
  }
};

export function InstanceSetup() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawSection = searchParams.get("section");
  const { t } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<BusinessConfig>({});
  const [instance, setInstance] = useState<any>(null);

  useEffect(() => {
    if (!id) return;
    const fetchConfig = async () => {
      try {
        setLoading(true);
        const token = getAuthToken();
        const headers: Record<string, string> = {};
        if (token && token !== "null" && token !== "undefined") {
          headers["Authorization"] = `Bearer ${token}`;
        }
        // Fetch instance basic info
        const instRes = await fetch(`/api/instances`, {
          headers
        });
        if (instRes.ok) {
          const instances = await instRes.json();
          const current = instances.find((i: any) => i.id === id);
          if (current) setInstance(current);
        }

        // Fetch business config
        const res = await fetch(`/api/instances/${id}/business-config`, {
          headers
        });
        if (res.ok) {
          const data = await res.json();
          setConfig(data.businessConfig || {});
        }
      } catch (err) {
        console.error("Failed to fetch business config", err);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [id]);

  const schema = useMemo(() => {
    const resolvedTemplateKey = 
      instance?.blueprint_slug ||
      instance?.blueprint_id ||
      instance?.metadata?.blueprint_slug ||
      instance?.metadata?.blueprint_id ||
      instance?.configSummary?.blueprintSlug ||
      instance?.configSummary?.blueprintId ||
      instance?.template_slug || 
      instance?.template_id || 
      instance?.metadata?.template_slug || 
      instance?.metadata?.template_id || 
      instance?.configSummary?.templateSlug || 
      instance?.configSummary?.templateName;
      
    return resolveSchema(resolvedTemplateKey);
  }, [instance]);

  const activeSectionId = useMemo(() => {
    if (rawSection && schema.sections.some(s => s.id === rawSection)) {
      return rawSection;
    }
    return schema.sections[0]?.id || "general";
  }, [rawSection, schema]);

  const activeSection = schema.sections.find(s => s.id === activeSectionId);

  // Compute progress
  const progress = useMemo(() => {
    const requiredFields = schema.sections.flatMap(s => s.fields).filter(f => f.required);
    if (requiredFields.length === 0) {
      return { total: 0, done: 0, missing: [] };
    }
    const done = requiredFields.filter(f => {
      const val = config[f.id];
      return val !== undefined && val !== null && val !== "";
    });
    const missing = requiredFields.filter(f => {
      const val = config[f.id];
      return val === undefined || val === null || val === "";
    });
    return {
      total: requiredFields.length,
      done: done.length,
      missing
    };
  }, [schema, config]);

  const handleSave = async () => {
    // Validation
    if (progress.missing.length > 0) {
      const fieldNames = progress.missing.map(f => t(f.labelKey)).join(", ");
      showAlert({
        title: "验证失败",
        message: t("setup_validation_error", { fields: fieldNames }) || `请填写以下必填项: ${fieldNames}`,
        type: "warning"
      });
      return;
    }

    try {
      setSaving(true);
      const token = getAuthToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/instances/${id}/business-config`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ businessConfig: config })
      });
      if (res.ok) {
        showToast("业务配置已保存", "success");
      } else {
        throw new Error("Failed to save");
      }
    } catch (err: any) {
      console.error(err);
      showAlert({
        title: "保存失败",
        message: "未能保存您的业务配置。",
        type: "error",
        details: err.message || t("setup_save_error")
      });
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 lg:p-8 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-content-muted font-medium">{t("setup_loading")}</p>
        </div>
      </div>
    );
  }

  const renderField = (field: SetupField) => {
    const val = config[field.id];
    
    if (field.type === "checkbox") {
      return (
        <div key={field.id} className="flex items-center justify-between p-4 bg-surface-muted rounded-lg border border-outline">
          <div className="space-y-1 pr-4">
            <span className="text-sm font-semibold text-content-secondary block">
              {t(field.labelKey)} {field.required && <span className="text-red-500">*</span>}
            </span>
            {field.descKey && <span className="text-[13px] text-content-muted block">{t(field.descKey)}</span>}
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={!!val}
              onChange={(e) => updateConfig(field.id, e.target.checked)}
            />
            <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      );
    }

    return (
      <div key={field.id} className="space-y-2">
        <label className="text-sm font-semibold text-content-secondary">
          {t(field.labelKey)} {field.required && <span className="text-red-500">*</span>}
        </label>
        {field.type === "textarea" ? (
          <textarea
            value={val || ""}
            onChange={(e) => updateConfig(field.id, e.target.value)}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : ""}
            className="w-full h-24 px-3 py-2 rounded-lg border border-outline bg-surface text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-sm resize-none"
          />
        ) : (
          <input
            type={field.type === "number" ? "number" : "text"}
            value={val || ""}
            onChange={(e) => updateConfig(field.id, e.target.value)}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : ""}
            className="w-full h-10 px-3 rounded-lg border border-outline bg-surface text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors text-sm"
          />
        )}
      </div>
    );
  };

  const renderSection = () => {
    if (!activeSection) {
      return null;
    }

    return (
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-bold text-content mb-1">{t(activeSection.titleKey)}</h3>
          <p className="text-sm text-content-muted">{t(activeSection.descKey)}</p>
        </div>
        
        {activeSection.fields.length > 0 ? (
          <div className="space-y-4">
            {activeSection.fields.map(renderField)}
          </div>
        ) : (
          <div className="p-4 bg-surface-muted rounded-lg border border-outline text-sm text-content-muted text-center">
            {t("setup_general_empty")}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-surface-muted/50">
      <div className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 p-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/app/instances")} className="shrink-0 rounded-xl hover:bg-control-hover dark:text-slate-200">
            <ArrowLeft className="w-5 h-5 text-content-secondary" />
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-content flex items-center gap-2">
              <span>{t("setup_page_title")}</span>
            </h1>
            <p className="text-[13px] text-content-muted font-medium">
              {t("setup_page_subtitle", { name: instance?.name || t("setup_unknown_instance"), id: id?.substring(0, 8) })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {progress.total > 0 && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-content-muted font-medium">{t("setup_progress")}:</span>
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 px-3 py-1 rounded-full border border-outline">
                {progress.done === progress.total ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-outline-strong border-t-indigo-500 animate-spin" />
                )}
                <span className={`font-semibold ${progress.done === progress.total ? "text-emerald-700 dark:text-emerald-400" : "text-content-secondary"}`}>
                  {t("setup_progress_done", { done: progress.done, total: progress.total })}
                </span>
              </div>
            </div>
          )}
          <Button 
            onClick={handleSave} 
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm transition-all"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {saving ? t("setup_saving") : t("setup_save")}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
        {progress.total > 0 && progress.missing.length > 0 && (
          <div className="mb-6 p-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl flex items-start sm:items-center gap-3">
            <div className="mt-0.5 sm:mt-0 p-1.5 bg-indigo-100 dark:bg-indigo-900/50 rounded-full shrink-0">
              <Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">{t("setup_progress_missing")}</h4>
              <p className="text-[13px] text-indigo-700 dark:text-indigo-300 mt-0.5">
                {progress.missing.map(f => t(f.labelKey)).join(", ")}
              </p>
            </div>
          </div>
        )}
        {progress.total === 0 && (
          <div className="mb-6 p-4 bg-surface-muted border border-outline rounded-xl text-center">
            <p className="text-sm text-content-muted">{t("setup_progress_not_required")}</p>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6 lg:gap-8">
          <div className="md:w-64 shrink-0">
            <nav className="flex flex-col gap-1 sticky top-28">
              {schema.sections.map((sec) => {
                const isActive = activeSectionId === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => navigate(`/app/instances/${id}/setup?section=${sec.id}`)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" 
                        : "text-content-secondary hover:bg-slate-100 dark:hover:bg-slate-900/60 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    {getIconComponent(sec.iconName)}
                    {/* Convert sec.id back to a localized nav title if possible, or use titleKey as a fallback, but we should use a shorter nav name if we have one. We can just use the short nav keys if they exist */}
                    {t(`setup_nav_${sec.id.replace(/-/g, '_')}`, { defaultValue: t(sec.titleKey) })}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex-1 min-w-0">
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
}


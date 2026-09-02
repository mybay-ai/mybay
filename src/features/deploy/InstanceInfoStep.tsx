import { Shield, Eye, EyeOff, Sparkles, Bot, Blocks, Zap, Clock, Code, Mail, FileText, ShoppingCart, HelpCircle, RefreshCw, Layers, CheckCircle, Upload, Paperclip, Trash2, AlertCircle, Compass } from "lucide-react";
import { Label, Input, Button } from "../../components/ui";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import type { RuntimeDefinition } from "../../../shared/runtimeCatalog";
import { fetchRuntimeCatalog } from "./runtimeCatalogClient";

interface InstanceInfoStepProps {
  data: any;
  update: (k: string, v: any) => void;
  updateTemplateInput: (fieldKey: string, value: any) => void;
  applyTemplate?: (template: any) => void;
  currentUser?: any;
  activeBlueprint?: any;
  onClearTemplate?: () => void;
}

const resolveTemplateInputKey = (input: any, index: number): string => {
  const fieldKey = input.key || input.name || input.id;
  if (!fieldKey || typeof fieldKey !== "string") {
    console.warn(`[TemplateInput] Missing stable field key for input at index ${index}, falling back to index`);
    return `field_index_${index}`;
  }
  return fieldKey;
};

// Map template IDs or tag groups to distinct visual theme icons
function getTemplateIcon(tags: string[] = [], useCase: string = "") {
  const norm = (useCase + tags.join(" ")).toLowerCase();
  if (norm.includes("新闻") || norm.includes("news")) return <Mail className="w-5 h-5 text-amber-600" />;
  if (norm.includes("价格") || norm.includes("price") || norm.includes("监控")) return <ShoppingCart className="w-5 h-5 text-emerald-600" />;
  if (norm.includes("工作流") || norm.includes("总结") || norm.includes("feishu") || norm.includes("飞书")) return <Layers className="w-5 h-5 text-blue-600" />;
  if (norm.includes("pdf") || norm.includes("文件") || norm.includes("doc")) return <FileText className="w-5 h-5 text-rose-600" />;
  if (norm.includes("小红书") || norm.includes("选题") || norm.includes("短视频")) return <Zap className="w-5 h-5 text-purple-600" />;
  return <Bot className="w-5 h-5 text-content-secondary" />;
}

export function InstanceInfoStep({ data, update, updateTemplateInput, applyTemplate, currentUser, activeBlueprint, onClearTemplate }: InstanceInfoStepProps) {
  const { t, i18n } = useTranslation("deploy");
  const [showPassword, setShowPassword] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [jsonErrors, setJsonErrors] = useState<{ [key: string]: string }>({});
  const [runtimeDefinitions, setRuntimeDefinitions] = useState<RuntimeDefinition[]>([]);
  const [runtimeCatalogState, setRuntimeCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const isDashboardAccessEnabled = data.enableDashboard !== false;

  const handleDashboardAccessChange = (enabled: boolean) => {
    update("enableDashboard", enabled);
    if (!enabled) {
      update("username", "");
      update("password", "");
      return;
    }
    if (!data.username) {
      update("username", "admin");
    }
  };

  // Load active templates from database
  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const locale = encodeURIComponent(i18n.resolvedLanguage || i18n.language || "zh-CN");
      const list = await api.get(`/api/templates?lang=${locale}`);
      setTemplates(list || []);
    } catch (err: any) {
      console.error("Templates preloader error:", err);
      if (err.status === 401) {
        setError(t("load_errors.err_401"));
      } else if (err.status === 403) {
        setError(t("load_errors.err_403"));
      } else if (err.status === 404) {
        setError(t("load_errors.err_404"));
      } else if (err.status >= 500) {
        setError(t("load_errors.err_500"));
      } else if (err.message && err.message.includes("Failed to fetch")) {
        setError(t("load_errors.err_network"));
      } else {
        setError(err.message || t("load_errors.err_fallback"));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!applyTemplate) {
      setLoading(false);
      setTemplates([]);
      return;
    }
      loadTemplates();
    if (currentUser?.token || !loading) {
    }
  }, [applyTemplate, currentUser?.token, i18n.resolvedLanguage]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRuntimeCatalogState("loading");
    fetchRuntimeCatalog(controller.signal)
      .then((catalog) => {
        if (!active) return;
        setRuntimeDefinitions(catalog.runtimes);
        setRuntimeCatalogState("ready");
      })
      .catch((catalogError: any) => {
        if (!active || catalogError?.name === "AbortError") return;
        console.error("Runtime catalog loader error:", catalogError);
        setRuntimeDefinitions([]);
        setRuntimeCatalogState("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentUser?.token]);

  const selectedTemplate = templates.find(tmpl => tmpl.id === data.template_id);



  useEffect(() => {
    if (!selectedTemplate || !selectedTemplate.required_inputs) {
      if (data.template_inputs_error) {
        update("template_inputs_error", null);
      }
      return;
    }

    let firstErrorMsg: string | null = null;
    const errorsMap: { [key: string]: string } = {};

    selectedTemplate.required_inputs.forEach((input: any, index: number) => {
      const fieldKey = resolveTemplateInputKey(input, index);
      const val = data.template_inputs?.[fieldKey];
      const isBoolean = input.type === "boolean";

      let stringVal = "";
      if (typeof val === "string") {
        stringVal = val;
      } else if (val && typeof val === "object" && val.fileId) {
        stringVal = val.fileId;
      }

      if (input.type === "json") {
        if (stringVal.trim()) {
          try {
            JSON.parse(stringVal);
          } catch (err: any) {
            const msg = t("validation_errors.json_format_err", { message: err.message });
            errorsMap[fieldKey] = msg;
            if (!firstErrorMsg) {
              firstErrorMsg = t("validation_errors.json_item_format_err", { label: input.label, message: err.message });
            }
          }
        } else if (input.required) {
          errorsMap[fieldKey] = t("validation_errors.json_required_and_valid");
          if (!firstErrorMsg) {
            firstErrorMsg = t("validation_errors.template_input_required", { label: input.label });
          }
        }
      } else if (input.required) {
        if (input.type === "file") {
          const fileVal = data.template_inputs?.[fieldKey];
          if (!fileVal || (typeof fileVal === "object" && !fileVal.fileId)) {
            errorsMap[fieldKey] = t("validation_errors.file_upload_required");
            if (!firstErrorMsg) {
              firstErrorMsg = t("validation_errors.file_item_upload_required", { label: input.label });
            }
          }
        } else if (!isBoolean && !stringVal.trim()) {
          errorsMap[fieldKey] = t("validation_errors.field_required");
          if (!firstErrorMsg) {
            firstErrorMsg = t("validation_errors.template_input_required", { label: input.label });
          }
        }
      }
    });

    if (data.template_inputs_error !== firstErrorMsg) {
      update("template_inputs_error", firstErrorMsg);
    }
    setJsonErrors(errorsMap);
  }, [selectedTemplate, data.template_inputs, data.template_inputs_error, update]);

  const handleSelectTemplate = (t: any) => {
    if (applyTemplate) {
      applyTemplate(t);
    }
  };

  const handleClearTemplate = () => {
    if (onClearTemplate) {
      onClearTemplate();
    } else {
      update("template_id", null);
      update("template_slug", null);
      update("template_inputs", {});
    }
  };

  const [uploadStates, setUploadStates] = useState<{
    [key: string]: {
      status: 'idle' | 'uploading' | 'success' | 'error';
      fileName?: string;
      fileSize?: string;
      errorMsg?: string | null;
      progress?: number;
    }
  }>({});

  const uploadFile = async (file: File, inputKey: string) => {
    // 1. Client-side validates extension and file type
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadStates(prev => ({
        ...prev,
        [inputKey]: { status: 'error', errorMsg: t("template_selection.upload_unsupported") }
      }));
      return;
    }

    // 2. Client-side validates file size threshold: reads dynamic limit from template required_inputs if available
    const matchingInput = selectedTemplate?.required_inputs?.find((input: any, index: number) => {
      return resolveTemplateInputKey(input, index) === inputKey;
    });
    const maxSizeMb = matchingInput?.maxSizeMb || 100;
    const maxSize = maxSizeMb * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadStates(prev => ({
        ...prev,
        [inputKey]: { status: 'error', errorMsg: t("template_selection.upload_size_limit", { currentSize: (file.size / (1024 * 1024)).toFixed(1), maxSize: maxSizeMb }) }
      }));
      return;
    }

    const formattedSize = file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${(file.size / 1024).toFixed(0)} KB`;

    setUploadStates(prev => ({
      ...prev,
      [inputKey]: { status: 'uploading', fileName: file.name, fileSize: formattedSize, progress: 10 }
    }));

    try {
      const formData = new FormData();
      formData.append("file", file);

      const targetId = data.id;
      if (!targetId) {
        throw new Error(t("template_selection.deploy_id_missing"));
      }

      // Use the new template-files upload endpoint that doesn't require instance existence
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/instances/template-files/upload`);
      const token = currentUser?.token;
      if (token && token !== "null" && token !== "undefined") {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentage = Math.round((event.loaded / event.total) * 100);
          setUploadStates(prev => ({
            ...prev,
            [inputKey]: { ...prev[inputKey], status: 'uploading', progress: percentage }
          }));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.fileId) {
              setUploadStates(prev => ({
                ...prev,
                [inputKey]: { status: 'success', fileName: response.filename || file.name, fileSize: formattedSize }
              }));
              // Save the full file descriptor object as the template input value
              updateTemplateInput(inputKey, response);
            } else {
              setUploadStates(prev => ({
                ...prev,
                [inputKey]: { status: 'error', errorMsg: response.error || t("template_selection.upload_err_server_dump") }
              }));
            }
          } catch (e) {
            setUploadStates(prev => ({
              ...prev,
              [inputKey]: { status: 'error', errorMsg: t("template_selection.upload_err_invalid_json") }
            }));
          }
        } else {
          try {
            const resp = JSON.parse(xhr.responseText);
            setUploadStates(prev => ({
              ...prev,
              [inputKey]: { status: 'error', errorMsg: resp.error || t("template_selection.upload_err_status_code", { status: xhr.status }) }
            }));
          } catch (e) {
            setUploadStates(prev => ({
              ...prev,
              [inputKey]: { status: 'error', errorMsg: t("template_selection.upload_err_disconnect", { status: xhr.status }) }
            }));
          }
        }
      };

      xhr.onerror = () => {
        setUploadStates(prev => ({
          ...prev,
          [inputKey]: { status: 'error', errorMsg: t("template_selection.upload_err_network_interrupted") }
        }));
      };

      xhr.send(formData);

    } catch (e: any) {
      setUploadStates(prev => ({
        ...prev,
        [inputKey]: { status: 'error', errorMsg: e.message || t("template_selection.upload_err_aborted") }
      }));
    }
  };

  const removeFile = async (inputKey: string) => {
    const val = data.template_inputs?.[inputKey];
    const fileId = val && typeof val === 'object' ? val.fileId : null;

    if (fileId) {
      setUploadStates(prev => ({
        ...prev,
        [inputKey]: { status: 'uploading', fileName: val.filename, progress: 50 }
      }));

      try {
        await api.delete(`/api/instances/template-files/${fileId}`);
      } catch (e: any) {
        console.error("[removeFile Error]", e);
        setUploadStates(prev => ({
          ...prev,
          [inputKey]: { status: 'error', errorMsg: t("template_selection.remove_file_fail", { message: e.message }) }
        }));
        return;
      }
    }

    setUploadStates(prev => ({
      ...prev,
      [inputKey]: { status: 'idle' }
    }));
    updateTemplateInput(inputKey, "");
  };

  const hasTemplateOrBlueprint = !!selectedTemplate || !!activeBlueprint;

  const renderRequiredInputs = () => {
    if (!selectedTemplate || !selectedTemplate.required_inputs) return null;
    const seenKeys = new Set<string>();
    return selectedTemplate.required_inputs.map((input: any, index: number) => {
      let fieldKey = resolveTemplateInputKey(input, index);
      if (seenKeys.has(fieldKey)) {
        fieldKey = `${fieldKey}_${index}`;
      }
      seenKeys.add(fieldKey);

      const currentValue = data.template_inputs?.[fieldKey];
      const isSelect = input.type === "select";
      const isBoolean = input.type === "boolean";

      let val: any;
      if (isBoolean) {
        val = typeof currentValue === "boolean"
          ? currentValue
          : (input.defaultValue === true || input.default_value === true);
      } else if (isSelect) {
        val = typeof currentValue === "string"
          ? currentValue
          : (input.defaultValue ?? input.default_value ?? (input.options?.[0]?.value || ""));
      } else {
        val = typeof currentValue === "string"
          ? currentValue
          : "";
      }

      return (
        <div key={fieldKey || input.label} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[11.5px] font-black text-content-secondary flex items-center gap-1">
              <span>{input.label}</span>
              {input.required && <span className="text-rose-500 font-bold">*</span>}
            </Label>
          </div>
          {input.description && (
            <p className="text-[10.5px] text-content-muted font-medium leading-tight">
              {input.description}
            </p>
          )}

          {input.type === "file" ? (
            <div className="space-y-2">
              {(() => {
                const uState: any = uploadStates[fieldKey] || {
                  status: val ? 'success' : 'idle',
                  fileName: val ? (typeof val === 'string' ? val.split('/').pop() : val.filename) : '',
                  fileSize: val && typeof val === 'object' && val.size ? `${(val.size / (1024 * 1024)).toFixed(1)} MB` : '',
                  errorMsg: '',
                  progress: 0
                };

                if (uState.status === 'idle') {
                  return (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const files = e.dataTransfer.files;
                        if (files && files.length > 0) {
                          uploadFile(files[0], fieldKey);
                        }
                      }}
                      onClick={() => {
                        const fileInput = document.getElementById(`file-input-${fieldKey}`);
                        fileInput?.click();
                      }}
                      className="border-2 border-dashed border-outline hover:border-indigo-400 bg-surface-muted/55 hover:bg-indigo-50/5 p-6 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition duration-200 group min-h-[120px]"
                    >
                      <input
                        id={`file-input-${fieldKey}`}
                        type="file"
                        accept={input.accept || "application/pdf"}
                        className="hidden"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (files && files.length > 0) {
                            uploadFile(files[0], fieldKey);
                          }
                        }}
                      />
                      <Upload className="w-7 h-7 text-content-muted group-hover:text-indigo-500 mb-2 transition duration-200" />
                      <p className="text-[13px] font-bold text-content-secondary">
                        {t("template_selection.placeholder_file_click_drag")}
                      </p>
                      <p className="text-[11px] text-content-muted font-medium mt-1">
                        {t("template_selection.placeholder_file_limits", { maxSize: input.maxSizeMb || 100 })}
                      </p>
                    </div>
                  );
                } else if (uState.status === 'uploading') {
                  return (
                    <div className="border border-indigo-100 bg-indigo-50/10 p-4 rounded-2xl flex flex-col space-y-2">
                      <div className="flex items-center justify-between text-[13px] font-bold">
                        <span className="flex items-center gap-2 text-indigo-700">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                          <span>{t("template_selection.upload_progress")}</span>
                        </span>
                        <span className="text-indigo-600 font-black">{uState.progress || 0}%</span>
                      </div>
                      <div className="bg-surface-muted h-1.5 w-full rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-500 h-full rounded-full transition-all duration-150"
                          style={{ width: `${uState.progress || 0}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-content-muted font-medium truncate">
                        {t("template_selection.file_name_label", { name: uState.fileName, size: uState.fileSize })}
                      </p>
                    </div>
                  );
                } else if (uState.status === 'success') {
                  return (
                    <div className="border border-emerald-100 bg-emerald-50/10 p-3.5 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <span className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-5 h-5 text-emerald-600" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-content-secondary truncate">
                            {uState.fileName || (typeof val === 'string' ? val.split('/').pop() : val.filename)}
                          </p>
                          <p className="text-[11px] text-emerald-600 font-bold mt-0.5">
                            {t("template_selection.upload_success", { fileSize: uState.fileSize || t("template_selection.synced_100") })}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(fieldKey)}
                        className="p-1.5 rounded-lg text-content-muted hover:text-rose-600 hover:bg-rose-50 transition duration-155 shrink-0 cursor-pointer"
                        title={t("wizardCopy.instanceInfo.reupload")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                } else {
                  return (
                    <div className="border border-rose-100 bg-rose-50/10 p-4 rounded-2xl space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
                          <AlertCircle className="w-5 h-5 text-rose-600" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-content-secondary">{t("template_selection.upload_error")}</p>
                          <p className="text-[10.5px] text-rose-600 font-medium leading-normal mt-0.5 whitespace-pre-wrap">
                            {uState.errorMsg || t("template_selection.upload_default_error")}
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => removeFile(fieldKey)}
                          className="h-8 text-[13px] font-bold px-3 border-rose-200 text-rose-700 hover:bg-rose-50 rounded-lg shrink-0"
                        >
                          {t("template_selection.clear_and_retry")}
                        </Button>
                      </div>
                    </div>
                  );
                }
              })()}
            </div>
          ) : input.type === "json" ? (
            <div className="space-y-1">
              <textarea
                key={`json-${fieldKey}`}
                id={`template-field-${fieldKey}`}
                name={`template-field-${fieldKey}`}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={val}
                onChange={(e) => updateTemplateInput(fieldKey, e.target.value)}
                placeholder={input.placeholder || t("template_selection.placeholder_json")}
                className="w-full text-[13px] font-mono p-3 min-h-[140px] border border-outline bg-surface focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-xl leading-relaxed animate-in fade-in duration-100"
              />
              {jsonErrors[fieldKey] && (
                <p className="text-[10.5px] text-rose-500 font-bold flex items-center gap-1 mt-1 animate-in fade-in slide-in-from-top-1 duration-150">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{jsonErrors[fieldKey]}</span>
                </p>
              )}
            </div>
          ) : input.type === "textarea" ? (
            <textarea
              key={`textarea-${fieldKey}`}
              id={`template-field-${fieldKey}`}
              name={`template-field-${fieldKey}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={val}
              onChange={(e) => updateTemplateInput(fieldKey, e.target.value)}
              placeholder={input.placeholder || t("template_selection.placeholder_textarea")}
              className="w-full text-[13px] font-medium content-box p-3 min-h-[70px] border border-outline bg-surface focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-xl animate-in fade-in duration-100"
            />
          ) : input.type === "select" ? (
            <select
              key={`select-${fieldKey}`}
              id={`template-select-${fieldKey}`}
              name={`template-select-${fieldKey}`}
              autoComplete="off"
              value={val}
              onChange={(e) => updateTemplateInput(fieldKey, e.target.value)}
              className="w-full text-[13px] font-medium h-10 px-3 border border-outline bg-surface focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-xl cursor-pointer"
            >
              {(input.options || []).map((opt: any) => {
                const oKey = typeof opt === "string" ? opt : opt.value;
                const oVal = typeof opt === "string" ? opt : opt.label;
                return (
                  <option key={oKey} value={oKey}>{oVal}</option>
                );
              })}
            </select>
          ) : input.type === "url_list" ? (
            <textarea
              key={`url_list-${fieldKey}`}
              id={`template-field-${fieldKey}`}
              name={`template-field-${fieldKey}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={val}
              onChange={(e) => updateTemplateInput(fieldKey, e.target.value)}
              placeholder={input.placeholder || t("template_selection.placeholder_url")}
              className="w-full text-[13px] font-mono p-3 min-h-[75px] border border-outline bg-surface focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-xl animate-in fade-in duration-100"
            />
          ) : input.type === "boolean" ? (
            <div className="flex items-center gap-2 py-1">
              <input
                key={`boolean-${fieldKey}`}
                id={`template-field-${fieldKey}`}
                name={`template-field-${fieldKey}`}
                autoComplete="off"
                type="checkbox"
                checked={!!val}
                onChange={(e) => updateTemplateInput(fieldKey, e.target.checked)}
                className="w-4 h-4 text-indigo-600 border-outline focus:ring-indigo-500 rounded-md cursor-pointer"
              />
              <Label htmlFor={`template-field-${fieldKey}`} className="text-[13px] font-medium text-content-secondary cursor-pointer">
                {input.placeholder || t("template_selection.placeholder_boolean")}
              </Label>
            </div>
          ) : (
            <Input
              key={`input-${fieldKey}`}
              id={`template-field-${fieldKey}`}
              name={`template-field-${fieldKey}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              type={input.type === "number" ? "number" : input.type === "time" ? "time" : "text"}
              value={val}
              onChange={(e: any) => updateTemplateInput(fieldKey, e.target.value)}
              placeholder={input.placeholder || t("template_selection.placeholder_input")}
              className="h-10 border-outline focus:ring-indigo-500 rounded-xl bg-surface font-medium text-[13px] animate-in fade-in duration-100"
            />
          )}
        </div>
      );
    });
  };

  const renderPlatformFields = () => {
    return (
      <div className="space-y-4">
        {/* Agent Runtime Archetype Selection */}
        <div className="space-y-2.5 border-b border-outline pb-4">
          <div className="flex items-center justify-between">
            <Label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-blue-600" />
              <span>{t("wizardCopy.instanceInfo.runtimeType")}</span>
            </Label>
            {runtimeCatalogState === "ready" && (
              <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-800/60">
                {runtimeDefinitions.find((runtime) => runtime.runtime.type === (data.runtime_type || "hermes"))?.displayName || t("wizardCopy.instanceInfo.runtimeUnavailable")}
              </span>
            )}
          </div>
          {runtimeCatalogState === "loading" && (
            <div className="rounded-xl border border-outline bg-surface-muted px-3 py-4 text-xs text-content-muted">
              {t("wizardCopy.instanceInfo.runtimeLoading")}
            </div>
          )}
          {runtimeCatalogState === "error" && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("wizardCopy.instanceInfo.runtimeLoadError")}</span>
            </div>
          )}
          {runtimeCatalogState === "ready" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {runtimeDefinitions.map((definition) => {
                const runtimeType = definition.runtime.type;
                const selected = (data.runtime_type || "hermes") === runtimeType;
                const deployable = definition.release.deploymentSupported;
                const isPi = runtimeType === "pi";
                const description = runtimeType === "hermes"
                  ? t("wizardCopy.instanceInfo.hermesDescription")
                  : runtimeType === "pi"
                    ? t("wizardCopy.instanceInfo.piDescription")
                    : definition.description;
                const badge = runtimeType === "hermes"
                  ? t("wizardCopy.instanceInfo.hermesBadge")
                  : runtimeType === "pi"
                    ? t("wizardCopy.instanceInfo.piBadge")
                    : definition.release.certificationLevel;
                return (
                  <button
                    key={runtimeType}
                    type="button"
                    disabled={!deployable}
                    aria-disabled={!deployable}
                    title={description}
                    onClick={() => {
                      if (!deployable) return;
                      update("runtime_type", runtimeType);
                      update("image", definition.runtime.image);
                      update("imageTag", definition.runtime.tag);
                    }}
                    className={`p-3.5 rounded-xl border text-left transition-all relative ${
                      !deployable
                        ? "border-outline bg-surface-muted opacity-70 cursor-not-allowed"
                        : selected
                          ? "border-blue-500 dark:border-blue-400 bg-blue-50/40 dark:bg-blue-950/40 ring-2 ring-blue-500/20 shadow-sm cursor-pointer"
                          : "border-outline bg-surface hover:border-outline-strong hover:bg-surface-muted/50 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${isPi ? "bg-purple-100/80 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300" : "bg-blue-100/80 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300"}`}>
                          {isPi ? <Zap className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                        </div>
                        <div>
                          <span className="font-bold text-content text-[13px] block">{definition.displayName}</span>
                          <span className={`text-[10px] font-semibold ${isPi ? "text-purple-600 dark:text-purple-300" : "text-blue-600 dark:text-blue-300"}`}>{badge}</span>
                        </div>
                      </div>
                      {selected && deployable && <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />}
                    </div>
                    <p className="text-[11.5px] text-content-muted leading-relaxed">{description}</p>
                    <div className="mt-2 text-[10px] font-mono text-content-muted bg-surface-muted px-2 py-0.5 rounded inline-block border border-outline/60">
                      {deployable
                        ? `Port: ${definition.runtime.internalPort} | ${definition.runtime.image}`
                        : t("wizardCopy.instanceInfo.runtimeSpecOnly")}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-b border-outline pb-2">
          <h4 className="text-sm font-black text-content flex items-center gap-2 tracking-tight">
            <Shield className="w-4 h-4 text-indigo-650" />
            <span>{t("template_selection.basic_protection_title")}</span>
          </h4>
          <p className="text-[13px] font-medium text-content-muted mt-0.5">
            {t("template_selection.basic_protection_desc")}
          </p>
        </div>

        {/* Hidden autofill traps to absorb credentials manager auto-fill before real inputs */}
        <input
          type="text"
          name="fake-username-trap"
          autoComplete="username"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', top: '-1000px', left: '-1000px', width: '1px', height: '1px', opacity: 0.01, overflow: 'hidden' }}
        />
        <input
          type="password"
          name="fake-password-trap"
          autoComplete="new-password"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', top: '-1000px', left: '-1000px', width: '1px', height: '1px', opacity: 0.01, overflow: 'hidden' }}
        />

        <label className="flex items-start gap-3 rounded-xl border border-outline bg-surface-muted/30 p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={isDashboardAccessEnabled}
            onChange={(e) => handleDashboardAccessChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-outline text-blue-600 focus:ring-blue-500"
          />
          <span className="space-y-1">
            <span className="block text-[13px] font-bold text-content">{t("template_selection.enable_dashboard_label")}</span>
            <span className="block text-[11px] leading-relaxed text-content-muted">{t("template_selection.enable_dashboard_desc")}</span>
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">
              {t("template_selection.instance_alias")}
            </Label>
            <Input
              id="mybay-instance-display-name"
              name="mybay-instance-display-name"
              autoComplete="off"
              placeholder={t("template_selection.placeholder_instance_alias")}
              value={data.name || ""}
              onChange={(e: any) => update("name", e.target.value)}
              className="h-10 border-outline focus:ring-blue-500 rounded-xl bg-surface-muted/30 font-medium text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
             <Label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">
               {t("template_selection.assigned_path")}
             </Label>
            <Input
              id="mybay-instance-assigned-path"
              name="mybay-instance-assigned-path"
              value={data.path || ""}
              disabled
              className="h-10 bg-surface-muted text-content-muted font-mono text-[13px] cursor-not-allowed border-outline rounded-xl"
            />
          </div>

          {isDashboardAccessEnabled && (
            <>
          <div className="space-y-1.5">
            <Label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">
              {t("template_selection.access_username")}
            </Label>
            <Input
              id={`mybay-deploy-access-username-${data.id || "new"}`}
              name={`mybay-deploy-access-username-${data.id || "new"}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder="admin"
              value={data.username || ""}
              onChange={(e: any) => update("username", e.target.value)}
              className="h-10 border-outline focus:ring-blue-500 rounded-xl bg-surface-muted/30 font-medium text-[13px]"
            />
          </div>

          <div className="space-y-1.5 relative">
            <Label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">
              {t("template_selection.access_password")}
            </Label>
            <div className="relative">
              <Input
                id={`mybay-deploy-access-password-${data.id || "new"}`}
                name={`mybay-deploy-access-password-${data.id || "new"}`}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                type={showPassword ? "text" : "password"}
                placeholder={t("template_selection.placeholder_instance_password")}
                value={data.password || ""}
                onChange={(e: any) => update("password", e.target.value)}
                className="h-10 border-outline focus:ring-blue-500 rounded-xl bg-surface-muted/30 pr-10 font-medium text-[13px]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-content-muted hover:text-content-secondary focus:outline-none cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
            </>
          )}
        </div>

        <div className="p-3 bg-surface-muted border border-outline/60 text-content-secondary rounded-xl text-[10.5px] leading-relaxed shadow-sm flex gap-2">
          <Shield className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="font-medium">
            {isDashboardAccessEnabled
              ? t("template_selection.protection_warning", { path: data.path })
              : t("template_selection.dashboard_access_disabled_notice")}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">

      {hasTemplateOrBlueprint ? (
        // Template/Blueprint mode (three-tiered business-centric layout)
        <div className="space-y-6">
          {/* Header Row */}
          <div className="flex items-center justify-between pb-3 border-b border-outline">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-indigo-700 bg-indigo-100/70 px-2.5 py-1 rounded-md border border-indigo-200/40 uppercase tracking-wide">
                {selectedTemplate ? t("template_selection.workflow_preset_badge") : t("template_selection.blueprint_preset_badge")}
              </span>
              <span className="text-[13px] font-bold text-content-secondary">
                {selectedTemplate ? selectedTemplate.name : activeBlueprint.name}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearTemplate}
              className="text-[13px] text-blue-600 hover:text-blue-850 font-bold flex items-center gap-1 hover:underline cursor-pointer bg-transparent border-0"
            >
              {selectedTemplate ? t("template_selection.reselect_workflow") : t("template_selection.reselect_blueprint")}
            </button>
          </div>

          {/* Business specifications */}
          <div className="p-5 border border-indigo-100 bg-indigo-50/10 rounded-2xl space-y-4 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center shrink-0 shadow-sm border border-indigo-100">
                {selectedTemplate ? (
                  getTemplateIcon(selectedTemplate.tags, selectedTemplate.use_case)
                ) : (
                  <Compass className="w-6 h-6 text-indigo-650" />
                )}
              </div>
              <div className="space-y-1">
                <h4 className="font-black text-content text-sm sm:text-base flex items-center gap-2">
                  {selectedTemplate ? t("template_selection.workflow_business_title") : t("template_selection.blueprint_business_title")}
                </h4>
                <p className="text-[13px] text-content-muted font-medium leading-relaxed">
                  {selectedTemplate ? (selectedTemplate.description || selectedTemplate.use_case) : (activeBlueprint.description || activeBlueprint.use_case)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-outline/80 pt-4 text-[13px]">
              <div className="space-y-1 text-left">
                <span className="text-content-muted font-bold uppercase tracking-wider">{t("business_summary_card.audience_label")}</span>
                <p className="text-content-secondary font-medium bg-surface p-2.5 rounded-xl border border-outline leading-normal">
                  {selectedTemplate ? (selectedTemplate.target_audience || t("business_summary_card.target_audience_default")) : (activeBlueprint.target_audience || t("business_summary_card.target_audience_default"))}
                </p>
              </div>
              <div className="space-y-1 text-left">
                <span className="text-content-muted font-bold uppercase tracking-wider">{t("business_summary_card.business_value_label")}</span>
                <p className="text-content-secondary font-medium bg-surface p-2.5 rounded-xl border border-outline leading-normal">
                  {selectedTemplate ? (selectedTemplate.automation_result || selectedTemplate.business_value || t("business_summary_card.business_value_default")) : (activeBlueprint.business_value || t("business_summary_card.business_value_default"))}
                </p>
              </div>
              <div className="space-y-1 text-left">
                <span className="text-content-muted font-bold uppercase tracking-wider">{t("business_summary_card.channels_label")}</span>
                <p className="text-content-secondary font-medium bg-surface p-2.5 rounded-xl border border-outline leading-normal">
                  {(() => {
                    const rawVal = selectedTemplate ? selectedTemplate.default_channel : (Array.isArray(activeBlueprint.recommended_channels) ? activeBlueprint.recommended_channels[0] : activeBlueprint.recommended_channels);
                    const channelVal = rawVal || "web";
                    if (channelVal === "telegram") return t("business_summary_card.channel_telegram");
                    if (channelVal === "feishu" || channelVal === "lark") return t("business_summary_card.channel_feishu");
                    if (channelVal === "web" || channelVal === "none") return t("business_summary_card.channel_web");
                    return channelVal;
                  })()}
                </p>
              </div>
              <div className="space-y-1 text-left">
                <span className="text-content-muted font-bold uppercase tracking-wider">{t("business_summary_card.skills_label")}</span>
                <p className="text-content-secondary font-medium bg-surface p-2.5 rounded-xl border border-outline leading-normal">
                  {selectedTemplate ? (selectedTemplate.default_skills && selectedTemplate.default_skills.length > 0 ? selectedTemplate.default_skills.join(", ") : t("business_summary_card.no_extra_skills")) : (activeBlueprint.recommended_skills || t("business_summary_card.core_brain"))}
                </p>
              </div>
            </div>
          </div>

          {/* Template-specific inputs */}
          <div className="p-5 border border-outline/80 bg-surface rounded-2xl space-y-4 shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-outline pb-2">
              <Code className="w-4 h-4 text-indigo-650" />
              <span className="text-[13px] font-black text-content uppercase tracking-wider">
                {selectedTemplate ? t("business_summary_card.required_inputs_section") : t("template_selection.blueprint_auto_config_title")}
              </span>
            </div>

            {selectedTemplate && selectedTemplate.required_inputs && selectedTemplate.required_inputs.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {renderRequiredInputs()}
              </div>
            ) : (
              <div className="p-4 bg-emerald-50/20 border border-emerald-100 rounded-xl text-left">
                <h5 className="text-[11.5px] font-black text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>{t("template_selection.blueprint_auto_config_title")}</span>
                </h5>
                <p className="text-[10.5px] text-emerald-800 leading-relaxed mt-1 font-medium">
                  {t("template_selection.blueprint_auto_config_desc")}
                </p>
              </div>
            )}

            {/* Safety Consent confirmation */}
            {selectedTemplate && selectedTemplate.required_permissions && selectedTemplate.required_permissions.length > 0 && (
              <div className="pt-3 border-t border-outline space-y-2.5 text-left">
                <div className="flex items-center gap-1.5 text-amber-700">
                  <Shield className="w-4 h-4" />
                  <span className="text-[13px] font-black uppercase tracking-wider">{t("template_selection.consent_title")}</span>
                </div>
                <div className="p-3.5 bg-amber-50/30 border border-amber-200/50 rounded-xl space-y-2.5 text-[13px]">
                  <p className="text-amber-900 font-bold">
                    {t("template_selection.consent_list_title")}
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-content-secondary">
                    {selectedTemplate.required_permissions.map((perm: any, idx: number) => (
                      <li key={idx}>
                        <strong>{perm.scope || t("template_selection.permission_scope_fallback")}</strong>：{perm.reason || t("template_selection.permission_reason_fallback")}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-2 pt-2.5 border-t border-amber-200/30">
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(e) => {
                        setConsentChecked(e.target.checked);
                        update("template_consent_ok", e.target.checked);
                      }}
                      className="mt-0.5 w-4 h-4 text-amber-600 border-amber-300 focus:ring-amber-500 rounded cursor-pointer"
                      id="chk-consent"
                    />
                    <label htmlFor="chk-consent" className="text-[10.5px] text-amber-900 font-bold cursor-pointer select-none leading-relaxed">
                      {t("template_selection.consent_checkbox")}
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Platform settings */}
          <div className="p-5 border border-outline/80 bg-surface rounded-2xl shadow-sm text-left">
            {renderPlatformFields()}
          </div>
        </div>
      ) : (
        // Blank/Custom deployment mode
        <div className="space-y-6">
          {applyTemplate && (
            <div className="p-5 border border-outline bg-surface-muted/30 rounded-2xl space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-outline/60">
                <div className="p-1 bg-amber-50 rounded">
                  <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                </div>
                <h4 className="text-sm font-black text-content tracking-tight">{t("template_selection.title")}</h4>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8 gap-2.5">
                  <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />
                  <span className="text-[13px] font-medium text-content-muted">{t("template_selection.loading_templates")}</span>
                </div>
              ) : error ? (
                <div className="p-5 bg-rose-50 border border-rose-100 rounded-2xl text-center space-y-3">
                  <p className="text-[13px] text-rose-600 font-medium">{error}</p>
                  <div className="flex items-center justify-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={loadTemplates}
                      className="h-8 text-[13px] rounded-lg border-rose-200 text-rose-700 hover:bg-rose-100/50"
                    >
                      <RefreshCw className="w-3 h-3 mr-1.5" />
                      {t("template_selection.retry_load")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setError(null)}
                      className="h-8 text-[13px] rounded-lg text-content-muted hover:text-content-secondary"
                    >
                      {t("template_selection.skip_template")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[13px] font-medium text-content-muted leading-relaxed text-left">
                    {t("template_selection.intro_desc")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {templates.map(tmpl => (
                      <button
                        key={tmpl.id}
                        onClick={() => handleSelectTemplate(tmpl)}
                        type="button"
                        className="flex flex-col p-4 rounded-xl border border-outline bg-surface hover:border-indigo-500 hover:shadow-md transition-all text-left group active:scale-[0.98] cursor-pointer"
                      >
                        <div className="flex items-center gap-3 w-full mb-2">
                          <div className="w-9 h-9 rounded-xl bg-surface-muted flex items-center justify-center shrink-0 group-hover:bg-indigo-50 transition-colors">
                            {getTemplateIcon(tmpl.tags, tmpl.use_case)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h5 className="font-bold text-content text-[13px] truncate">{tmpl.name}</h5>
                            <p className="text-[11px] text-indigo-600 font-bold uppercase tracking-wider">{tmpl.category || t("template_selection.workflow_preset_badge")}</p>
                          </div>
                        </div>
                        <p className="text-[11px] sm:text-[13px] text-content-muted font-medium leading-normal mb-3 line-clamp-2">
                          {tmpl.use_case || tmpl.desc}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-auto w-full pt-1">
                          {tmpl.tags?.slice(0, 3).map((tag: string) => (
                            <span key={tag} className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-surface-muted text-content-secondary">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Platform Settings (No template chosen yet, displayed below selector list) */}
          <div className="p-5 border border-outline/80 bg-surface rounded-2xl shadow-sm text-left">
            {renderPlatformFields()}
          </div>
        </div>
      )}
    </div>
  );
}

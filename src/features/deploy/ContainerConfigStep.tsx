import { useState, useEffect } from "react";
import { Server, ChevronRight, Zap, Cpu, HardDrive, Globe, Lock } from "lucide-react";
import { Label, Input, Button } from "../../components/ui";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";

interface ContainerConfigStepProps {
  data: any;
  update: (k: string, v: any) => void;
  preflight: any;
  versions: any[];
  currentUser?: any;
  activeBlueprint?: any;
  advancedResourceConfigEnabled?: boolean;
}

export function ContainerConfigStep({ 
  data, 
  update, 
  preflight, 
  versions,
  currentUser,
  activeBlueprint,
  advancedResourceConfigEnabled = false
}: ContainerConfigStepProps) {
  const { t } = useTranslation("deploy");
  const isTraefik = preflight?.proxyMode === "traefik";
  const isTemplateDeployment = !!(data.template_id || data.template_slug || data.blueprint_id || data.blueprint_slug || activeBlueprint);
  const [showAdvanced, setShowAdvanced] = useState(!isTemplateDeployment);
  const canEditAgentImage = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  const selectedVersion = versions.find(v => {
    if (v.image_tag === data.imageTag || v.tag === data.imageTag || v.version === data.imageTag) return true;
    if (v.coreVariant?.tag === data.imageTag || v.feishuVariant?.tag === data.imageTag) return true;
    return false;
  });

  const isCurrentTagFeishuCapable = !!(
    data.imageTag && typeof data.imageTag === 'string' && (
      data.imageTag === 'latest' ||
      data.imageTag.toLowerCase().includes("feishu") ||
      data.imageTag.toLowerCase().includes("lark")
    )
  );

  const [myPolicy, setMyPolicy] = useState<any>(null);

  useEffect(() => {
    if (!advancedResourceConfigEnabled) return;
    api.get(currentUser?.role === 'admin' || currentUser?.role === 'super_admin' ? '/api/system/local-resource-policy' : '/api/system/my-resource-policy')
      .then(d => {
        if (d) {
          setMyPolicy(d);
          const defaultCpu = d.defaultCpu ?? d.default_cpu_limit;
          const defaultMemoryMb = d.defaultMemoryMb ?? d.default_memory_limit_mb;
          if (!data.limitsCpu || data.limitsCpu === "0.5") {
            update("limitsCpu", String(defaultCpu));
          }
          if (!data.limitsMem || data.limitsMem === "512MB") {
            update("limitsMem", `${defaultMemoryMb}MB`);
          }
        }
      })
      .catch(e => console.error("Failed to load user policy:", e));
  }, [advancedResourceConfigEnabled, currentUser?.token]);

  // Technical configuration elements shared across states
  const renderTechnicalItems = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("container_config.image_label")}</Label>
            {!canEditAgentImage && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[12px] font-semibold text-content-muted border border-outline">
                <Lock className="w-3 h-3" /> {t("wizardCopy.container.locked")}
              </span>
            )}
          </div>
          <Input
            value={data.image || "nousresearch/hermes-agent"}
            onChange={(e: any) => {
              if (canEditAgentImage) update("image", e.target.value);
            }}
            disabled={!canEditAgentImage}
            readOnly={!canEditAgentImage}
            aria-readonly={!canEditAgentImage}
            className={`h-10 font-mono text-[13px] border-slate-200 dark:border-slate-700 ${canEditAgentImage ? "text-blue-600 dark:text-blue-400 bg-surface-muted" : "text-content-muted bg-surface-muted cursor-not-allowed select-none"}`}
            placeholder={t("wizardCopy.container.imagePlaceholder")}
          />
          {!canEditAgentImage && (
            <p className="text-[12px] leading-5 text-content-muted">
              {t("wizardCopy.container.imageLockedHint")}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-[13px] font-semibold text-content-secondary">{t("container_config.tag_label")}</Label>
          <div className="relative">
            <select
              value={data.imageTag || "latest"}
              onChange={(e) => update("imageTag", e.target.value)}
              className="w-full flex h-10 rounded-lg border border-outline bg-surface px-3 py-2 text-[13px] font-bold text-content shadow-sm focus:border-blue-500 appearance-none outline-none"
            >
              <option value="latest">{t("container_config.latest_option")}</option>
              {versions.map(v => {
                const isFeishu = v.capabilities?.includes("feishu") || v.feishu_capable === true;
                return (
                  <option key={v.tag || v.version} value={v.image_tag || v.tag}>
                    {v.image_tag || v.tag} {v.is_prewarmed ? "⚡" : ""} {isFeishu ? t("wizardCopy.container.feishuSupported") : ""}
                  </option>
                );
              })}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
               <ChevronRight className="w-4 h-4 rotate-90" />
            </div>
          </div>
        </div>
      </div>

      {(data.channel === "feishu" || data.channel === "lark") && !isCurrentTagFeishuCapable && (
        <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-900 animate-in fade-in zoom-in-95 duration-250">
          <span className="text-sm mt-0.5">⚠️</span>
          <div className="text-[13px]">
            <strong className="block font-bold">{t("container_config.feishu_warning_title")}</strong>
            <p className="mt-0.5 text-[13px] leading-relaxed opacity-90">
              {t("container_config.feishu_warning_desc", { tag: data.imageTag })}
            </p>
          </div>
        </div>
      )}

      {selectedVersion?.is_prewarmed && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
           <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white">
              <Zap className="w-3 h-3 fill-current" />
           </div>
           <span className="text-[13px] font-bold text-emerald-700">
             {t("container_config.prewarmed_ready")}
           </span>
        </div>
      )}
      
      {isTraefik ? (
        <div className="space-y-4">
          <div className="p-4 border border-blue-200 bg-gradient-to-r from-blue-50/80 to-indigo-50/40 rounded-2xl text-blue-900 text-[13px] space-y-2.5 shadow-sm">
            <strong className="block font-semibold text-[13px] flex items-center gap-1.5 text-blue-950">
              {t("container_config.traefik_title")}
            </strong>
            <p className="opacity-90 leading-relaxed text-slate-700">
              {t("container_config.traefik_desc")}
            </p>
            <div className="pt-2.5 border-t border-blue-200/40 flex items-center justify-between text-[13px] text-slate-800">
              <span className="font-semibold">{t("container_config.session_port_label")}</span>
              <span className="font-mono bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full font-bold">
                {t("container_config.traefik_ports")}
              </span>
            </div>
          </div>

          <div className="border border-slate-200/70 rounded-2xl p-4 bg-slate-50/50 text-[13px]">
            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer font-bold text-slate-700 hover:text-slate-900 select-none">
                <span className="flex items-center gap-1.5 text-[13px] text-slate-700">{t("container_config.advanced_details")}</span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-open:rotate-90 transition-transform" />
              </summary>
              <div className="mt-3.5 space-y-2.5 border-t border-slate-200/50 pt-3.5 text-[13px] text-slate-500 leading-relaxed">
                <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-200/40">
                  <span>{t("container_config.start_port_scan")}</span>
                  <span className="font-mono font-bold text-slate-800 text-[13px]">10100</span>
                </div>
                <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-200/40">
                  <span>{t("container_config.end_port_scan")}</span>
                  <span className="font-mono font-bold text-slate-800 text-[13px]">19999</span>
                </div>
                <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-200/40">
                  <span>{t("container_config.internal_rules")}</span>
                  <span className="font-mono font-semibold text-slate-800 text-[11px]">internal_web_port: {data.runtime_type === "pi" ? 8080 : 9119} ({data.runtime_type === "pi" ? "Pi Agent" : "Hermes Agent"})</span>
                </div>
              </div>
            </details>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5 p-4 bg-blue-50/50 dark:bg-slate-900/90 border border-blue-100 dark:border-slate-700 rounded-2xl shadow-sm">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/60 rounded-lg">
              <Globe className="w-4 h-4 text-blue-600 dark:text-blue-300" />
            </div>
            <div className="space-y-1">
              <h5 className="text-sm font-bold text-content">{t("container_config.port_auto_title")}</h5>
              <p className="text-[13px] text-content-muted leading-relaxed">
                {t("container_config.port_auto_desc")}
              </p>
              <div className="pt-2 flex items-center gap-2">
                 <span className="px-2 py-0.5 bg-surface border border-blue-100 dark:border-slate-600 text-[11px] text-blue-600 dark:text-blue-200 font-bold rounded-md">
                   {t("container_config.internal_port_badge")}
                 </span>
                 <span className="px-2 py-0.5 bg-blue-600 text-white text-[11px] font-bold rounded-md animate-pulse">
                   {t("container_config.allocating_badge")}
                 </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resource limits */}
      {advancedResourceConfigEnabled && (
      <div className="space-y-4 p-4 bg-surface border border-outline rounded-2xl shadow-sm">
        <h5 className="text-[13px] font-bold text-content flex items-center gap-1.5 border-b border-outline pb-2">
          <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{t("container_config.resource_limits_title")}</span>
          {currentUser?.role !== 'admin' && (
            <span className="ml-auto text-[11px] font-bold text-content-muted bg-surface-muted px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <span>🔒 {myPolicy?.resource_plan || t("container_config.standard_shared_plan")}</span>
            </span>
          )}
        </h5>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary flex items-center gap-1">
              <span>{t("container_config.cpu_limit_label")}</span>
            </Label>
            <div className="relative">
              <select
                value={data.limitsCpu || "1"}
                onChange={(e) => update("limitsCpu", e.target.value)}
                disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_cpu_limit <= 0.5 : true)}
                className="w-full flex h-10 rounded-lg border border-outline bg-surface px-3 py-2 text-[13px] font-bold text-content shadow-sm focus:border-blue-500 appearance-none outline-none disabled:bg-surface-muted disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                <option value="0.1" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_cpu_limit < 0.1 : false)}>{t("container_config.cpu_option_01")}</option>
                <option value="0.25" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_cpu_limit < 0.25 : false)}>{t("container_config.cpu_option_025")}</option>
                <option value="0.5" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_cpu_limit < 0.5 : false)}>{t("container_config.cpu_option_05")}</option>
                <option value="1.0" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_cpu_limit < 1.0 : true)}>{t("container_config.cpu_option_1")}</option>
                <option value="2.0" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_cpu_limit < 2.0 : true)}>{t("container_config.cpu_option_2")}</option>
                <option value="unlimited" disabled={currentUser?.role !== 'admin'}>{t("container_config.no_limit_option")}</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 font-bold text-[11px]">
                 {currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || (myPolicy && myPolicy.max_cpu_limit >= 1) ? <ChevronRight className="w-4 h-4 rotate-90" /> : t("wizardCopy.container.locked")}
              </div>
            </div>
            <p className="text-[11px] text-content-muted leading-normal">
              {t("container_config.cpu_tip")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary flex items-center gap-1">
              <span>{t("container_config.ram_limit_label")}</span>
            </Label>
            <div className="relative">
              <select
                value={data.limitsMem || "1024MB"}
                onChange={(e) => update("limitsMem", e.target.value)}
                disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_memory_limit_mb <= 512 : true)}
                className="w-full flex h-10 rounded-lg border border-outline bg-surface px-3 py-2 text-[13px] font-bold text-content shadow-sm focus:border-blue-500 appearance-none outline-none disabled:bg-surface-muted disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                <option value="128MB" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_memory_limit_mb < 128 : false)}>{t("container_config.ram_option_128")}</option>
                <option value="256MB" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_memory_limit_mb < 256 : false)}>{t("container_config.ram_option_256")}</option>
                <option value="512MB" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_memory_limit_mb < 512 : false)}>{t("container_config.ram_option_512")}</option>
                <option value="1GB" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_memory_limit_mb < 1024 : true)}>{t("container_config.ram_option_1")}</option>
                <option value="2GB" disabled={currentUser?.role !== 'admin' && (myPolicy ? myPolicy.max_memory_limit_mb < 2048 : true)}>{t("container_config.ram_option_2")}</option>
                <option value="unlimited" disabled={currentUser?.role !== 'admin'}>{t("container_config.ram_no_limit_option")}</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 font-bold text-[11px]">
                 {currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || (myPolicy && myPolicy.max_memory_limit_mb >= 1024) ? <ChevronRight className="w-4 h-4 rotate-90" /> : t("wizardCopy.container.locked")}
              </div>
            </div>
            <p className="text-[11px] text-slate-400 leading-normal">
              {t("container_config.ram_tip")}
            </p>
          </div>
        </div>
      </div>
      )}


    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="border-b border-slate-100 pb-3">
        <h4 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
          <Server className="w-5 h-5 text-blue-600" />
          <span>{isTemplateDeployment ? t("advanced_config.title") : t("container_config.title")}</span>
        </h4>
        <p className="text-[13px] text-slate-500 mt-1">
          {isTemplateDeployment ? t("advanced_config.desc") : t("container_config.title_desc")}
        </p>
      </div>

      {isTemplateDeployment ? (
        <div className="border border-slate-200/80 rounded-2xl p-4 bg-slate-50/15">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between cursor-pointer font-bold text-slate-700 hover:text-slate-900 select-none outline-none"
          >
            <span className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-700">
              <Server className="w-4 h-4 text-indigo-500 animate-pulse" />
              <span>{t("container_config.advanced_panel_title")}</span>
            </span>
            <div className="flex items-center gap-2 text-[11px] text-indigo-700 font-bold bg-indigo-50/50 px-2.5 py-0.5 rounded-full border border-indigo-100/40">
              <span>{showAdvanced ? t("container_config.hide_advanced_btn") : t("container_config.show_advanced_btn")}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-250 ${showAdvanced ? "rotate-90" : ""}`} />
            </div>
          </button>

          {showAdvanced && (
            <div className="mt-4 pt-4 border-t border-slate-200/50 space-y-5 animate-in fade-in duration-200">
              {renderTechnicalItems()}
            </div>
          )}
        </div>
      ) : (
        /* Regular expanded layout for Blank Deployment */
        <div className="space-y-5">
          {renderTechnicalItems()}
        </div>
      )}
    </div>
  );
}


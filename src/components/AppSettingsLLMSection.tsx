import { Label, Input } from "./ui";
import { providerRegistry } from "@/shared/providerRegistry";
import { resolveProviderRegistryKey } from "@/shared/providerRegistryUtils";
import { cn } from "../lib/utils";
import type { Credential } from "../types";
import { useTranslation } from "react-i18next";

interface AppSettingsLLMSectionProps {
  password: string;
  setPassword: (v: string) => void;
  provider: string;
  setProvider: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  isCustomModel: boolean;
  setIsCustomModel: (v: boolean) => void;
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  providerApiKey: string;
  setProviderApiKey: (v: string) => void;
  handleProviderChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  providerCredentialId: string;
  setProviderCredentialId: (v: string) => void;
  credentials: Credential[];
}

export function AppSettingsLLMSection({
  password, setPassword,
  provider, setProvider, handleProviderChange,
  model, setModel,
  isCustomModel, setIsCustomModel,
  baseUrl, setBaseUrl,
  providerApiKey, setProviderApiKey,
  providerCredentialId, setProviderCredentialId,
  credentials
}: AppSettingsLLMSectionProps) {
  const { t } = useTranslation("dashboard");
  const registryProvider = resolveProviderRegistryKey(provider, model, baseUrl);
  const currentProviderConf = providerRegistry[registryProvider];
  const isProviderDeprecated = !!(provider && !currentProviderConf);

  const currentModels = currentProviderConf ? currentProviderConf.models || [] : [];
  const isModelDeprecated = !!(currentProviderConf && model && !isCustomModel && !currentModels.includes(model));

  const activeProviders = Object.values(providerRegistry).filter(p => p.enabled);
  const providerOptions = [...activeProviders];
  if (isProviderDeprecated && provider) {
    providerOptions.unshift({
      id: provider,
      label: provider + " (deprecated / unsupported)",
      enabled: false,
    } as any);
  }

  const modelOptions = Array.from(new Set(currentModels));
  if (isModelDeprecated && model) {
    modelOptions.unshift(model);
  }

  const handleCanonicalProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProvider = e.target.value;
    const nextConf = providerRegistry[nextProvider];
    handleProviderChange(e);
    setProviderCredentialId("");
    setProviderApiKey("");
    if (nextConf) {
      setBaseUrl(nextConf.defaultBaseUrl || "");
      if (!isCustomModel) {
        setModel(nextConf.defaultModel || nextConf.models?.[0] || "");
      }
    }
  };

  const handleCredentialSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const credId = e.target.value;
    setProviderCredentialId(credId);

    if (credId) {
      const selected = credentials.find(c => c.id === credId);
      if (selected) {
        setProviderApiKey("");
        const providerId = resolveProviderRegistryKey(selected.type, undefined, selected.baseUrl);
        const providerConf = providerRegistry[providerId];
        setProvider(providerId);
        const targetBaseUrl = selected.baseUrl || providerConf?.defaultBaseUrl || "";
        setBaseUrl(targetBaseUrl);

        if (!isCustomModel) {
          if (providerConf && providerConf.models && providerConf.models.length > 0 && providerId !== "custom-openai-compatible") {
            setModel(providerConf.defaultModel || providerConf.models[0]);
          }
        }
      }
    } else {
      setProviderApiKey("");
    }
  };

  return (
    <div className="p-4 bg-surface border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-4 shadow-sm">
      <h4 className="text-[13px] font-semibold uppercase tracking-wider text-content-muted">{t("settings_llm_section_title")}</h4>

      {(isProviderDeprecated || isModelDeprecated) && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-200 rounded-lg text-[13px] space-y-1">
          <p className="font-semibold">{t("settings_llm_deprecated_title")}</p>
          <ul className="list-disc pl-4 space-y-0.5 font-sans">
            {isProviderDeprecated && (
              <li>{t("settings_llm_deprecated_provider_prefix")} <strong className="font-mono text-[13px]">{provider}</strong> {t("settings_llm_deprecated_provider_suffix")}</li>
            )}
            {isModelDeprecated && (
              <li>{t("settings_llm_deprecated_model_prefix")} <strong className="font-mono text-[13px]">{model}</strong> {t("settings_llm_deprecated_model_suffix")}</li>
            )}
          </ul>
          <p className="mt-1 opacity-90">{t("settings_llm_deprecated_hint")}</p>
        </div>
      )}

      <input
        type="text"
        name="fake-username-trap"
        autoComplete="username"
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: "absolute", top: "-1000px", left: "-1000px", width: "1px", height: "1px", opacity: 0.01, overflow: "hidden" }}
      />
      <input
        type="password"
        name="fake-password-trap"
        autoComplete="new-password"
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: "absolute", top: "-1000px", left: "-1000px", width: "1px", height: "1px", opacity: 0.01, overflow: "hidden" }}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>{t("settings_web_password_reset")}</Label>
          <Input
            id="mybay-reset-web-access-secret"
            name="mybay-reset-web-access-secret"
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            type="password"
            placeholder={t("settings_web_password_placeholder")}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>{t("settings_model_provider")}</Label>
          <select
            value={registryProvider}
            onChange={handleCanonicalProviderChange}
            className="flex h-9 w-full rounded-md border border-outline bg-surface px-3 text-sm text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 mt-1"
          >
            {providerOptions.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <Label className="flex justify-between items-center text-[13px]">
            <span>{t("settings_model")}</span>
            <label className="flex items-center gap-1 cursor-pointer font-normal text-content-muted font-sans">
              <input
                type="checkbox"
                checked={isCustomModel || false}
                onChange={e => {
                  setIsCustomModel(e.target.checked);
                  const conf = providerRegistry[registryProvider];
                  const models = conf ? conf.models || [] : [];
                  if (!e.target.checked && models.length > 0) {
                    setModel(models[0]);
                  }
                }}
                className="rounded border-outline-strong text-blue-600 focus:ring-blue-500 size-3"
              />
              <span>{t("settings_custom_model_id")}</span>
            </label>
          </Label>
          {(!isCustomModel && modelOptions.length > 0) ? (
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="flex h-9 w-full rounded-md border border-outline bg-surface px-3 text-sm text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 mt-1 font-mono text-[13px]"
            >
              {modelOptions.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <Input
              placeholder={registryProvider === "doubao" ? t("settings_custom_model_placeholder_doubao") : t("settings_custom_model_placeholder")}
              value={model}
              onChange={e => setModel(e.target.value)}
              className="font-mono text-[13px] mt-1"
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>{t("settings_custom_api_base_url")}</Label>
          <Input
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            className="font-mono text-[13px] text-blue-600 dark:text-blue-300 mt-1"
          />
        </div>
        <div>
          <Label className="flex justify-between items-center text-[13px]">
            <span>{t("settings_credential_source")}</span>
          </Label>
          <select
            className="flex h-9 w-full rounded-md border border-outline bg-surface-muted px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 mt-1 text-content"
            value={providerCredentialId || ""}
            onChange={handleCredentialSelect}
          >
            <option value="">{t("settings_manual_api_key")}</option>
            {credentials.filter(c => resolveProviderRegistryKey(c.type, undefined, c.baseUrl) === registryProvider || registryProvider === "custom-openai-compatible").map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label className="flex items-center justify-between text-[13px]">
          <span>{t("settings_provider_api_key")}</span>
          {providerCredentialId ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">{t("settings_using_saved_credential")}</span>
          ) : !providerApiKey ? (
            <span className="text-content-muted text-[11px]">{t("settings_keep_current_key")}</span>
          ) : (
            <span className="text-blue-500 dark:text-blue-300 text-[11px]">{t("settings_will_update_key")}</span>
          )}
        </Label>
        <Input
          id={"mybay-llm-secret-reset-" + (registryProvider || "manual")}
          name={"mybay-llm-secret-reset-" + (registryProvider || "manual")}
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          type="password"
          placeholder={providerCredentialId ? t("settings_saved_credential_placeholder") : t("settings_runtime_key_placeholder")}
          value={providerCredentialId ? "" : providerApiKey}
          disabled={!!providerCredentialId}
          onChange={e => setProviderApiKey(e.target.value)}
          className={cn("mt-1", providerCredentialId && "font-sans bg-surface-muted text-content-muted")}
        />
      </div>
    </div>
  );
}

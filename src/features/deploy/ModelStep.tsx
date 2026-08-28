import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Zap, Key, Link2, AlertCircle, CheckCircle2, Loader2, ShieldCheck, Database } from "lucide-react";
import { Label, Input, Button } from "../../components/ui";
import { cn } from "../../lib/utils";
import { providerRegistry } from "../../../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../../../shared/providerRegistryUtils";
import type { Credential } from "../../types";
import { api } from "../../lib/api";
import { ProviderSelect } from "../../components/ProviderSelect";
import { useProviderOAuth } from "./useProviderOAuth";

interface ModelStepProps {
  data: any;
  update: (k: any, v: any) => void;
  testLLM: () => Promise<void>;
  testStatus: any;
  currentUser: any;
}

export function ModelStep({ data, update, testLLM, testStatus, currentUser }: ModelStepProps) {
  const { t } = useTranslation("deploy");
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credsLoading, setCredsLoading] = useState(false);

  useEffect(() => {
    const fetchCreds = async () => {
      setCredsLoading(true);
      try {
        const creds = await api.get("/api/credentials");
        setCredentials(creds || []);
      } catch (err) {
        console.error("Failed to fetch credentials:", err);
      } finally {
        setCredsLoading(false);
      }
    };
    fetchCreds();
  }, [currentUser]);

  const isPlatformModelMode = false;

  const selectedProviderConf = data.provider ? providerRegistry[data.provider as string] : undefined;
  const isOAuthProvider = selectedProviderConf?.authMode === "oauth-device-code";
  const currentModels = selectedProviderConf ? selectedProviderConf.models || [] : [];
  const oauth = useProviderOAuth({
    provider: data.provider || "",
    enabled: isOAuthProvider,
    onComplete: (saved, refreshed) => {
      setCredentials(refreshed);
      update("providerCredentialId", saved.id);
      update("providerApiKey", "");
      update("baseUrl", saved.baseUrl || selectedProviderConf?.defaultBaseUrl || "");
    },
  });

  const handleProviderChange = (prov: string) => {
    update("provider", prov);
    update("providerCredentialId", ""); // Reset saved credential selection
    const conf = providerRegistry[prov];
    if (conf) {
      if (conf.authMode === "oauth-device-code") {
        update("providerApiKey", "");
      }
      update("model", conf.defaultModel || "");
      update("baseUrl", conf.defaultBaseUrl || "");
    } else {
      update("model", "");
      update("baseUrl", "");
    }
  };

  const handleCredentialSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const credId = e.target.value;
    update("providerCredentialId", credId);

    if (credId) {
      const selected = credentials.find(c => c.id === credId);
      if (selected) {
        update("providerApiKey", ""); // Keep key empty to use stored key

        const providerId = resolveProviderRegistryKey(selected.type, undefined, selected.baseUrl);
        const providerConf = providerRegistry[providerId];

        // Use credential's baseUrl if present, otherwise fallback to provider default
        const targetBaseUrl = selected.baseUrl || providerConf?.defaultBaseUrl || "";
        update("baseUrl", targetBaseUrl);

        // If the provider changes, handle it and update default model
        if (providerId && providerConf) {
           update("provider", providerId);
           if (providerConf.defaultModel) {
             update("model", providerConf.defaultModel);
           }
        }
      }
    } else {
      update("providerApiKey", "");
    }
  };

  const isTesting = testStatus?.loading;
  const isTestSuccess = testStatus?.result?.success;

  // Validation for test button
  const canTest = () => {
    if (isPlatformModelMode) return false;
    if (!data.provider || !data.model || isTesting) return false;

    const conf = providerRegistry[data.provider];
    if (!conf || isOAuthProvider || conf.testStrategy === "no-predeploy-test") return false;
    if (conf.requiresApiKey && !data.providerApiKey && !data.providerCredentialId) return false;
    // If it's custom, it MUST have a base URL
    if (data.provider === 'custom-openai-compatible' && !data.baseUrl) return false;

    // For others, if they have an empty baseUrl but have a default in registry, it's fine (server uses default)
    // but typically we should have one.
    // If the provider is known and has a default, we are good.
    if (conf && (data.baseUrl || conf.defaultBaseUrl)) return true;

    return !!data.baseUrl;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div style={{ position: "absolute", left: "-9999px", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
        <input type="text" name="username" autoComplete="username" tabIndex={-1} />
        <input type="password" name="password" autoComplete="new-password" tabIndex={-1} />
      </div>
      {/* Visual Header */}
      <div className="border-b border-outline pb-3 flex flex-col sm:flex-row gap-3.5 sm:items-center justify-between">
        <div className="space-y-0.5">
          <h4 className="text-base font-bold text-content flex items-center gap-1.5">
            <Cpu className="w-5 h-5 text-blue-600" />
            <span>{t("wizardCopy.model.title")}</span>
          </h4>
          <p className="text-[13px] text-content-muted">
            {t("wizardCopy.model.description")}
          </p>
        </div>

        {!isOAuthProvider && <Button
          type="button"
          onClick={testLLM}
          disabled={!canTest()}
          variant={isTestSuccess ? "outline" : "primary"}
          className={`h-9 px-4 text-[13px] font-semibold shrink-0 gap-1.5 self-start sm:self-auto ${isTestSuccess ? "text-green-700 dark:text-emerald-300 hover:text-green-800 dark:hover:text-emerald-200 border-green-200 dark:border-emerald-800/70 bg-green-50/50 dark:bg-emerald-950/30" : ""}`}
        >
          {isTesting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t("wizardCopy.model.testing")}</span>
            </>
          ) : isTestSuccess ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              <span>{t("wizardCopy.model.testPassed")}</span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5" />
              <span>{t("wizardCopy.model.test")}</span>
            </>
          )}
        </Button>}
      </div>

      {/* Connection response banner */}
      {testStatus?.result && (
        <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-[13px] animate-in fade-in duration-200 ${
          isTestSuccess
            ? "bg-green-50/50 dark:bg-emerald-950/30 border-green-200 dark:border-emerald-800/70 text-green-800 dark:text-emerald-200"
            : "bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-800/70 text-red-800 dark:text-red-200"
        }`}>
          {isTestSuccess ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <p className="font-semibold">
              {isTestSuccess ? t("wizardCopy.model.success") : t("wizardCopy.model.failure")}
            </p>
            <p className="opacity-90 leading-relaxed font-mono text-[13px]">
              {isTestSuccess
                ? t("wizardCopy.model.successDetail")
                : testStatus.result.error || testStatus.result.message || t("wizardCopy.model.unknownError")}
            </p>
          </div>
        </div>
      )}

      {isOAuthProvider && (
        <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800/70 dark:bg-indigo-950/35 dark:text-indigo-100 flex items-start gap-2.5 text-[13px]">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p className="font-semibold">{t("wizardCopy.model.oauthConnectTitle")}</p>
            <p className="leading-relaxed">{t("wizardCopy.model.oauthConnectDescription")}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" className="h-9" onClick={oauth.connect} disabled={oauth.loading || !!data.providerCredentialId}>
                {oauth.loading
                  ? t("wizardCopy.model.oauthConnecting")
                  : data.providerCredentialId
                    ? t("wizardCopy.model.oauthConnected")
                    : t("wizardCopy.model.oauthConnect")}
              </Button>
              {oauth.loading && (
                <Button type="button" variant="outline" className="h-9" onClick={() => oauth.cancel()}>
                  {t("wizardCopy.model.oauthCancel")}
                </Button>
              )}
            </div>
            {oauth.session?.userCode && (
              <p className="font-mono text-xs">{t("wizardCopy.model.oauthCode")}: {oauth.session.userCode}</p>
            )}
            {oauth.error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{oauth.error}</p>}
            {data.provider === "xai-oauth" && (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t("wizardCopy.model.xaiOAuthTierNotice")}</p>
            )}
          </div>
        </div>
      )}

      {!isOAuthProvider && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-left shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-content">
          <Key className="h-4 w-4 text-blue-600" />
          {t("wizardCopy.model.byokTitle")}
        </div>
        <p className="mt-1 text-[13px] leading-5 text-content-muted">
          {t("wizardCopy.model.byokDescription")}
        </p>
      </div>}

      {/* Two column form */}
      <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-6 pt-2", isPlatformModelMode && "opacity-55 pointer-events-none")}>
        <div className="space-y-5">
          {!isOAuthProvider && <div>
            <Label className="text-sm font-semibold text-content-secondary flex items-center gap-1.5">
              <Database className="w-4 h-4 text-content-muted" />
              {t("wizardCopy.model.savedCredential")}
            </Label>
            <select
              className="mt-2 flex h-11 w-full rounded-lg border border-outline bg-surface-muted px-3.5 py-2.5 text-sm shadow-sm transition-colors text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              value={data.providerCredentialId || ""}
              onChange={handleCredentialSelect}
            >
              <option value="">{t("wizardCopy.model.manualKey")}</option>
              {credentials.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
              ))}
            </select>
            <p className="text-[11px] text-content-muted mt-1.5">
              {t("wizardCopy.model.savedCredentialHint")}
            </p>
          </div>}

          <div>
            <Label className="text-sm font-semibold text-content-secondary flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-content-muted" />
              {t("wizardCopy.model.provider")}
            </Label>
            <ProviderSelect
              className="mt-2"
              value={data.provider || ""}
              onValueChange={handleProviderChange}
              placeholder={t("wizardCopy.model.selectProvider")}
            />
          </div>
        </div>

        <div className="space-y-5">
          {!isOAuthProvider && <div>
            <Label className="text-sm font-semibold text-content-secondary flex items-center gap-1.5">
              <Key className="w-4 h-4 text-content-muted" />
              {t("wizardCopy.model.apiKey")}
            </Label>
            <div className="relative mt-2">
              <Input
                id={`mybay-llm-secret-${data.provider || "manual"}`}
                name={`mybay-llm-secret-${data.provider || "manual"}`}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                type="password"
                placeholder={data.providerCredentialId ? t("wizardCopy.model.usingSavedCredential") : t("wizardCopy.model.apiKeyPlaceholder")}
                disabled={!!data.providerCredentialId}
                value={data.providerCredentialId ? "" : (data.providerApiKey || "")}
                onChange={(e: any) => update("providerApiKey", e.target.value)}
                className={cn(
                  "h-11 border-outline rounded-lg placeholder:text-content-muted disabled:bg-emerald-50 disabled:border-emerald-200 disabled:text-emerald-700 disabled:opacity-100",
                  data.providerCredentialId && "font-sans"
                )}
              />
              {data.providerCredentialId && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                   <ShieldCheck className="w-4 h-4 text-emerald-500" />
                </div>
              )}
            </div>
          </div>}

          {!isOAuthProvider && <div>
            <Label className="text-sm font-semibold text-content-secondary flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-content-muted" />
              {t("wizardCopy.model.baseUrl")}
            </Label>
            <Input
              placeholder={selectedProviderConf?.defaultBaseUrl ? t("wizardCopy.model.defaultBaseUrl", { url: selectedProviderConf.defaultBaseUrl }) : t("wizardCopy.model.baseUrlPlaceholder")}
              value={data.baseUrl || ""}
              onChange={(e: any) => update("baseUrl", e.target.value)}
              className="mt-2 h-11 font-mono text-sm border-outline rounded-lg pr-3"
            />
          </div>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="pt-0">
          <div className="flex justify-between items-center mb-2">
            <Label className="text-sm font-semibold text-content-secondary flex items-center gap-1">
              <span>{t("wizardCopy.model.model")}</span>
            </Label>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-content-muted text-[13px] select-none">
              <input
                type="checkbox"
                checked={data.isCustomModel || false}
                onChange={e => {
                  update("isCustomModel", e.target.checked);
                  if (!e.target.checked && currentModels.length > 0) {
                    update("model", currentModels[0]);
                  }
                }}
                className="rounded border-outline-strong w-4 h-4 text-blue-600 focus:ring-blue-500 mt-0.5"
              />
              <span>{t("wizardCopy.model.customModel")}</span>
            </label>
          </div>

          {(!data.isCustomModel && currentModels.length > 0) ? (
            <select
              className="flex h-11 w-full rounded-lg border border-outline bg-surface px-3.5 py-2.5 text-sm shadow-sm text-content focus-visible:ring-1 focus-visible:ring-blue-500"
              value={data.model || ""}
              onChange={(e: any) => update("model", e.target.value)}
            >
              {currentModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <Input
              placeholder={t("wizardCopy.model.customModelPlaceholder")}
              value={data.model || ""}
              onChange={(e: any) => update("model", e.target.value)}
              className="h-11 font-mono text-sm border-outline rounded-lg"
            />
          )}
        </div>
      </div>

      {!isTestSuccess && !isOAuthProvider && (
        <div className="p-4 bg-surface-muted border border-outline rounded-xl text-sm text-content-muted leading-relaxed shadow-sm">
          <strong className="text-content">{t("wizardCopy.model.securityTitle")}</strong>
          {data.providerCredentialId ? t("wizardCopy.model.securitySaved") : t("wizardCopy.model.securityByok")}
          {t("wizardCopy.model.securityVerify")}
        </div>
      )}
    </div>
  );
}

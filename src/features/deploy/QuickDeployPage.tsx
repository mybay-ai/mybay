import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2, Settings2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { providerRegistry } from "../../../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../../../shared/providerRegistryUtils";
import { Button, Card, Input, Label, cn } from "../../components/ui";
import { ProviderSelect } from "../../components/ProviderSelect";
import type { Credential, SetupFormData } from "../../types";
import { api } from "../../lib/api";
import { ChannelManualConfigForm } from "./ChannelManualConfigForm";
import { ChannelSelector } from "./ChannelSelector";
import { buildQuickDeployAdvancedInitialData } from "./quickDeployAdvancedHandoff";
import { buildQuickDeployPath, createQuickDeployDraft } from "./quickDeployConfig";
import { buildQuickDeploymentRequest } from "./quickDeploymentRequestAdapter";
import type { QuickDeployChannel, QuickDeployDraft, QuickDeployValidationIssue } from "./quickDeployTypes";
import { validateQuickDeployDraft } from "./quickDeployValidation";
import { requiresPredeployModelTest } from "./deployStepValidation";
import { QuickDeployDelivery } from "./QuickDeployDelivery";
import { useProviderOAuth } from "./useProviderOAuth";
import { fetchRuntimeCatalog } from "./runtimeCatalogClient";
import type { RuntimeDefinition } from "../../../shared/runtimeCatalog";
import { CODEX_QUICK_DEPLOY_PROVIDER_IDS, PI_QUICK_DEPLOY_PROVIDER_IDS, supportsQuickDeployRuntimeProvider } from "../../../shared/runtimeModelProviderPolicy";
import { AgentRuntimeIcon } from "../../components/brand/AgentRuntimeIcon";
import { ChannelBrandIcon } from "../../components/brand/ChannelBrandIcon";

interface QuickDeployPageProps {
  currentUser: any;
  onAdvanced: (initialData: Partial<SetupFormData>) => void;
  onCreated: (instance: any) => void;
  onOpenChat: (instanceId: string) => void;
  onViewInstances: () => void;
}

function randomToken() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function QuickDeployPage({ currentUser, onAdvanced, onCreated, onOpenChat, onViewInstances }: QuickDeployPageProps) {
  const { t } = useTranslation("deploy");
  const [draft, setDraft] = useState<QuickDeployDraft>(() => createQuickDeployDraft());
  const [path] = useState(() => buildQuickDeployPath("agent", randomToken()));
  const [idempotencyKey] = useState(() => randomToken());
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [runtimeDefinitions, setRuntimeDefinitions] = useState<RuntimeDefinition[]>([]);
  const [runtimeCatalogState, setRuntimeCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [preflight, setPreflight] = useState<"loading" | "ready" | "blocked">("loading");
  const [preflightMessage, setPreflightMessage] = useState("");
  const [modelTest, setModelTest] = useState<"idle" | "testing" | "passed" | "failed">("idle");
  const [modelTestMessage, setModelTestMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);
  const submitLock = useRef(false);

  const strategy = draft.modelStrategy;
  const isCodexRuntime = draft.runtimeType === "codex";
  const isCodexAccount = isCodexRuntime && draft.codexAuthMode !== "api";
  const isNativeBridge = draft.runtimeType !== "hermes";
  const compatibleCredentials = useMemo(() => credentials.filter((credential) => {
    const provider = resolveProviderRegistryKey(credential.provider || credential.type, undefined, credential.baseUrl);
    return supportsQuickDeployRuntimeProvider(draft.runtimeType, provider);
  }), [credentials, draft.runtimeType]);
  const selectedRuntime = runtimeDefinitions.find((definition) => definition.runtime.type === draft.runtimeType);
  const providerConfig = providerRegistry[strategy.provider];
  const isOAuthProvider = providerConfig?.authMode === "oauth-device-code";
  const modelNeedsTest = isCodexRuntime ? !isCodexAccount && !isOAuthProvider : requiresPredeployModelTest(strategy.provider);
  const validationIssues = useMemo(() => validateQuickDeployDraft(draft), [draft]);
  const visibleIssues = submitted ? validationIssues : [];

  const updateDraft = (patch: Partial<QuickDeployDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const updateStrategy = (patch: Partial<QuickDeployDraft["modelStrategy"]>) => {
    setDraft((current) => ({
      ...current,
      modelStrategy: { ...current.modelStrategy, ...patch } as QuickDeployDraft["modelStrategy"],
      permissionConfirmed: false,
    }));
    setModelTest("idle");
    setModelTestMessage("");
  };

  const selectChannel = (channel: string) => {
    if (!["web", "telegram", "feishu", "weixin"].includes(channel)) return;
    setDraft((current) => ({
      ...current,
      channel: channel as QuickDeployChannel,
      permissionConfirmed: false,
    }));
  };

  const updateChannelField = (key: string, value: unknown) => {
    setDraft((current) => ({ ...current, [key]: value, permissionConfirmed: false }));
  };

  const selectRuntime = (runtimeType: "hermes" | "pi" | "codex") => {
    if (oauth.loading) return;
    const definition = runtimeDefinitions.find((candidate) => candidate.runtime.type === runtimeType);
    if (!definition?.release.deploymentSupported) return;
    setDraft((current) => {
      if (runtimeType === "codex") return { ...current, codexAuthMode: "chatgpt", codexAuthJson: undefined, runtimeType, channel: "web", selectedSkillIds: [], modelStrategy: { mode: "byok", provider: "openai", model: "", isCustomModel: true }, permissionConfirmed: false };
      let modelStrategy = current.modelStrategy;
      if (!supportsQuickDeployRuntimeProvider(runtimeType, modelStrategy.provider)) {
        const compatibleCredential = credentials.find((credential) => {
          const provider = resolveProviderRegistryKey(credential.provider || credential.type, undefined, credential.baseUrl);
          return supportsQuickDeployRuntimeProvider(runtimeType, provider);
        });
        if (compatibleCredential) {
          const provider = resolveProviderRegistryKey(compatibleCredential.provider || compatibleCredential.type, undefined, compatibleCredential.baseUrl);
          const config = providerRegistry[provider];
          modelStrategy = {
            mode: "saved_credential",
            credentialId: compatibleCredential.id,
            provider,
            model: config?.defaultModel || "",
            baseUrl: compatibleCredential.baseUrl || config?.defaultBaseUrl,
            isCustomModel: compatibleCredential.isCustom,
          };
        } else {
          const config = providerRegistry.deepseek;
          modelStrategy = { mode: "byok", provider: config.id, model: config.defaultModel, baseUrl: config.defaultBaseUrl, apiKey: "" };
        }
      }
      return {
        ...current,
        runtimeType,
        channel: runtimeType === "pi" ? "web" : current.channel,
        selectedSkillIds: runtimeType === "pi" ? [] : current.selectedSkillIds,
        modelStrategy,
        permissionConfirmed: false,
      };
    });
    setModelTest("idle");
    setModelTestMessage("");
  };

  const oauth = useProviderOAuth({
    provider: strategy.provider,
    enabled: isOAuthProvider,
    onComplete: (credential, refreshed) => {
      setCredentials(refreshed);
      const provider = resolveProviderRegistryKey(credential.provider || credential.type, undefined, credential.baseUrl);
      const config = providerRegistry[provider];
      setDraft((current) => ({
        ...current,
        permissionConfirmed: false,
        modelStrategy: {
          mode: "saved_credential",
          credentialId: credential.id,
          provider,
          model: config?.defaultModel || current.modelStrategy.model,
          baseUrl: credential.baseUrl || config?.defaultBaseUrl,
          isCustomModel: credential.isCustom,
        },
      }));
      setModelTest("idle");
      setModelTestMessage("");
    },
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const credentialResult = await api.get("/api/credentials");
        if (!active) return;
        const nextCredentials = Array.isArray(credentialResult) ? credentialResult : [];
        setCredentials(nextCredentials);
        if (nextCredentials.length > 0) {
          setDraft((current) => {
            if (current.runtimeType === "codex") return current;
            const selected = nextCredentials.find((credential) => {
              const provider = resolveProviderRegistryKey(credential.provider || credential.type, undefined, credential.baseUrl);
              return supportsQuickDeployRuntimeProvider(current.runtimeType, provider);
            });
            if (!selected) {
              const fallback = providerRegistry.deepseek;
              return {
                ...current,
                modelStrategy: { mode: "byok", provider: fallback.id, model: fallback.defaultModel, baseUrl: fallback.defaultBaseUrl, apiKey: "" },
              };
            }
            const provider = resolveProviderRegistryKey(selected.provider || selected.type, undefined, selected.baseUrl);
            const config = providerRegistry[provider];
            return {
              ...current,
              modelStrategy: {
                mode: "saved_credential",
                credentialId: selected.id,
                provider,
                model: config?.defaultModel || "",
                baseUrl: selected.baseUrl || config?.defaultBaseUrl,
                isCustomModel: selected.isCustom,
              },
            };
          });
        } else {
          setDraft((current) => ({
            ...current,
            modelStrategy: {
              mode: "byok",
              provider: current.modelStrategy.provider,
              model: current.modelStrategy.model,
              baseUrl: current.modelStrategy.baseUrl,
              apiKey: "",
            },
          }));
        }
      } catch (error: any) {
        if (active) setSubmitError(error?.message || t("quickDeploy.errors.optionsLoadFailed"));
      } finally {
        if (active) setOptionsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [currentUser, t]);

  useEffect(() => {
    const controller = new AbortController();
    setRuntimeCatalogState("loading");
    void fetchRuntimeCatalog(controller.signal)
      .then((result) => {
        setRuntimeDefinitions(result.runtimes.filter((runtime) => ["hermes", "pi", "codex"].includes(runtime.runtime.type)));
        setRuntimeCatalogState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setRuntimeCatalogState("error");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (currentUser?.role !== "admin") {
        setPreflight("ready");
        return;
      }
      try {
        const result = await api.get("/api/system/preflight");
        if (!active) return;
        const failures = Array.isArray(result?.checks) ? result.checks.filter((item: any) => item.status === "fail") : [];
        setPreflight(failures.length > 0 ? "blocked" : "ready");
        setPreflightMessage(failures.map((item: any) => item.name).join(", "));
      } catch (error: any) {
        if (active) {
          setPreflight("blocked");
          setPreflightMessage(error?.message || t("quickDeploy.errors.preflightFailed"));
        }
      }
    };
    void check();
    return () => { active = false; };
  }, [currentUser, t]);

  const selectCredential = (credentialId: string) => {
    const credential = compatibleCredentials.find((item) => item.id === credentialId);
    if (!credential) return;
    const provider = resolveProviderRegistryKey(credential.provider || credential.type, undefined, credential.baseUrl);
    const config = providerRegistry[provider];
    setDraft((current) => ({
      ...current,
      permissionConfirmed: false,
      modelStrategy: {
        mode: "saved_credential",
        credentialId,
        provider,
        model: config?.defaultModel || "",
        baseUrl: credential.baseUrl || config?.defaultBaseUrl,
        isCustomModel: credential.isCustom,
      },
    }));
    setModelTest("idle");
  };

  const selectMode = (mode: "saved_credential" | "byok") => {
    if (mode === "saved_credential" && compatibleCredentials.length > 0) {
      selectCredential(compatibleCredentials[0].id);
      return;
    }
    const provider = strategy.provider || "deepseek";
    const config = providerRegistry[provider] || providerRegistry.deepseek;
    setDraft((current) => ({
      ...current,
      permissionConfirmed: false,
      modelStrategy: { mode: "byok", provider: config.id, model: config.defaultModel, baseUrl: config.defaultBaseUrl, apiKey: "" },
    }));
    setModelTest("idle");
  };

  const selectProvider = (provider: string) => {
    const config = providerRegistry[provider];
    updateStrategy({ provider, model: config?.defaultModel || "", baseUrl: config?.defaultBaseUrl || "", isCustomModel: provider === "custom-openai-compatible" });
  };

  const testModel = async () => {
    setModelTest("testing");
    setModelTestMessage("");
    try {
      const result = await api.post("/api/system/test-llm", {
        runtimeType: draft.runtimeType,
        provider: strategy.provider,
        model: strategy.model,
        baseUrl: strategy.baseUrl,
        apiKey: strategy.mode === "byok" ? strategy.apiKey : undefined,
        credentialId: strategy.mode === "saved_credential" ? strategy.credentialId : undefined,
      });
      setModelTest(result?.success ? "passed" : "failed");
      setModelTestMessage(result?.error || result?.message || "");
    } catch (error: any) {
      setModelTest("failed");
      setModelTestMessage(error?.message || t("quickDeploy.errors.modelTestFailed"));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setSubmitError("");
    if (validationIssues.length > 0 || preflight !== "ready" || (modelNeedsTest && modelTest !== "passed")) return;
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const request = buildQuickDeploymentRequest({ draft, path, idempotencyKey });
      const result = await api.post(request.path, request.body, request.options);
      if (result?.initialDashboardCredentials) {
        sessionStorage.setItem(`one_time_credentials_instance_${result.id}`, JSON.stringify(result.initialDashboardCredentials));
      }
      setCreated(result);
      updateDraft({ codexAuthJson: undefined });
      onCreated(result);
    } catch (error: any) {
      setSubmitError(error?.message || t("quickDeploy.errors.createFailed"));
      submitLock.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  const issueText = (issue: QuickDeployValidationIssue) => t(`quickDeploy.validation.${issue.code}`);
  const modelReady = !modelNeedsTest || modelTest === "passed";

  if (created) {
    return (
      <QuickDeployDelivery
        created={created}
        onInstanceUpdated={onCreated}
        onOpenChat={onOpenChat}
        onViewInstances={onViewInstances}
      />
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <Sparkles className="h-3.5 w-3.5" />{t("quickDeploy.badge")}
          </div>
          <h1 className="text-2xl font-black text-content md:text-3xl">{t("quickDeploy.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-content-muted">{t("quickDeploy.description")}</p>
        </div>
        <Button type="button" variant="outline" disabled={isCodexRuntime} onClick={() => onAdvanced(buildQuickDeployAdvancedInitialData(draft, path))}>
          <Settings2 className="mr-2 h-4 w-4" />{t("quickDeploy.advanced")}
        </Button>
      </div>

      <Card className="mb-6 space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="font-bold text-content">{t("quickDeploy.runtime.title")}</h2>
          <p className="mt-1 text-xs leading-5 text-content-muted">{t("quickDeploy.runtime.description")}</p>
        </div>
        {runtimeCatalogState === "loading" && (
          <div className="flex items-center gap-2 rounded-xl border border-outline bg-surface-muted p-4 text-sm text-content-muted">
            <Loader2 className="h-4 w-4 animate-spin" />{t("quickDeploy.runtime.loading")}
          </div>
        )}
        {runtimeCatalogState === "error" && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{t("quickDeploy.runtime.loadError")}
          </div>
        )}
        {runtimeCatalogState === "ready" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {runtimeDefinitions.map((definition) => {
              const runtimeType = definition.runtime.type as "hermes" | "pi" | "codex";
              const selected = draft.runtimeType === runtimeType;
              const deployable = definition.release.deploymentSupported;
              return (
                <button
                  key={runtimeType}
                  type="button"
                  disabled={!deployable}
                  aria-pressed={selected}
                  onClick={() => selectRuntime(runtimeType)}
                  className={cn(
                    "relative rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40",
                    selected ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/15 dark:bg-indigo-950/30" : "border-outline bg-surface hover:border-outline-strong hover:bg-surface-muted/40",
                    !deployable && "cursor-not-allowed opacity-55",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className={cn("rounded-xl p-2.5", runtimeType === "pi" ? "bg-violet-500/10 text-violet-600 dark:text-violet-300" : "bg-blue-500/10 text-blue-600 dark:text-blue-300")}>
                      <AgentRuntimeIcon runtimeType={runtimeType} className="h-7 w-7" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-content">{definition.displayName}</span>
                      <span className="mt-0.5 block text-xs font-medium text-content-muted">{t(`quickDeploy.runtime.${runtimeType}Badge`)}</span>
                    </span>
                    {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" />}
                  </div>
                  <span className="mt-3 block text-xs leading-5 text-content-muted">{t(`quickDeploy.runtime.${runtimeType}Description`)}</span>
                  {!deployable && <span className="mt-2 block text-xs font-semibold text-amber-700 dark:text-amber-300">{t("quickDeploy.runtime.unavailable")}</span>}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <Card className="space-y-5 p-6">
            <div><h2 className="font-bold text-content">{t("quickDeploy.instance.title")}</h2><p className="mt-1 text-xs text-content-muted">{t("quickDeploy.instance.description")}</p></div>
            <div><Label htmlFor="quick-name">{t("quickDeploy.instance.name")}</Label><Input id="quick-name" value={draft.name} onChange={(event) => updateDraft({ name: event.target.value, permissionConfirmed: false })} /></div>
            <div><Label htmlFor="quick-purpose">{t("quickDeploy.instance.purpose")}</Label><textarea id="quick-purpose" value={draft.purpose} onChange={(event) => updateDraft({ purpose: event.target.value })} placeholder={t("quickDeploy.instance.purposePlaceholder")} className="mt-2 min-h-24 w-full rounded-lg border border-outline bg-control px-3 py-2 text-sm text-content outline-none focus:border-action focus:ring-2 focus:ring-focus-ring" /></div>
          </Card>

          <Card className="space-y-5 p-6">
            <div><h2 className="font-bold text-content">{t("quickDeploy.model.title")}</h2><p className="mt-1 text-xs text-content-muted">{t("quickDeploy.model.description")}</p></div>
            {isCodexRuntime && <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={isCodexAccount ? "primary" : "outline"} disabled={oauth.loading} onClick={() => updateDraft({ codexAuthMode: "chatgpt", codexAuthJson: undefined, permissionConfirmed: false, modelStrategy: { mode: "byok", provider: "openai", model: "", isCustomModel: true } })}>{t("quickDeploy.model.codexAccountMode")}</Button>
                <Button type="button" variant={!isCodexAccount ? "primary" : "outline"} disabled={oauth.loading} onClick={() => updateDraft({ codexAuthMode: "api", codexAuthJson: undefined, permissionConfirmed: false, modelStrategy: { mode: "byok", provider: "openai", model: providerRegistry.openai.defaultModel, baseUrl: providerRegistry.openai.defaultBaseUrl, apiKey: "" } })}>{t("quickDeploy.model.codexProviderMode")}</Button>
              </div>
              {!isCodexAccount && <p className="text-sm text-content-secondary">{t("quickDeploy.model.codexApiDescription")}</p>}
            </div>}
            {isCodexAccount ? <div className="space-y-3">
              <p className="text-sm text-content-secondary">{t("quickDeploy.model.codexAccountDescription")}</p>
              <Label htmlFor="codex-account-file">{t("quickDeploy.model.codexAccountFile")}</Label>
              <Input id="codex-account-file" type="file" accept="application/json,.json" onChange={async event => {
                const file = event.target.files?.[0];
                if (!file || file.size > 65536) { updateDraft({ codexAuthJson: undefined }); return; }
                updateDraft({ codexAuthJson: await file.text(), permissionConfirmed: false });
              }} />
            </div> : <>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={strategy.mode === "saved_credential" ? "primary" : "outline"} disabled={compatibleCredentials.length === 0 || oauth.loading} onClick={() => selectMode("saved_credential")}><KeyRound className="mr-2 h-4 w-4" />{t("quickDeploy.model.saved")}</Button>
              <Button type="button" variant={strategy.mode === "byok" ? "primary" : "outline"} disabled={oauth.loading} onClick={() => selectMode("byok")}><Zap className="mr-2 h-4 w-4" />{t("quickDeploy.model.byok")}</Button>
            </div>
            {strategy.mode === "saved_credential" ? (
              <div><Label>{t("quickDeploy.model.credential")}</Label><select value={strategy.credentialId} onChange={(event) => selectCredential(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-outline bg-control px-3 text-sm text-content">{compatibleCredentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} ({credential.type})</option>)}</select></div>
            ) : !isOAuthProvider ? (
              <div><Label>{t("quickDeploy.model.apiKey")}</Label><Input type="password" autoComplete="new-password" value={strategy.apiKey || ""} onChange={(event) => updateStrategy({ apiKey: event.target.value })} /></div>
            ) : null}
            <div><Label>{t("quickDeploy.model.provider")}</Label><ProviderSelect className="mt-2" value={strategy.provider} onValueChange={selectProvider} includeOAuth={!isNativeBridge || isCodexRuntime} allowedProviderIds={isCodexRuntime ? CODEX_QUICK_DEPLOY_PROVIDER_IDS : isNativeBridge ? PI_QUICK_DEPLOY_PROVIDER_IDS : undefined} disabled={strategy.mode === "saved_credential" || oauth.loading} /></div>
            {isOAuthProvider && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-900 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-100">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-semibold">{t("wizardCopy.model.oauthConnectTitle")}</p>
                    <p className="text-xs leading-5 opacity-80">{t("wizardCopy.model.oauthConnectDescription")}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={oauth.connect} disabled={oauth.loading || strategy.mode === "saved_credential"}>
                        {oauth.loading ? t("wizardCopy.model.oauthConnecting") : strategy.mode === "saved_credential" ? t("wizardCopy.model.oauthConnected") : t("wizardCopy.model.oauthConnect")}
                      </Button>
                      {oauth.loading && <Button type="button" variant="outline" onClick={() => oauth.cancel()}>{t("wizardCopy.model.oauthCancel")}</Button>}
                    </div>
                    {oauth.session?.userCode && <p className="font-mono text-xs">{t("wizardCopy.model.oauthCode")}: {oauth.session.userCode}</p>}
                    {oauth.error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{oauth.error}</p>}
                    {strategy.provider === "xai-oauth" && <p className="text-xs text-amber-700 dark:text-amber-300">{t("wizardCopy.model.xaiOAuthTierNotice")}</p>}
                  </div>
                </div>
              </div>
            )}
            </>}
            <div><Label>{t("quickDeploy.model.model")}</Label>{providerConfig?.models?.length && !strategy.isCustomModel ? <select value={strategy.model} onChange={(event) => updateStrategy({ model: event.target.value })} className="mt-2 h-11 w-full rounded-lg border border-outline bg-control px-3 text-sm text-content">{providerConfig.models.map((model) => <option key={model} value={model}>{model}</option>)}</select> : <Input value={strategy.model} onChange={(event) => updateStrategy({ model: event.target.value })} />}</div>
            {!isCodexAccount && !isOAuthProvider && (isCodexRuntime || strategy.provider === "custom-openai-compatible" || strategy.isCustomModel) && <div><Label>{t("quickDeploy.model.baseUrl")}</Label><Input value={strategy.baseUrl || ""} onChange={(event) => updateStrategy({ baseUrl: event.target.value })} /></div>}
            {modelNeedsTest && <Button type="button" variant="outline" onClick={testModel} disabled={modelTest === "testing" || optionsLoading}>{modelTest === "testing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}{modelTest === "passed" ? t("quickDeploy.model.testPassed") : t("quickDeploy.model.test")}</Button>}
            {modelTest === "failed" && <p className="text-sm text-danger">{modelTestMessage || t("quickDeploy.errors.modelTestFailed")}</p>}
          </Card>

          <Card className="space-y-5 p-6">
            <div><h2 className="font-bold text-content">{t("quickDeploy.channel.title")}</h2><p className="mt-1 text-xs leading-5 text-content-muted">{t(isCodexRuntime ? "quickDeploy.channel.codexDescription" : isNativeBridge ? "quickDeploy.channel.piDescription" : "quickDeploy.channel.description")}</p></div>
            <ChannelSelector
              selectedId={draft.channel}
              onSelect={selectChannel}
              channelIds={isNativeBridge ? ["web"] : ["web", "telegram", "feishu", "weixin"]}
              compact
            />
            {draft.channel !== "web" && (
              <div className="rounded-xl border border-outline bg-surface-muted/40 p-4">
                <p className="mb-4 text-xs leading-5 text-content-muted">{t("quickDeploy.channel.configurationHint")}</p>
                <ChannelManualConfigForm channel={draft.channel} data={draft} update={updateChannelField} />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-5 p-6">
            {isNativeBridge ? (
              <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/70 p-4 text-violet-900 dark:border-violet-500/30 dark:bg-violet-950/30 dark:text-violet-100">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                <div><h2 className="font-bold">{t(isCodexRuntime ? "quickDeploy.access.codexTitle" : "quickDeploy.access.piTitle")}</h2><p className="mt-1 text-xs leading-5 opacity-80">{t(isCodexRuntime ? "quickDeploy.access.codexDescription" : "quickDeploy.access.piDescription")}</p></div>
              </div>
            ) : (
              <>
                <div><h2 className="font-bold text-content">{t("quickDeploy.access.title")}</h2><p className="mt-1 text-xs text-content-muted">{t("quickDeploy.access.description")}</p></div>
                <div><Label>{t("quickDeploy.access.username")}</Label><Input value={draft.dashboardUsername} onChange={(event) => updateDraft({ dashboardUsername: event.target.value, permissionConfirmed: false })} /></div>
                <div><Label>{t("quickDeploy.access.password")}</Label><div className="relative"><Input type={showPassword ? "text" : "password"} value={draft.dashboardPassword} onChange={(event) => updateDraft({ dashboardPassword: event.target.value, permissionConfirmed: false })} className="pr-20" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-10 top-1/2 mt-0.5 -translate-y-1/2 text-content-muted">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" onClick={() => navigator.clipboard.writeText(draft.dashboardPassword)} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-content-muted"><Copy className="h-4 w-4" /></button></div></div>
              </>
            )}
          </Card>

          <Card className="space-y-4 p-6">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /><div><h2 className="font-bold text-content">{t("quickDeploy.review.title")}</h2><p className="mt-1 text-xs leading-5 text-content-muted">{t(isCodexRuntime ? "quickDeploy.review.codexDescription" : isNativeBridge ? "quickDeploy.review.piDescription" : "quickDeploy.review.description")}</p></div></div>
            <div className="space-y-2 rounded-xl bg-surface-muted p-4 text-sm text-content-secondary">
              <p className="flex items-center gap-2 font-semibold text-content">
                <AgentRuntimeIcon runtimeType={draft.runtimeType} className="h-6 w-6" />
                <span>{selectedRuntime?.displayName || draft.runtimeType}</span>
              </p>
              <p className="flex items-center gap-2">
                <ChannelBrandIcon channelId={draft.channel} className="h-5 w-5" />
                <span>{t("quickDeploy.review.resources", { channel: t(`wizardCopy.channelSelector.channels.${draft.channel}.name`) })}</span>
              </p>
              <p>{strategy.provider} · {strategy.model}</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-content-secondary"><input type="checkbox" checked={draft.permissionConfirmed} onChange={(event) => updateDraft({ permissionConfirmed: event.target.checked })} className="mt-1 h-4 w-4 rounded border-outline" /><span>{t("quickDeploy.review.confirm")}</span></label>
            {preflight === "blocked" && <div className="flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"><AlertCircle className="h-4 w-4 shrink-0" /><span>{t("quickDeploy.errors.preflightBlocked", { details: preflightMessage })}</span></div>}
            {submitted && !modelReady && <p className="text-sm text-danger">{t("quickDeploy.validation.modelTestRequired")}</p>}
            {visibleIssues.map((issue) => <p key={`${issue.code}-${issue.field}`} className="text-sm text-danger">{issueText(issue)}</p>)}
            {submitError && <p className="text-sm text-danger">{submitError}</p>}
            <Button type="submit" className="w-full" disabled={submitting || optionsLoading || preflight === "loading" || runtimeCatalogState !== "ready" || !selectedRuntime?.release.deploymentSupported}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{t(isCodexRuntime ? "quickDeploy.deployCodex" : isNativeBridge ? "quickDeploy.deployPi" : "quickDeploy.deploy")}</Button>
          </Card>
        </div>
      </div>
    </form>
  );
}

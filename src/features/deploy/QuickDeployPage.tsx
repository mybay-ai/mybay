import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Copy, Eye, EyeOff, KeyRound, Loader2, Settings2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { providerRegistry } from "../../../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../../../shared/providerRegistryUtils";
import { Button, Card, Input, Label } from "../../components/ui";
import { ProviderSelect } from "../../components/ProviderSelect";
import type { Credential, SetupFormData } from "../../types";
import { api } from "../../lib/api";
import { buildQuickDeployAdvancedInitialData } from "./quickDeployAdvancedHandoff";
import { buildQuickDeployPath, createQuickDeployDraft } from "./quickDeployConfig";
import { buildQuickDeploymentRequest } from "./quickDeploymentRequestAdapter";
import type { QuickDeployDraft, QuickDeployValidationIssue } from "./quickDeployTypes";
import { validateQuickDeployDraft } from "./quickDeployValidation";
import { requiresPredeployModelTest } from "./deployStepValidation";
import { QuickDeployDelivery } from "./QuickDeployDelivery";
import { useProviderOAuth } from "./useProviderOAuth";

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
  const providerConfig = providerRegistry[strategy.provider];
  const isOAuthProvider = providerConfig?.authMode === "oauth-device-code";
  const modelNeedsTest = requiresPredeployModelTest(strategy.provider);
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
          const selected = nextCredentials[0];
          const provider = resolveProviderRegistryKey(selected.provider || selected.type, undefined, selected.baseUrl);
          const config = providerRegistry[provider];
          setDraft((current) => ({
            ...current,
            modelStrategy: {
              mode: "saved_credential",
              credentialId: selected.id,
              provider,
              model: config?.defaultModel || "",
              baseUrl: selected.baseUrl || config?.defaultBaseUrl,
              isCustomModel: selected.isCustom,
            },
          }));
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
    const credential = credentials.find((item) => item.id === credentialId);
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
    if (mode === "saved_credential" && credentials.length > 0) {
      selectCredential(credentials[0].id);
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
        <Button type="button" variant="outline" onClick={() => onAdvanced(buildQuickDeployAdvancedInitialData(draft, path))}>
          <Settings2 className="mr-2 h-4 w-4" />{t("quickDeploy.advanced")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <Card className="space-y-5 p-6">
            <div><h2 className="font-bold text-content">{t("quickDeploy.instance.title")}</h2><p className="mt-1 text-xs text-content-muted">{t("quickDeploy.instance.description")}</p></div>
            <div><Label htmlFor="quick-name">{t("quickDeploy.instance.name")}</Label><Input id="quick-name" value={draft.name} onChange={(event) => updateDraft({ name: event.target.value, permissionConfirmed: false })} /></div>
            <div><Label htmlFor="quick-purpose">{t("quickDeploy.instance.purpose")}</Label><textarea id="quick-purpose" value={draft.purpose} onChange={(event) => updateDraft({ purpose: event.target.value })} placeholder={t("quickDeploy.instance.purposePlaceholder")} className="mt-2 min-h-24 w-full rounded-lg border border-outline bg-control px-3 py-2 text-sm text-content outline-none focus:border-action focus:ring-2 focus:ring-focus-ring" /></div>
          </Card>

          <Card className="space-y-5 p-6">
            <div><h2 className="font-bold text-content">{t("quickDeploy.model.title")}</h2><p className="mt-1 text-xs text-content-muted">{t("quickDeploy.model.description")}</p></div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={strategy.mode === "saved_credential" ? "primary" : "outline"} disabled={credentials.length === 0} onClick={() => selectMode("saved_credential")}><KeyRound className="mr-2 h-4 w-4" />{t("quickDeploy.model.saved")}</Button>
              <Button type="button" variant={strategy.mode === "byok" ? "primary" : "outline"} onClick={() => selectMode("byok")}><Zap className="mr-2 h-4 w-4" />{t("quickDeploy.model.byok")}</Button>
            </div>
            {strategy.mode === "saved_credential" ? (
              <div><Label>{t("quickDeploy.model.credential")}</Label><select value={strategy.credentialId} onChange={(event) => selectCredential(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-outline bg-control px-3 text-sm text-content">{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} ({credential.type})</option>)}</select></div>
            ) : !isOAuthProvider ? (
              <div><Label>{t("quickDeploy.model.apiKey")}</Label><Input type="password" autoComplete="new-password" value={strategy.apiKey || ""} onChange={(event) => updateStrategy({ apiKey: event.target.value })} /></div>
            ) : null}
            <div><Label>{t("quickDeploy.model.provider")}</Label><ProviderSelect className="mt-2" value={strategy.provider} onValueChange={selectProvider} includeOAuth disabled={strategy.mode === "saved_credential" || oauth.loading} /></div>
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
            <div><Label>{t("quickDeploy.model.model")}</Label>{providerConfig?.models?.length && !strategy.isCustomModel ? <select value={strategy.model} onChange={(event) => updateStrategy({ model: event.target.value })} className="mt-2 h-11 w-full rounded-lg border border-outline bg-control px-3 text-sm text-content">{providerConfig.models.map((model) => <option key={model} value={model}>{model}</option>)}</select> : <Input value={strategy.model} onChange={(event) => updateStrategy({ model: event.target.value })} />}</div>
            {(strategy.provider === "custom-openai-compatible" || strategy.isCustomModel) && <div><Label>{t("quickDeploy.model.baseUrl")}</Label><Input value={strategy.baseUrl || ""} onChange={(event) => updateStrategy({ baseUrl: event.target.value })} /></div>}
            {modelNeedsTest && <Button type="button" variant="outline" onClick={testModel} disabled={modelTest === "testing" || optionsLoading}>{modelTest === "testing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}{modelTest === "passed" ? t("quickDeploy.model.testPassed") : t("quickDeploy.model.test")}</Button>}
            {modelTest === "failed" && <p className="text-sm text-danger">{modelTestMessage || t("quickDeploy.errors.modelTestFailed")}</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-5 p-6">
            <div><h2 className="font-bold text-content">{t("quickDeploy.access.title")}</h2><p className="mt-1 text-xs text-content-muted">{t("quickDeploy.access.description")}</p></div>
            <div><Label>{t("quickDeploy.access.username")}</Label><Input value={draft.dashboardUsername} onChange={(event) => updateDraft({ dashboardUsername: event.target.value, permissionConfirmed: false })} /></div>
            <div><Label>{t("quickDeploy.access.password")}</Label><div className="relative"><Input type={showPassword ? "text" : "password"} value={draft.dashboardPassword} onChange={(event) => updateDraft({ dashboardPassword: event.target.value, permissionConfirmed: false })} className="pr-20" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-10 top-1/2 mt-0.5 -translate-y-1/2 text-content-muted">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" onClick={() => navigator.clipboard.writeText(draft.dashboardPassword)} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-content-muted"><Copy className="h-4 w-4" /></button></div></div>
          </Card>

          <Card className="space-y-4 p-6">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /><div><h2 className="font-bold text-content">{t("quickDeploy.review.title")}</h2><p className="mt-1 text-xs leading-5 text-content-muted">{t("quickDeploy.review.description")}</p></div></div>
            <div className="rounded-xl bg-surface-muted p-4 text-sm text-content-secondary"><p>{t("quickDeploy.review.runtime")}</p><p>{t("quickDeploy.review.resources")}</p><p>{strategy.provider} · {strategy.model}</p></div>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-content-secondary"><input type="checkbox" checked={draft.permissionConfirmed} onChange={(event) => updateDraft({ permissionConfirmed: event.target.checked })} className="mt-1 h-4 w-4 rounded border-outline" /><span>{t("quickDeploy.review.confirm")}</span></label>
            {preflight === "blocked" && <div className="flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"><AlertCircle className="h-4 w-4 shrink-0" /><span>{t("quickDeploy.errors.preflightBlocked", { details: preflightMessage })}</span></div>}
            {submitted && !modelReady && <p className="text-sm text-danger">{t("quickDeploy.validation.modelTestRequired")}</p>}
            {visibleIssues.map((issue) => <p key={`${issue.code}-${issue.field}`} className="text-sm text-danger">{issueText(issue)}</p>)}
            {submitError && <p className="text-sm text-danger">{submitError}</p>}
            <Button type="submit" className="w-full" disabled={submitting || optionsLoading || preflight === "loading"}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{t("quickDeploy.deploy")}</Button>
          </Card>
        </div>
      </div>
    </form>
  );
}

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, RefreshCw, Server, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Card } from "../../components/ui";
import { api } from "../../lib/api";
import { InstanceReadinessNotice } from "../../components/instance-runtime/InstanceReadinessNotice";
import { deriveQuickDeployReadiness, type QuickReadinessStage } from "./quickDeployReadiness";
import { quickDeployProgressPercent, shouldContinueQuickDeployPolling, shouldProbeQuickDeployChat } from "./quickDeployDeliveryState";
import { getQuickDeployStatusTranslationKey } from "./quickDeployStatusLabel";

interface QuickDeployDeliveryProps {
  created: any;
  onInstanceUpdated: (instance: any) => void;
  onOpenChat: (instanceId: string) => void;
  onViewInstances: () => void;
}

function toneClass(tone: QuickReadinessStage["tone"]) {
  if (tone === "ready") return "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/70 dark:bg-emerald-950/30";
  if (tone === "attention") return "border-amber-200 bg-amber-50/70 dark:border-amber-800/70 dark:bg-amber-950/30";
  if (tone === "failed") return "border-red-200 bg-red-50/70 dark:border-red-800/70 dark:bg-red-950/30";
  return "border-blue-200 bg-blue-50/50 dark:border-blue-800/70 dark:bg-blue-950/30";
}

function StageIcon({ tone }: { tone: QuickReadinessStage["tone"] }) {
  if (tone === "ready") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (tone === "attention" || tone === "failed") return <AlertCircle className={`h-5 w-5 ${tone === "failed" ? "text-red-600" : "text-amber-600"}`} />;
  return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />;
}

export function QuickDeployDelivery({ created, onInstanceUpdated, onOpenChat, onViewInstances }: QuickDeployDeliveryProps) {
  const { t } = useTranslation("deploy");
  const taskId = created?.deploymentTaskId;
  const instanceId = created?.instanceId || created?.id;
  const [deployment, setDeployment] = useState<any>({
    status: created?.status || "queued",
    instanceStatus: created?.status || "deploying",
    currentStep: "queued",
    progress: 5,
  });
  const [instance, setInstance] = useState<any>(created);
  const [chatReadiness, setChatReadiness] = useState<any>(null);
  const [pollExpired, setPollExpired] = useState(false);
  const [pollError, setPollError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);

  const readiness = useMemo(
    () => deriveQuickDeployReadiness(deployment, instance, chatReadiness),
    [chatReadiness, deployment, instance],
  );

  useEffect(() => {
    if (!taskId || !instanceId) return;
    let stopped = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    setPollExpired(false);
    setPollError("");

    const poll = async () => {
      try {
        const nextDeployment = await api.get(`/api/deployments/${encodeURIComponent(taskId)}`);
        if (stopped) return;
        setDeployment(nextDeployment);

        let nextInstance = instance;
        let nextChatReadiness = chatReadiness;
        if (nextDeployment?.status === "success") {
          nextInstance = await api.get(`/api/instances/${encodeURIComponent(instanceId)}`);
          if (stopped) return;
          setInstance(nextInstance);
          onInstanceUpdated(nextInstance);
          if (shouldProbeQuickDeployChat(nextDeployment, nextInstance)) {
            try {
              nextChatReadiness = { ...await api.get(`/api/instances/${encodeURIComponent(instanceId)}/chat-readiness`), checkedAt: new Date().toISOString(), probeStatus: "checked" };
            } catch (error: any) {
              nextChatReadiness = { ready: false, reason: error?.code || "PROBE_FAILED", message: error?.message, checkedAt: new Date().toISOString(), probeStatus: "failed" };
            }
            if (stopped) return;
            setChatReadiness(nextChatReadiness);
          }
        }

        const nextReadiness = deriveQuickDeployReadiness(nextDeployment, nextInstance, nextChatReadiness);
        const elapsed = Date.now() - startedAt;
        if (shouldContinueQuickDeployPolling(nextReadiness, elapsed)) {
          timer = window.setTimeout(poll, 1_500);
        } else if (!nextReadiness.terminal) {
          setPollExpired(true);
        }
      } catch (error: any) {
        if (stopped) return;
        setPollError(error?.message || t("quickDeploy.delivery.pollFailed"));
        if (Date.now() - startedAt < 5 * 60 * 1000) timer = window.setTimeout(poll, 2_500);
        else setPollExpired(true);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [instanceId, retryRevision, taskId]);

  const retry = async () => {
    if (!taskId || deployment?.status !== "failed") return;
    setRetrying(true);
    setPollError("");
    try {
      const result = await api.post(`/api/deployments/${encodeURIComponent(taskId)}/retry`);
      setDeployment({ ...deployment, ...result, status: "retry_wait", currentStep: "queued", progress: 5, errorCode: null, errorMessage: null });
      setInstance((current: any) => ({ ...current, status: "provisioning" }));
      setChatReadiness(null);
      setRetryRevision((value) => value + 1);
    } catch (error: any) {
      setPollError(error?.message || t("quickDeploy.delivery.retryFailed"));
    } finally {
      setRetrying(false);
    }
  };

  const failed = readiness.runtime.tone === "failed";
  const ready = readiness.runtime.tone === "ready" && readiness.chat.tone === "ready";
  const stepLabel = t(`wizardCopy.review.deploymentProgress.steps.${deployment?.currentStep || "queued"}`, {
    defaultValue: t("wizardCopy.review.deploymentProgress.processing"),
  });
  const progress = quickDeployProgressPercent(deployment?.progress);
  const runtimeReason = readiness.runtime.reason ? String(readiness.runtime.reason) : "";
  const chatReason = readiness.chat.reason ? String(readiness.chat.reason) : "";
  const runtimeReasonKey = getQuickDeployStatusTranslationKey(runtimeReason);
  const runtimeReasonLabel = runtimeReasonKey ? t(runtimeReasonKey) : runtimeReason;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-7 text-center">
        <h1 className="text-2xl font-black text-content">{ready ? t("quickDeploy.delivery.readyTitle") : failed ? t("quickDeploy.delivery.failedTitle") : t("quickDeploy.delivery.title")}</h1>
        <p className="mt-2 text-sm text-content-muted">{ready ? t("quickDeploy.delivery.readyDescription") : failed ? t("quickDeploy.delivery.failedDescription") : t("quickDeploy.delivery.description")}</p>
      </div>

      <Card className={`p-6 ${failed ? "border-red-200" : "border-blue-200"}`}>
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-wider text-content-muted">{t("quickDeploy.delivery.task")}</p><p className="mt-1 font-bold text-content">{failed ? deployment?.errorMessage || deployment?.errorCode || t("quickDeploy.delivery.failedStage") : stepLabel}</p></div>
          <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-bold text-content-secondary">{progress}%</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950"><div className={`h-full transition-all ${failed ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${progress}%` }} /></div>
        {deployment?.attempt > 0 && <p className="mt-3 text-xs text-content-muted">{t("quickDeploy.delivery.attempt", { current: deployment.attempt, max: deployment.maxAttempts })}</p>}
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className={`rounded-2xl border p-5 ${toneClass(readiness.runtime.tone)}`}><div className="flex items-center gap-3"><StageIcon tone={readiness.runtime.tone} /><div><p className="font-bold text-content">{t("quickDeploy.delivery.runtimeTitle")}</p><p className="mt-1 text-xs text-content-muted">{t(`quickDeploy.delivery.tones.${readiness.runtime.tone}`)}</p></div></div>{runtimeReasonLabel && <p className="mt-3 break-words font-mono text-xs text-content-muted">{runtimeReasonLabel}</p>}</div>
        <div className={`rounded-2xl border p-5 ${toneClass(readiness.chat.tone)}`}><div className="flex items-center gap-3"><StageIcon tone={readiness.chat.tone} /><div><p className="font-bold text-content">{t("quickDeploy.delivery.chatTitle")}</p><p className="mt-1 text-xs text-content-muted">{t(`quickDeploy.delivery.tones.${readiness.chat.tone}`)}</p></div></div>{chatReason && <p className="mt-3 break-words text-xs text-content-muted">{chatReason}</p>}</div>
      </div>

      {(pollError || pollExpired) && <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{pollExpired ? t("quickDeploy.delivery.pollExpired") : pollError}</span></div>}

      <div className="mt-5"><InstanceReadinessNotice instance={{ ...instance, id: instanceId, status: instance?.status || deployment?.instanceStatus || "deploying" }} chatReadiness={chatReadiness} onProbe={setChatReadiness} onOpenDiagnostics={onViewInstances} /></div>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {deployment?.status === "failed" && <Button type="button" onClick={retry} disabled={retrying}>{retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{t("quickDeploy.delivery.retry")}</Button>}
        {ready && <Button type="button" onClick={() => onOpenChat(instanceId)}><MessageSquare className="mr-2 h-4 w-4" />{t("quickDeploy.delivery.openChat")}</Button>}
        <Button type="button" variant={ready ? "outline" : "primary"} onClick={onViewInstances}>{failed ? <Settings2 className="mr-2 h-4 w-4" /> : <Server className="mr-2 h-4 w-4" />}{t("quickDeploy.delivery.viewInstances")}</Button>
      </div>
    </div>
  );
}

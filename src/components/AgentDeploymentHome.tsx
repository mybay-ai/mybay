import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, ArrowRight, Bot, CheckCircle2, Circle, KeyRound, Loader2, MessageSquare, Rocket, Server, TriangleAlert } from "lucide-react";
import type { AgentInstance } from "../types";
import { APP_ROUTES } from "../constants/routes";
import { api } from "../lib/api";
import { Button, Card } from "./ui";

interface JourneyStep { key: "environment" | "credential" | "deployment" | "acceptance"; done: boolean; status: "complete" | "pending" | "attention"; reason: string; }
interface JourneyState { steps: JourneyStep[]; completed: number; total: number; }
interface AgentDeploymentHomeProps { currentUser: any; instances: AgentInstance[]; onTabChange: (tab: string) => void; }

export function AgentDeploymentHome({ instances, onTabChange }: AgentDeploymentHomeProps) {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const zh = i18n.resolvedLanguage?.startsWith("zh") ?? true;
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(true);
  const instanceFingerprint = instances.map((item: any) => `${item.id}:${item.status}:${item.health_status || ""}`).join("|");

  useEffect(() => {
    let cancelled = false;
    setJourneyLoading(true);
    api.get("/api/system/deployment-journey")
      .then((result) => { if (!cancelled) setJourney(result); })
      .catch((error) => { console.error("Failed to load deployment journey:", error); if (!cancelled) setJourney(null); })
      .finally(() => { if (!cancelled) setJourneyLoading(false); });
    return () => { cancelled = true; };
  }, [instanceFingerprint]);

  const summary = useMemo(() => {
    const active = instances.filter((item: any) => !item.archived_at && item.status !== "archived");
    const healthy = active.filter((item: any) => item.health_status === "healthy" && ["running", "gateway_ready"].includes(String(item.status || "")));
    const deploying = active.filter((item: any) => ["queued", "deploying", "gateway_starting", "health_checking"].includes(String(item.status || "")));
    const attention = active.filter((item: any) => ["failed", "error", "unhealthy", "stopped"].includes(String(item.health_status || item.status || "")));
    return { active, healthy, deploying, attention };
  }, [instances]);
  const hasInstances = summary.active.length > 0;
  const stateFor = (key: JourneyStep["key"]) => journey?.steps.find((step) => step.key === key);
  const steps = [
    { key: "environment" as const, title: zh ? "确认本地运行环境" : "Check the local runtime", description: zh ? "通过 Docker、端口池和内部路由的真实预检。" : "Pass live Docker, port-pool, and internal-routing checks.", action: () => navigate(APP_ROUTES.DEPLOY) },
    { key: "credential" as const, title: zh ? "添加并验证模型凭据" : "Add and verify a model credential", description: zh ? "保存本机加密的 BYOK 凭据，并通过真实模型连接测试。" : "Save a locally encrypted BYOK credential and pass a live model connection test.", action: () => onTabChange("credentials") },
    { key: "deployment" as const, title: zh ? "部署第一个 Agent" : "Deploy your first Agent", description: zh ? "实例必须完成部署并通过运行健康检查。" : "The instance must finish deployment and pass runtime health checks.", action: () => navigate(APP_ROUTES.DEPLOY) },
    { key: "acceptance" as const, title: zh ? "验证对话与渠道" : "Verify chat and channels", description: zh ? "完成一次真实 Web 对话；外部渠道还需确认真实收发。" : "Complete a real Web chat; external channels also require confirmed messaging.", action: () => navigate(APP_ROUTES.CHAT_WORKSPACE) },
  ].map((step) => ({ ...step, done: stateFor(step.key)?.done === true, status: stateFor(step.key)?.status || "pending" }));

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 p-6 text-white shadow-sm sm:p-8"><div className="max-w-3xl space-y-4"><div className="inline-flex items-center gap-2 rounded-full bg-surface/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/20"><Rocket className="h-3.5 w-3.5" />{zh ? "本地 Agent 部署中心" : "Local Agent deployment center"}</div><div><h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{hasInstances ? (zh ? "管理并扩展你的 Agent" : "Manage and expand your Agents") : (zh ? "从这里部署你的第一个 Agent" : "Deploy your first Agent from here")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50">{zh ? "完成环境预检、凭据配置、实例部署和真实验收。进度只依据后端检测结果。" : "Complete preflight, credentials, deployment, and real acceptance. Progress comes only from backend checks."}</p></div><div className="flex flex-wrap gap-3"><Button onClick={() => navigate(APP_ROUTES.DEPLOY)} className="bg-slate-950/80 text-white shadow-md shadow-indigo-950/20 hover:bg-slate-950 hover:text-white"><Rocket className="h-4 w-4" />{zh ? "部署 Agent" : "Deploy Agent"}<ArrowRight className="h-4 w-4" /></Button>{hasInstances && <Button variant="outline" onClick={() => navigate(APP_ROUTES.INSTANCES)} className="border-white/40 bg-surface/10 text-white hover:bg-surface/20"><Bot className="h-4 w-4" />{zh ? "查看实例" : "View instances"}</Button>}</div></div></section>
    {hasInstances && <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatusCard icon={Server} label={zh ? "Agent 实例" : "Agent instances"} value={summary.active.length} tone="slate" /><StatusCard icon={CheckCircle2} label={zh ? "运行正常" : "Healthy"} value={summary.healthy.length} tone="green" /><StatusCard icon={Activity} label={zh ? "部署中" : "Deploying"} value={summary.deploying.length} tone="blue" /><StatusCard icon={TriangleAlert} label={zh ? "需要处理" : "Needs attention"} value={summary.attention.length} tone={summary.attention.length ? "amber" : "slate"} /></section>}
    <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]"><Card className="p-5 sm:p-6"><div className="mb-5 flex items-center justify-between gap-3"><div><h3 className="font-bold text-content">{zh ? "部署进度" : "Deployment journey"}</h3><p className="mt-1 text-xs text-content-muted">{zh ? "每个完成状态均来自真实检测或验收记录。" : "Every completed state comes from a live check or acceptance record."}</p></div><span className="flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300">{journeyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{journey?.completed || 0}/{journey?.total || 4}</span></div><div className="space-y-2">{steps.map((step, index) => <button type="button" key={step.key} onClick={step.action} className="group flex w-full items-start gap-3 rounded-xl border border-outline p-3 text-left transition-colors duration-200 hover:border-brand-300 hover:bg-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:hover:border-brand-400/60"><div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${step.done ? "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-emerald-400/35" : step.status === "attention" ? "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/35" : "bg-control-hover text-content-secondary ring-outline"}`}>{step.done ? <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} /> : step.status === "attention" ? <TriangleAlert className="h-4 w-4" strokeWidth={2.25} /> : <Circle className="h-4 w-4" strokeWidth={2.25} />}</div><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-content">{index + 1}. {step.title}</div><div className="mt-0.5 text-xs leading-5 text-content-muted">{step.description}</div></div><ArrowRight className="mt-1 h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600 dark:text-slate-300 dark:group-hover:text-brand-300" strokeWidth={2.25} /></button>)}</div></Card><div className="space-y-4"><QuickAction icon={KeyRound} title={zh ? "模型凭据" : "Model credentials"} description={zh ? "添加或轮换 BYOK API Key" : "Add or rotate BYOK API keys"} onClick={() => onTabChange("credentials")} /><QuickAction icon={MessageSquare} title={zh ? "消息渠道" : "Messaging channels"} description={zh ? "配置、连接并完成真实消息验收" : "Configure, connect, and accept real messaging"} onClick={() => navigate(hasInstances ? APP_ROUTES.INSTANCES : APP_ROUTES.DEPLOY)} /><QuickAction icon={Server} title={zh ? "实例运行状态" : "Instance runtime"} description={zh ? "查看部署、日志、诊断与恢复" : "Review deployment, logs, diagnostics, and recovery"} onClick={() => navigate(APP_ROUTES.INSTANCES)} /></div></section>
  </div>;
}
function StatusCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: "slate" | "green" | "blue" | "amber" }) { const tones = { slate: "bg-surface-muted text-content-secondary border-outline", green: "bg-emerald-50 text-emerald-700 border-emerald-200", blue: "bg-blue-50 text-blue-700 border-blue-200", amber: "bg-amber-50 text-amber-700 border-amber-200" }; return <div className={`rounded-xl border p-4 ${tones[tone]}`}><div className="flex items-center gap-2 text-xs font-semibold"><Icon className="h-4 w-4" />{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>; }
function QuickAction({ icon: Icon, title, description, onClick }: { icon: any; title: string; description: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 rounded-xl border border-outline bg-surface p-4 text-left shadow-sm transition-colors duration-200 hover:border-brand-300 hover:bg-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:hover:border-brand-400/60"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-400/15 dark:text-indigo-300 dark:ring-indigo-400/30"><Icon className="h-5 w-5" strokeWidth={2.25} /></div><div className="min-w-0 flex-1"><div className="text-sm font-bold text-content">{title}</div><div className="mt-0.5 text-xs leading-5 text-content-muted">{description}</div></div><ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600 dark:text-slate-300 dark:group-hover:text-brand-300" strokeWidth={2.25} /></button>; }

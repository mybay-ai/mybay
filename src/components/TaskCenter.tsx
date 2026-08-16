import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Play, CheckCircle2, AlertCircle, Clock, Power, Terminal, ArrowRight, RefreshCw, Sliders, Calendar, Sparkles, Database, ExternalLink, X } from "lucide-react";
import { Button, Card, Label, Input } from "./ui";
import Markdown from "react-markdown";

interface TaskCenterProps {
  currentUser: any;
  instances: any[];
}

export function TaskCenter({ currentUser, instances }: TaskCenterProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [notif, setNotif] = useState<{ type: "success" | "error"; text: string; actionUrl?: string; actionText?: string } | null>(null);
  const navigate = useNavigate();

  // States for preview modal
  const [previewTask, setPreviewTask] = useState<any | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [currentUser]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const headers: Record<string, string> = {};
      const token = currentUser?.token;
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const [tasksRes, jobsRes] = await Promise.all([
        fetch("/api/tasks", { headers }),
        fetch("/api/scheduled-jobs", { headers })
      ]);

      if (tasksRes.ok && jobsRes.ok) {
        setTasks(await tasksRes.json());
        setJobs(await jobsRes.json());
      }
    } catch (e: any) {
      console.error("加载任务错误:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerTask = async (taskId: string) => {
    setActioningId(taskId);
    setNotif(null);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/tasks/${taskId}/trigger`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (res.ok) {
        setNotif({ type: "success", text: data.message || "手动触发调度任务下发成功！" });
        // Refresh local items
        const updatedTasks = tasks.map(t => {
          if (t.id === taskId) {
            return { ...t, status: "processing", updated_at: new Date().toISOString() };
          }
          return t;
        });
        setTasks(updatedTasks);
        
        // Polling emulation refresh (Extended to 8 seconds for real computation)
        setTimeout(() => {
          fetchData();
        }, 8000);
      } else {
        if (data.needsSetupUrl) {
          setNotif({ type: "error", text: data.message || data.error || "请先完成业务配置后再执行该任务。", actionUrl: `/app/instances/${data.instanceId}/setup?section=${data.setupSection || "shop-monitor"}`, actionText: "去配置" });
        } else {
          setNotif({ type: "error", text: data.error || "请求派发异常，请校验实例状态后再试。" });
        }
      }
    } catch (err: any) {
      setNotif({ type: "error", text: "调度接口请求失败: " + err.message });
    } finally {
      setActioningId(null);
    }
  };

  const handleToggleJob = async (jobId: string) => {
    setNotif(null);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/scheduled-jobs/${jobId}/toggle`, {
        method: "POST",
        headers
      });
      if (res.ok) {
        const updated = await res.json();
        setNotif({ type: "success", text: `定时自动调度状态已变更为: ${updated.is_active ? "已启动 🟢" : "已暂停 ⏸️"}` });
        setJobs(jobs.map(j => j.id === jobId ? { ...j, is_active: updated.is_active } : j));
      } else {
        const errData = await res.json();
        if (errData.needsSetupUrl) {
          setNotif({ type: "error", text: errData.message || errData.error || "请先完成业务配置后再启用定时任务。", actionUrl: `/app/instances/${errData.instanceId}/setup?section=${errData.setupSection || "shop-monitor"}`, actionText: "去配置" });
        } else {
          setNotif({ type: "error", text: errData.error || "状态修改失败。" });
        }
      }
    } catch (err: any) {
      setNotif({ type: "error", text: "接口请求校验失败: " + err.message });
    }
  };

  const getResultObj = (task: any) => {
    if (!task.result) return null;
    if (typeof task.result === "string") {
      try {
        return JSON.parse(task.result);
      } catch {
        return null;
      }
    }
    return task.result;
  };

  const isConfigRequiredTask = (task: any) => task?.status === "config_required";
  const getTaskSetupUrl = (task: any) => {
    const section = task?.input_payload?.workflow_readiness?.setup_section || "shop-monitor";
    return `/app/instances/${task.instance_id}/setup?section=${section}`;
  };
  const getTaskStatusText = (task: any) => {
    if (task.status === "success") return "已就绪";
    if (task.status === "processing") return "执行中";
    if (task.status === "failed") return "已失败";
    if (task.status === "config_required") return "待配置";
    return "已创建，待用户手动触发";
  };
  const getTaskStatusClass = (task: any) => {
    if (task.status === "success") return "bg-green-50 border-green-200 text-green-705";
    if (task.status === "processing") return "bg-blue-50 border-blue-200 text-blue-705 animate-pulse";
    if (task.status === "failed") return "bg-rose-50 border-rose-200 text-rose-705";
    if (task.status === "config_required") return "bg-amber-50 border-amber-200 text-amber-800";
    return "bg-surface-muted border-outline text-content-secondary";
  };
  const getTaskStatusDotClass = (task: any) => {
    if (task.status === "success") return "bg-green-500";
    if (task.status === "processing") return "bg-blue-500 animate-ping";
    if (task.status === "failed") return "bg-rose-500";
    if (task.status === "config_required") return "bg-amber-500";
    return "bg-slate-400";
  };

  const handleViewResult = async (task: any) => {
    const resultObj = getResultObj(task);
    
    // Reset all states
    setPreviewTask(task);
    setPreviewContent("");
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewWarning(null);

    // 1. Prioritize displaying in-db results: markdown / content / full_content
    const directMarkdown = resultObj?.markdown || resultObj?.content || resultObj?.full_content;
    if (directMarkdown) {
      setPreviewContent(directMarkdown);
      return;
    }

    // 2. Otherwise read from the backend task result API
    const path = resultObj?.output_file;
    if (!path) {
      // If there is no output file path, fallback to content_preview if available
      if (resultObj?.content_preview) {
        setPreviewContent(resultObj.content_preview);
        setPreviewWarning("未指定文件，仅显示摘要预览。");
      } else {
        setPreviewError("该任务尚未生成成功，或未包含合法的结果报告。");
      }
      return;
    }

    setPreviewLoading(true);

    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/tasks/${task.id}/result`, { headers });
      
      if (!res.ok) {
        // 3. Fallback on 404 (or other errors) to content_preview if available
        if (res.status === 404 && resultObj?.content_preview) {
          setPreviewContent(resultObj.content_preview);
          setPreviewWarning("完整报告文件暂不可用，仅显示摘要预览。");
          return;
        }
        throw new Error(`远程文件服务器返回不符合预期：HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.error) {
        if (resultObj?.content_preview) {
          setPreviewContent(resultObj.content_preview);
          setPreviewWarning("完整报告文件暂不可用，仅显示摘要预览。");
          return;
        }
        throw new Error(data.error);
      }

      setPreviewContent(data.markdown || "");
      if (data.warning) {
        setPreviewWarning(data.warning);
      }
    } catch (err: any) {
      console.error("加载成果报告失败:", err);
      // 4. Fallback on catch
      if (resultObj?.content_preview) {
        setPreviewContent(resultObj.content_preview);
        setPreviewWarning("完整报告文件暂不可用，仅显示摘要预览。");
      } else {
        setPreviewError(err.message || "文件加载错误。可能大模型写入文件尚处于同步缓存中，请稍后再试。");
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const getTaskTemplateMeta = (templateId: string) => {
    const tid = String(templateId || "").toLowerCase();
    if (tid.includes("xiaohongshu")) {
      return {
        btnText: "查看小红书选题报告",
        processingText: "小红书选题爆款笔记生成中，正在为您深度策划选题大纲、正文大爆钩子及笔记草稿模版...",
        modalTitle: "小红书爆款选题策划报告"
      };
    }
    if (tid.includes("daily-news") || tid.includes("dailynews")) {
      return {
        btnText: "查看每日热点简报",
        processingText: "正在生成最新核心行业资讯、提取趋势发现并生成今日行业早报...",
        modalTitle: "智能行业简报"
      };
    }
    if (tid.includes("competitor-price") || tid.includes("competitorprice")) {
      return {
        btnText: "查看价格分析报告",
        processingText: "正在运行沙箱模拟分析、评估商品价格偏离值并编写模拟分析预警简报...",
        modalTitle: "沙箱模拟价格分析报告"
      };
    }
    if (tid.includes("pdf")) {
      return {
        btnText: "查看PDF解析成果",
        processingText: "正在深度研读PDF文档、抽取章节要点、提炼高管速读总结...",
        modalTitle: "PDF 文档深度提炼与速读报告"
      };
    }
    if (tid.includes("lead-form") || tid.includes("leadform")) {
      return {
        btnText: "查看表单自动回复",
        processingText: "正在根据客户意向表单匹配首位首封专业答复信并生成多渠道触达方案...",
        modalTitle: "意向客户首封专业回复信与触达方案"
      };
    }
    if (tid.includes("ecommerce")) {
      return {
        btnText: "查看电商订单异动",
        processingText: "正在排查电商大额异动订单、诊断可能风险并自动起草跨部门协同备忘...",
        modalTitle: "大额交易异动订单诊断分析与协同备忘"
      };
    }
    if (tid.includes("feishu")) {
      return {
        btnText: "查看飞书群日报",
        processingText: "正在运行飞书消息总结分析、梳理高频讨论话题、抽取协同待办大纲（真实群聊读取需完成渠道授权）...",
        modalTitle: "飞书消息总结报告（真实群聊读取需完成渠道授权）"
      };
    }
    if (tid.includes("short-video") || tid.includes("shortvideo")) {
      return {
        btnText: "查看分镜脚本报告",
        processingText: "正在拆解短视频分镜脚本、设计黄金3秒吸睛台词并规划改动对比...",
        modalTitle: "短视频分镜脚本黄金 3 秒与改动红蓝对比"
      };
    }
    return {
      btnText: "查看成果分析报告",
      processingText: "宿主后端 LLM 正高效运算中，正在为您实时分析并撰写智能业务成果报告，请耐心等候...",
      modalTitle: "AI 智能生产力业务成果报告"
    };
  };

  const getInstanceName = (instId: string) => {
    const inst = instances.find(i => i.id === instId);
    return inst ? inst.name : `麦贝实例 (${instId.substring(0, 5)})`;
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300 font-sans">
      
      {/* Toast Notification Header */}
      {notif && (
        <div className={`p-4 rounded-2xl border text-xs sm:text-sm flex items-center justify-between gap-2.5 animate-in slide-in-from-top-1 ${
          notif.type === "success" 
            ? "bg-green-50 border-green-200 text-green-900" 
            : "bg-rose-50 border-rose-200 text-rose-900"
        }`}>
          <div className="flex items-center gap-2.5">
            {notif.type === "success" ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            <p className="font-medium">{notif.text}</p>
          </div>
          {notif.actionUrl && (
            <button 
              onClick={() => navigate(notif.actionUrl!)}
              className="px-3 py-1 bg-rose-600 text-white rounded-md text-xs font-semibold hover:bg-rose-700 transition"
            >
              {notif.actionText || "前往处理"}
            </button>
          )}
        </div>
      )}

      {/* Main Header Descriptor Block */}
      <div className="p-6 border border-outline/60 bg-surface rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base sm:text-lg font-black text-content tracking-tight">麦贝 任务流与定时自动触发中心</h3>
          </div>
          <p className="text-xs text-content-muted font-medium leading-relaxed max-w-2xl">
            此面板同步了由数据库工作流模板驱动生成的任务执行管线及定时计划触发器。无需让用户手动编写执行输入参数，调度底层服务将自动直接读取合并变量值。
          </p>
        </div>
        <Button 
          type="button" 
          variant="outline" 
          size="sm" 
          onClick={fetchData} 
          disabled={loading}
          className="h-10 text-xs font-bold bg-surface-muted border-outline hover:bg-control-hover flex items-center gap-1.5 shrink-0 rounded-xl"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading && "animate-spin"}`} />
          刷新状态列表
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-3">
          <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
          <span className="text-xs sm:text-sm font-semibold text-content-muted">正在同步任务调度信息...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          
          {/* LEFT 2 COLS: Tasks pipelines pipeline list */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2 px-1">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h4 className="text-xs sm:text-sm font-black uppercase text-content-secondary tracking-wider">自动生成的任务流水线 ({tasks.length})</h4>
            </div>

            {tasks.length === 0 ? (
              <div className="p-10 border border-dashed border-outline bg-surface rounded-3xl text-center">
                <Database className="w-10 h-10 text-slate-350 mx-auto mb-3" />
                <p className="font-bold text-content text-sm">暂无自动化配置任务</p>
                <p className="text-xs text-content-muted font-medium max-w-sm mx-auto leading-relaxed mt-1">
                  该实例列表中暂未挂载任何数据库工作流配置。选择或使用模板部署实例后，其附属初始化作业将自动载入本区。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {tasks.map((task) => (
                  <Card key={task.id} className="p-4 sm:p-5 hover:border-indigo-200 dark:hover:border-indigo-800 transition-all bg-surface border border-slate-200/70 dark:border-slate-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase leading-none ${
                          task.status === "success" 
                            ? "bg-green-50 dark:bg-emerald-950/40 border-green-200 dark:border-emerald-800/60 text-green-700 dark:text-emerald-300" 
                            : task.status === "processing" 
                            ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 animate-pulse" 
                            : task.status === "failed" 
                            ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300" 
                            : task.status === "config_required"
                            ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300"
                            : "bg-surface-muted border-outline text-content-secondary"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            task.status === "success" ? "bg-green-500" : task.status === "processing" ? "bg-blue-500 animate-ping" : task.status === "failed" ? "bg-rose-500" : task.status === "config_required" ? "bg-amber-500" : "bg-slate-400"
                          }`} />
                          <span>{getTaskStatusText(task)}</span>
                        </span>
                        
                        <span className="text-[10px] bg-control-hover text-content-secondary px-2 py-0.5 rounded-md font-bold uppercase tracking-wider font-mono">
                          模板: {task.template_id}
                        </span>
                      </div>
                      
                      <h5 className="font-bold text-content text-xs sm:text-sm line-clamp-1">{task.title}</h5>
                      
                      <p className="text-[10px] sm:text-xs text-content-muted font-medium flex items-center gap-1">
                        <span>关联实例：</span>
                        <strong className="text-content">{getInstanceName(task.instance_id)}</strong>
                      </p>
                      
                      {task.finished_at && (
                        <p className="text-[9.5px] font-mono text-content-muted font-medium">
                          完成运行于：{new Date(task.finished_at).toLocaleString()}
                        </p>
                      )}

                      {/* Realtimer loader for active LLM generation */}
                      {task.status === "processing" && (
                        <div className="mt-2 text-xs text-indigo-700 bg-indigo-50/70 border border-indigo-100 p-2.5 rounded-xl flex items-center gap-2 animate-pulse font-sans max-w-2xl">
                          <RefreshCw className="w-3.5 h-3.5 text-indigo-500 shrink-0 animate-spin" />
                          <div>
                            <span className="font-bold">宿主后端 LLM 正高效生成中：</span>
                            <span>{getTaskTemplateMeta(task.template_id).processingText}</span>
                          </div>
                        </div>
                      )}

                      {/* Display explicit execution errors if task failed */}
                      {task.status === "failed" && task.error && (
                        <div className="mt-2 text-xs text-rose-700 bg-rose-50/60 border border-rose-100 p-2.5 rounded-xl flex items-start gap-1.5 leading-relaxed font-sans max-w-2xl">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-rose-900">执行失败原因：</span>
                            <span className="break-all">{task.error}</span>
                          </div>
                        </div>
                      )}

                      {isConfigRequiredTask(task) && (
                        <div className="mt-2 text-xs text-amber-800 bg-amber-50/70 border border-amber-200 p-2.5 rounded-xl flex items-start gap-1.5 leading-relaxed font-sans max-w-2xl">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-amber-900">待完成配置：</span>
                            <span>{task.input_payload?.workflow_readiness?.setup_message || "请先填写独立站 URL 和监控商品/竞品范围后再执行。"}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center border-t md:border-t-0 border-outline pt-3 md:pt-0 w-full md:w-auto shrink-0 gap-2.5">
                      {task.status === "success" && getResultObj(task)?.output_file && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleViewResult(task)}
                          className="border-indigo-200 text-indigo-750 bg-indigo-50/40 hover:bg-indigo-50 hover:text-indigo-900 text-[11px] font-bold h-8 px-3 shrink-0 rounded-xl flex items-center gap-1 shadow-sm"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                          <span>{getTaskTemplateMeta(task.template_id).btnText}</span>
                        </Button>
                      )}

                      <Button
                        type="button"
                        size="xs"
                        onClick={() => isConfigRequiredTask(task) ? navigate(getTaskSetupUrl(task)) : handleTriggerTask(task.id)}
                        disabled={actioningId === task.id || task.status === "processing" || task.status === "success"}
                        className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl px-4 h-8 text-[11px] font-bold flex items-center gap-1 shrink-0 disabled:bg-surface-muted disabled:text-content-muted disabled:border-slate-150"
                      >
                        <Play className="w-3 h-3 text-white fill-current shrink-0" />
                        <span>{task.status === "success" ? "已生成结果" : task.status === "processing" ? "正在执行中" : isConfigRequiredTask(task) ? "去配置" : "手动触发执行"}</span>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT COL: Scheduled Crons manager trigger list */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <Calendar className="w-4 h-4 text-indigo-600" />
              <h4 className="text-xs sm:text-sm font-black uppercase text-content-secondary tracking-wider">定时触发调度器列表 ({jobs.length})</h4>
            </div>

            {jobs.length === 0 ? (
              <div className="p-10 border border-dashed border-outline bg-surface rounded-3xl text-center">
                <Clock className="w-8 h-8 text-slate-350 mx-auto mb-2" />
                <p className="font-bold text-content text-xs">没有配置中的定时计划</p>
                <p className="text-[10px] text-content-muted font-medium leading-relaxed mt-1">
                  当部署实例启用支持「定时调度」类型的工作流模板时，匹配的工作日程将在此列表展示。
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {jobs.map((job) => (
                  <Card key={job.id} className="p-4 bg-surface border border-outline/70 hover:border-outline-strong transition-all rounded-2xl space-y-3 shadow-calc">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5 min-w-0 pr-1">
                        <h5 className="font-bold text-content text-xs sm:text-sm line-clamp-1">{job.title || job.name}</h5>
                        <p className="text-[10.5px] text-indigo-600 font-bold font-mono">CRON: {job.cron_expression || job.interval}</p>
                      </div>
                      
                      {/* Active Status Switch Button */}
                      <button
                        onClick={() => handleToggleJob(job.id)}
                        type="button"
                        className={`w-11 h-6 rounded-full p-0.5 transition-colors focus:outline-none ${
                          job.is_active ? "bg-green-500" : "bg-slate-200"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          job.is_active ? "translate-x-5" : "translate-x-0"
                        }`} />
                      </button>
                    </div>

                    <div className="pt-2.5 border-t border-outline flex items-center justify-between text-[10.5px] font-medium text-content-muted">
                      <span>对接目标实例:</span>
                      <span className="font-bold text-content truncate max-w-[130px]" title={getInstanceName(job.instance_id)}>
                        {getInstanceName(job.instance_id)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-[10px] font-mono text-content-muted">
                      <span>状态:</span>
                      <span className={`font-bold px-1.5 py-0.5 rounded-md ${
                        job.is_active ? "text-green-600 bg-green-50" : "text-content-muted bg-surface-muted"
                      }`}>
                        {job.is_active ? "🟢 定时调度已激活" : "⏸️ 已暂停拦截"}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          
        </div>
      )}

      {/* Markdown Preview Modal */}
      {previewTask && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/75 md:backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-surface rounded-3xl border border-outline shadow-xl overflow-hidden max-w-4xl w-full max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-outline bg-surface-muted flex items-center justify-between">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-600 shrink-0" />
                  <h4 className="font-extrabold text-content text-base sm:text-lg truncate">
                    {getTaskTemplateMeta(previewTask.template_id).modalTitle}
                  </h4>
                </div>
                <p className="text-xs text-content-muted font-medium truncate mt-0.5">
                  任务ID: <span className="font-mono text-content-secondary">{previewTask.id}</span> · 文件：<span className="font-mono text-content-secondary">{getResultObj(previewTask)?.output_file || "未指定"}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTask(null)}
                className="p-2 -mr-2 text-content-muted hover:bg-control-hover hover:text-content rounded-xl transition-all shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-8">
              {previewLoading && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <RefreshCw className="w-7 h-7 text-indigo-600 animate-spin" />
                  <span className="text-xs sm:text-sm font-bold text-content-muted animate-pulse">正在从麦贝物理隔离 outputs 目录同步拉取原始 Markdown 文件...</span>
                </div>
              )}

              {previewError && (
                <div className="p-6 border border-dashed border-rose-200 bg-rose-50/40 rounded-2xl text-center max-w-md mx-auto my-12">
                  <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                  <p className="font-bold text-rose-900 text-sm">报告加载失败</p>
                  <p className="text-xs text-rose-600 leading-relaxed mt-1">{previewError}</p>
                </div>
              )}

              {!previewLoading && !previewError && (
                <div className="space-y-6">
                  {previewWarning && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs sm:text-sm text-amber-800 flex items-start gap-2 shadow-sm animate-in fade-in duration-200">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-amber-900">提示信息</p>
                        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{previewWarning}</p>
                      </div>
                    </div>
                  )}

                  {/* File Path Informational Banner */}
                  <div className="p-4 bg-surface-muted border border-outline/60 rounded-2xl text-[11px] sm:text-xs text-content-secondary leading-relaxed flex items-start gap-2 max-w-none shadow-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-content text-xs sm:text-sm">麦贝本地实例存储写入成功</p>
                      <p className="mt-0.5">我们已成功将该大模型生成报告真实落盘至该实例的物理工作目录：</p>
                      <div className="mt-1">
                        <code className="font-mono bg-surface px-2 py-1 border border-outline rounded-md text-content-secondary font-bold break-all inline-block text-[10px] sm:text-xs">
                          data/instances/{previewTask.instance_id}/{getResultObj(previewTask)?.output_file}
                        </code>
                      </div>
                      <p className="mt-2 text-[10px] sm:text-[11px] text-content-muted font-medium">您可以随时通过实例详情的 <strong className="text-content">“文件管理器”</strong> 去自由下载、预览或进行持久化备份管理。</p>
                    </div>
                  </div>

                  {/* Markdown content container */}
                  <div className="markdown-body prose lg:prose-lg max-w-none prose-slate py-4 leading-relaxed tracking-wide text-xs sm:text-sm border-t border-outline overflow-x-auto">
                    <Markdown>{previewContent || "空报告正文"}</Markdown>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-outline bg-surface-muted flex items-center justify-end">
              <Button
                type="button"
                onClick={() => setPreviewTask(null)}
                className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl h-10 px-6 font-bold text-xs shadow-sm"
              >
                关闭策划盘点报告
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

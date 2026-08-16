import { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { Search, Pause, Play, Terminal, Activity, FileClock, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./ui";
import { api } from "../lib/api";

interface LogMessage {
  msg: string;
  time: string;
  isError?: boolean;
}

export function LogViewer({ 
  instanceId, 
  socket, 
  isDeploying, 
  instanceStatus,
  activeLogTab,
  setActiveLogTab
}: { 
  instanceId: string; 
  socket: Socket | null; 
  isDeploying: boolean; 
  instanceStatus?: string;
  activeLogTab?: 'deployment' | 'runtime' | 'audit';
  setActiveLogTab?: (tab: 'deployment' | 'runtime' | 'audit') => void;
}) {
  const { t } = useTranslation("dashboard");
  const [internalActiveTab, setInternalActiveTab] = useState<'deployment' | 'runtime' | 'audit'>('deployment');
  const activeTab = activeLogTab !== undefined ? activeLogTab : internalActiveTab;
  const setActiveTab = setActiveLogTab !== undefined ? setActiveLogTab : setInternalActiveTab;
  
  // States for deployment logs
  const [deployLogs, setDeployLogs] = useState<LogMessage[]>([]);
  
  // States for runtime logs
  const [runtimeLogs, setRuntimeLogs] = useState<LogMessage[]>([]);
  const [runtimeContainer] = useState<'gateway' | 'dashboard' | 'unified'>('unified');
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  
  // States for audit logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Deployment Logs
  useEffect(() => {
    if (!socket) return;
    const logEv = `deploy_log_${instanceId}`;
    const cb = (data: any) => {
      setDeployLogs(prev => [...prev, { msg: data.message, time: new Date(data.timestamp).toLocaleTimeString() }]);
    };
    socket.on(logEv, cb);
    return () => { socket.off(logEv, cb); };
  }, [socket, instanceId]);

  // Runtime Logs
  useEffect(() => {
    if (!socket || activeTab !== 'runtime') return;
    
    setRuntimeLogs([]);
    socket.emit('watch_runtime_logs', { instanceId, type: runtimeContainer });
    
    const logEv = `runtime_log_${instanceId}`;
    const cb = (data: any) => {
      if (data.type === runtimeContainer) {
        setRuntimeLogs(prev => [...prev.slice(-1000), { msg: data.line, time: new Date(data.timestamp).toLocaleTimeString(), isError: data.isError }]);
      }
    };
    socket.on(logEv, cb);
    
    return () => { 
      socket.off(logEv, cb);
      socket.emit('stop_watch_runtime_logs', { instanceId });
    };
  }, [socket, instanceId, activeTab, runtimeContainer]);

  // Audit Logs
  useEffect(() => {
    if (activeTab === 'audit') {
      api.get(`/api/instances/${instanceId}/audit-logs`)
      .then(data => {
         if (Array.isArray(data)) setAuditLogs(data);
      })
      .catch(err => {
         console.error("Failed to fetch audit logs:", err);
      });
    }
  }, [activeTab, instanceId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && activeTab !== 'audit') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [deployLogs, runtimeLogs, autoScroll, activeTab]);

  const filteredRuntimeLogs = runtimeLogs.filter(log => {
      if (onlyErrors && !log.isError) return false;
      if (searchQuery && !log.msg.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
  });

  return (
    <div className="flex flex-col flex-1 min-h-[500px] min-w-0 bg-white dark:bg-slate-950">
       {(
          <div className="flex bg-slate-50 dark:bg-slate-900 border-b border-slate-200/60 dark:border-slate-800 p-1.5 gap-1 shrink-0 w-full overflow-x-auto">
             <button 
                onClick={() => setActiveTab('deployment')}
                className={cn(
                   "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex-1 sm:flex-initial whitespace-nowrap",
                   activeTab === 'deployment' 
                     ? "bg-white dark:bg-slate-800 shadow-xs text-slate-800 dark:text-slate-100 border border-slate-200/40 dark:border-slate-700 font-semibold" 
                     : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/30 dark:hover:bg-slate-800/50"
                )}
             >
                <Terminal className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                <span className="sm:hidden">{t("logs_tab_deploy_short")}</span>
                <span className="hidden sm:inline">{t("logs_tab_deploy")}</span>
             </button>
             <button 
                onClick={() => setActiveTab('runtime')}
                className={cn(
                   "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex-1 sm:flex-initial whitespace-nowrap",
                   activeTab === 'runtime' 
                     ? "bg-white dark:bg-slate-800 shadow-xs text-slate-800 dark:text-slate-100 border border-slate-200/40 dark:border-slate-700 font-semibold" 
                     : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/30 dark:hover:bg-slate-800/50"
                )}
             >
                <Activity className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                <span className="sm:hidden">{t("logs_tab_runtime_short")}</span>
                <span className="hidden sm:inline">{t("logs_tab_runtime")}</span>
             </button>
             <button 
                onClick={() => setActiveTab('audit')}
                className={cn(
                   "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex-1 sm:flex-initial whitespace-nowrap",
                   activeTab === 'audit' 
                     ? "bg-white dark:bg-slate-800 shadow-xs text-slate-800 dark:text-slate-100 border border-slate-200/40 dark:border-slate-700 font-semibold" 
                     : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/30 dark:hover:bg-slate-800/50"
                )}
             >
                <FileClock className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                <span className="sm:hidden">{t("logs_tab_audit_short")}</span>
                <span className="hidden sm:inline">{t("logs_tab_audit")}</span>
             </button>
          </div>
       )}

       {activeTab === 'runtime' && (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] items-center px-3 sm:px-4 py-2 bg-slate-50/20 dark:bg-slate-900/90 border-b border-slate-200/40 dark:border-slate-800 text-xs shrink-0 gap-2.5">
             <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 md:pb-0">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 rounded-md px-2.5 py-1 flex items-center gap-1.5 shrink-0 select-none whitespace-nowrap">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>{t("logs_unified_main")}</span>
                </span>
                
                <button 
                  className="h-7 w-7 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-700 flex items-center justify-center transition-colors animate-in fade-in duration-200" 
                  onClick={() => setAutoScroll(!autoScroll)} 
                  title={autoScroll ? t("logs_pause_scroll") : t("logs_resume_scroll")}
                >
                  {autoScroll ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                
                <button 
                  onClick={() => setOnlyErrors(!onlyErrors)}
                  className={cn(
                    "h-7 px-2.5 text-xs font-medium rounded-md border transition-all animate-in fade-in duration-200",
                    onlyErrors 
                      ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800/60 hover:bg-red-100/60" 
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 border-slate-200/60 dark:border-slate-700"
                  )}
                >
                  {t("logs_errors_only")}
                </button>
             </div>
             <div className="relative w-full md:w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input 
                  className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-7 text-xs font-normal text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                  placeholder={t("logs_search_placeholder")} 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                )}
             </div>
          </div>
       )}

       {activeTab === 'deployment' && (
          <div className="p-4 flex-1 overflow-y-auto font-mono text-[11.5px] leading-relaxed custom-scrollbar bg-slate-950 min-h-[400px]">
            {deployLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-slate-500/80 gap-2">
                <Terminal className="w-8 h-8 text-slate-700 opacity-60" />
                <div className="text-xs font-medium">{t("logs_waiting_deploy")}</div>
                <div className="text-[10px] text-slate-600/80">{t("logs_no_deploy_desc")}</div>
              </div>
            ) : (
              deployLogs.map((L, i) => (
                <div key={i} className="flex gap-3 py-0.5 px-2 hover:bg-slate-900/40 rounded transition-colors duration-100">
                  <span className="text-slate-500 shrink-0 font-medium select-none">{L.time}</span>
                  <span className="break-all text-sky-400">{L.msg}</span>
                </div>
              ))
            )}
            {isDeploying && <div className="mt-2 text-white animate-pulse px-2">_</div>}
            <div ref={bottomRef} />
          </div>
       )}

       {activeTab === 'runtime' && (
          <div className="p-4 flex-1 overflow-y-auto font-mono text-[11.5px] leading-relaxed custom-scrollbar bg-slate-950 min-h-[400px]">
             {filteredRuntimeLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-20 text-slate-500/80 gap-2">
                  <Terminal className="w-8 h-8 text-slate-700 opacity-60 animate-pulse" />
                  <div className="text-xs font-medium text-center max-w-xs leading-normal">
                    {(isDeploying || !instanceStatus || instanceStatus === 'deploying' || instanceStatus === 'initializing' || instanceStatus === 'restarting' || instanceStatus === 'waiting_web_port' || instanceStatus === 'partial_running') 
                      ? t("logs_initializing_desc") 
                      : t("logs_waiting_heartbeat")}
                  </div>
                </div>
             ) : (
                filteredRuntimeLogs.map((L, i) => (
                   <div key={i} className="flex gap-3 py-0.5 px-2 hover:bg-slate-900/40 rounded transition-colors duration-100">
                      <span className="text-slate-500 shrink-0 font-medium select-none">{L.time}</span>
                      <span className={cn("break-all", L.isError ? "text-rose-400" : "text-emerald-400/95")}>{L.msg}</span>
                   </div>
                ))
             )}
             <div ref={bottomRef} />
          </div>
       )}

       {activeTab === 'audit' && (
          <div className="flex-1 overflow-y-auto bg-white min-h-[400px]">
             <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50/95 border-b border-slate-200/50 backdrop-blur-xs">
                   <tr>
                      <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("logs_audit_time")}</th>
                      <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("logs_audit_action")}</th>
                      <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("logs_audit_details")}</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-10 text-center text-slate-400 text-xs font-medium italic">
                          {t("logs_audit_no_history")}
                        </td>
                      </tr>
                   ) : (
                      auditLogs.map((log) => (
                         <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                            <td className="px-5 py-3 text-xs font-medium text-slate-800">{log.action}</td>
                            <td className="px-5 py-3 text-xs text-slate-600 max-w-xs md:max-w-md truncate" title={log.details}>{log.details}</td>
                         </tr>
                      ))
                   )}
                </tbody>
             </table>
          </div>
       )}
    </div>
  );
}

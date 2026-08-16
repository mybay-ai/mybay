import { Terminal, Activity, MessageSquare, Lightbulb } from "lucide-react";
import { cn } from "../../../lib/utils";

export function ConsoleMockup() {
  return (
    <div className="w-full max-w-5xl mt-16 px-2 sm:px-0">
      <div className="p-1 sm:p-2 bg-white border border-slate-200 rounded-xl shadow-2xl relative overflow-hidden">
        <div className="bg-slate-900 w-full rounded-lg min-h-[400px] border border-slate-800 flex flex-col">
          {/* Top Bar */}
          <div className="h-10 sm:h-12 border-b border-white/10 flex items-center px-4 justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-500"></div>
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-amber-500"></div>
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-emerald-500"></div>
            </div>
            <div className="text-[10px] sm:text-xs text-slate-400 font-mono">localhost:3000 / console</div>
            <div className="w-12 sm:w-16"></div>
          </div>
          
          {/* Content area: Desktop & Tablet */}
          <div className="hidden sm:flex flex-1 overflow-hidden">
            {/* Lateral Sidebar */}
            <div className="w-[140px] lg:w-48 border-r border-white/5 p-3 lg:p-4 flex flex-col gap-1.5 lg:gap-2 shrink-0">
              <div className="h-8 bg-white/10 rounded flex items-center px-2 lg:px-3 text-[11px] lg:text-xs text-white/80 whitespace-nowrap overflow-hidden text-ellipsis">概览 Dashboard</div>
              <div className="h-8 bg-blue-500/20 rounded border border-blue-500/30 flex items-center px-2 lg:px-3 text-[11px] lg:text-xs text-blue-400 whitespace-nowrap overflow-hidden text-ellipsis">实例管理 Instances</div>
              <div className="h-8 hover:bg-white/5 rounded flex items-center px-2 lg:px-3 text-[11px] lg:text-xs text-slate-500 transition-colors whitespace-nowrap overflow-hidden text-ellipsis">安全凭证 Secrets</div>
              <div className="h-8 hover:bg-white/5 rounded flex items-center px-2 lg:px-3 text-[11px] lg:text-xs text-slate-500 transition-colors whitespace-nowrap overflow-hidden text-ellipsis">平台配置 Config</div>
            </div>
            
            {/* Main Table Area */}
            <div className="flex-1 p-4 lg:p-6 bg-slate-900 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-4 lg:mb-6">
                <div className="text-base lg:text-lg font-semibold text-white">生产实例列表</div>
                <div className="border border-white/10 bg-white/5 px-2 lg:px-3 py-1 lg:py-1.5 rounded text-[11px] lg:text-xs text-slate-300">新建实例 +</div>
              </div>
              
              {/* Rows */}
              <div className="space-y-3">
                {/* Row 1 */}
                <div className="border border-white/10 bg-slate-800/80 p-3 lg:p-4 rounded-lg flex flex-wrap lg:flex-nowrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3 lg:gap-4 shrink-0 min-w-[200px]">
                    <div className="w-8 h-8 lg:w-10 lg:h-10 bg-blue-500/20 rounded flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4 lg:w-5 lg:h-5 text-blue-400"/>
                    </div>
                    <div className="text-left flex flex-col items-start justify-center">
                      <div className="text-[13px] lg:text-sm text-white font-medium text-left">{"企业企微客服助理"}</div>
                      <div className="text-[11px] lg:text-xs text-slate-500 mt-1 font-mono text-left">{"production-qw-agent-01"}</div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 lg:gap-6 w-full lg:w-auto">
                    <div className="flex gap-2 items-center text-[11px] lg:text-xs px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 whitespace-nowrap">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> 运行中
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <div className="text-[11px] lg:text-xs bg-white/10 px-2 py-1 rounded text-slate-300 whitespace-nowrap">DeepSeek V3</div>
                      <div className="text-[11px] lg:text-xs bg-white/10 px-2 py-1 rounded text-slate-300 whitespace-nowrap">Webhook</div>
                    </div>
                    <div className="text-slate-400 text-[11px] lg:text-xs whitespace-nowrap ml-auto lg:ml-0">Uptime: 24d 10h</div>
                  </div>
                  
                  <div className="hidden lg:flex gap-2 shrink-0">
                    <div className="p-1.5 hover:bg-white/10 rounded cursor-pointer"><Terminal className="w-4 h-4 text-slate-400" /></div>
                    <div className="p-1.5 hover:bg-white/10 rounded cursor-pointer"><Activity className="w-4 h-4 text-slate-400" /></div>
                  </div>
                </div>

                {/* Row 2 */}
                <div className="border border-white/10 bg-slate-800/80 p-3 lg:p-4 rounded-lg flex flex-wrap lg:flex-nowrap items-center justify-between gap-4 opacity-80">
                  <div className="flex items-center gap-3 lg:gap-4 shrink-0 min-w-[200px]">
                    <div className="w-8 h-8 lg:w-10 lg:h-10 bg-purple-500/20 rounded flex items-center justify-center shrink-0">
                      <Lightbulb className="w-4 h-4 lg:w-5 lg:h-5 text-purple-400"/>
                    </div>
                    <div className="text-left flex flex-col items-start justify-center">
                      <div className="text-[13px] lg:text-sm text-white font-medium text-left">{"内部日报总结特工"}</div>
                      <div className="text-[11px] lg:text-xs text-slate-500 mt-1 font-mono text-left">{"internal-sum-v2"}</div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 lg:gap-6 w-full lg:w-auto">
                    <div className="flex gap-2 items-center text-[11px] lg:text-xs px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 whitespace-nowrap">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> 运行中
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <div className="text-[11px] lg:text-xs bg-white/10 px-2 py-1 rounded text-slate-300 whitespace-nowrap">OpenAI GPT-4o</div>
                      <div className="text-[11px] lg:text-xs bg-white/10 px-2 py-1 rounded text-slate-300 whitespace-nowrap">Feishu</div>
                    </div>
                    <div className="text-slate-400 text-[11px] lg:text-xs whitespace-nowrap ml-auto lg:ml-0">Uptime: 5d 2h</div>
                  </div>
                  
                  <div className="hidden lg:flex gap-2 shrink-0">
                    <div className="p-1.5 hover:bg-white/10 rounded cursor-pointer"><Terminal className="w-4 h-4 text-slate-400" /></div>
                    <div className="p-1.5 hover:bg-white/10 rounded cursor-pointer"><Activity className="w-4 h-4 text-slate-400" /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Content area: Mobile Only */}
          <div className="sm:hidden flex-1 overflow-hidden flex flex-col">
             {/* General Status */}
             <div className="px-4 pt-4 pb-2 border-b border-white/5 flex gap-4">
                <div className="flex-1">
                   <div className="text-xs text-slate-500 mb-1">实例总数</div>
                   <div className="text-lg font-bold text-white">2 <span className="text-xs font-normal text-slate-400 ml-1">运行中</span></div>
                </div>
                <div className="flex-1">
                   <div className="text-xs text-slate-500 mb-1">监控状态</div>
                   <div className="text-sm font-semibold text-emerald-400 flex items-center mt-1">
                     <Activity className="w-3.5 h-3.5 mr-1" />
                     24/7 Online
                   </div>
                </div>
             </div>
             
             {/* Mobile Cards */}
             <div className="flex-1 p-4 bg-slate-900 space-y-4 overflow-y-auto">
                {/* Card 1 */}
                <div className="bg-slate-800/80 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
                   <div className="flex justify-between items-start gap-4">
                      <div className="flex items-center gap-3">
                         <div className="w-8 h-8 bg-blue-500/20 rounded flex items-center justify-center shrink-0">
                            <MessageSquare className="w-4 h-4 text-blue-400"/>
                         </div>
                         <div>
                            <div className="text-sm text-white font-medium text-left">{"企业企微客服助理"}</div>
                            <div className="text-xs text-slate-500 mt-0.5 font-mono text-left">{"production-qw-agent-01"}</div>
                         </div>
                      </div>
                   </div>
                   <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                      <div className="flex items-center gap-1.5 text-xs px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-md border border-emerald-500/20 whitespace-nowrap">
                         <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> 运行中
                      </div>
                      <div className="text-xs border border-white/10 text-slate-300 px-2 py-0.5 rounded-md whitespace-nowrap">DeepSeek V3</div>
                      <div className="text-xs border border-white/10 text-slate-300 px-2 py-0.5 rounded-md whitespace-nowrap">Webhook</div>
                   </div>
                   <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                     <Activity className="w-3.5 h-3.5" /> Uptime: 24d 10h
                   </div>
                </div>

                {/* Card 2 */}
                <div className="bg-slate-800/80 border border-white/10 rounded-xl p-4 flex flex-col gap-3 opacity-90">
                   <div className="flex justify-between items-start gap-4">
                      <div className="flex items-center gap-3">
                         <div className="w-8 h-8 bg-purple-500/20 rounded flex items-center justify-center shrink-0">
                            <Lightbulb className="w-4 h-4 text-purple-400"/>
                         </div>
                         <div>
                            <div className="text-sm text-white font-medium">内部日报总结特工</div>
                            <div className="text-xs text-slate-500 mt-0.5 font-mono">internal-sum-v2</div>
                         </div>
                      </div>
                   </div>
                   <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                      <div className="flex items-center gap-1.5 text-xs px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-md border border-emerald-500/20 whitespace-nowrap">
                         <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> 运行中
                      </div>
                      <div className="text-xs border border-white/10 text-slate-300 px-2 py-0.5 rounded-md whitespace-nowrap">OpenAI GPT-4o</div>
                      <div className="text-xs border border-white/10 text-slate-300 px-2 py-0.5 rounded-md whitespace-nowrap">Feishu</div>
                   </div>
                   <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                     <Activity className="w-3.5 h-3.5" /> Uptime: 5d 2h
                   </div>
                </div>
             </div>
             
             {/* Mobile Footer Status */}
             <div className="px-4 py-3 bg-slate-900 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-600"></div> 独立实例
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-600"></div> 安全访问
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div> 实时监控
                </div>
             </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "./ui";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center animate-in fade-in duration-500">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-6 ring-8 ring-red-50/50">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">界面组件渲染异常</h2>
          <p className="text-slate-500 text-sm max-w-md mx-auto mb-8 leading-relaxed">
            由于部分数据状态同步不一致或 React Hook 调用异常，当前面板渲染失败。这可能是由于实例状态正在剧烈切换导致的（如正在重启或配置同步中）。
          </p>
          
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl w-full max-w-lg mb-8 overflow-hidden">
             <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Error Trace (React #300 Check)</span>
             </div>
             <p className="text-xs font-mono text-slate-400 text-left bg-slate-100/50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-[100px]">
                {this.state.error?.message || "Unknown rendering error"}
                {"\n"}
                {this.state.error?.stack?.split('\n').slice(0, 3).join('\n')}
             </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              onClick={() => window.location.reload()} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 px-6 rounded-xl flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              立即刷新页面
            </Button>
            <Button 
              variant="outline"
              onClick={() => window.location.href = '/app'} 
              className="bg-white border-slate-200 text-slate-600 font-semibold h-11 px-6 rounded-xl flex items-center gap-2"
            >
              <Home className="w-4 h-4" />
              返回首页
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEOHead } from "./SEOHead";
import { AlertTriangle, Home, ArrowLeft } from "lucide-react";
import { Button } from "./ui";

export function NotFound() {
  const { i18n } = useTranslation();
  const isZh = i18n.language === "zh-CN";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <SEOHead 
        title={isZh ? "页面未找到 - 麦贝 MyBayAI" : "Page Not Found - MyBay"}
        description={isZh ? "抱歉，您访问的页面不存在。" : "Sorry, the page you are looking for does not exist."}
        noindex={true}
      />
      
      <div className="max-w-md w-full bg-white p-8 md:p-10 rounded-2xl shadow-xl border border-slate-200/60 transition-all duration-300 hover:shadow-2xl">
        <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-amber-100 animate-pulse">
          <AlertTriangle className="w-10 h-10" />
        </div>
        
        <h1 className="text-3xl font-extrabold text-slate-900 mb-3 tracking-tight">
          404
        </h1>
        <h2 className="text-xl font-bold text-slate-800 mb-4">
          {isZh ? "页面未找到" : "Page Not Found"}
        </h2>
        
        <p className="text-slate-500 mb-8 text-sm md:text-base leading-relaxed">
          {isZh 
            ? "抱歉，您访问的页面不存在。它可能已被删除、更名，或暂时不可用。" 
            : "Sorry, the page you are looking for does not exist. It might have been removed, had its name changed, or is temporarily unavailable."}
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/">
            <Button className="w-full sm:w-auto inline-flex items-center gap-2 px-5 py-2.5">
              <Home className="w-4 h-4" />
              {isZh ? "返回首页" : "Back to Home"}
            </Button>
          </Link>
          <button 
            onClick={() => window.history.back()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 bg-white hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            {isZh ? "返回上一页" : "Go Back"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NotFound;

import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "info" | "warning" | "error";
}

export interface AlertState {
  isOpen: boolean;
  title: string;
  message: string;
  type: "success" | "info" | "warning" | "error";
  details?: string;
  confirmText?: string;
  resolve?: (value: void) => void;
}

export interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  type: "success" | "info" | "warning" | "error" | "danger";
  confirmText?: string;
  cancelText?: string;
  resolve?: (value: boolean) => void;
}

interface FeedbackContextType {
  showToast: (message: string, type?: "success" | "info" | "warning" | "error", duration?: number) => void;
  showAlert: (options: {
    title: string;
    message: string;
    type?: "success" | "info" | "warning" | "error";
    details?: string;
    confirmText?: string;
  }) => Promise<void>;
  showConfirm: (options: {
    title: string;
    message: string;
    type?: "success" | "info" | "warning" | "error" | "danger";
    confirmText?: string;
    cancelText?: string;
  }) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextType | undefined>(undefined);

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used within a FeedbackProvider");
  }
  return context;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [alert, setAlert] = useState<AlertState>({
    isOpen: false,
    title: "",
    message: "",
    type: "info"
  });
  const [confirm, setConfirm] = useState<ConfirmState>({
    isOpen: false,
    title: "",
    message: "",
    type: "warning"
  });

  const showToast = useCallback((message: string, type: "success" | "info" | "warning" | "error" = "success", duration = 3000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const showAlert = useCallback((options: {
    title: string;
    message: string;
    type?: "success" | "info" | "warning" | "error";
    details?: string;
    confirmText?: string;
  }) => {
    return new Promise<void>((resolve) => {
      setAlert({
        isOpen: true,
        title: options.title,
        message: options.message,
        type: options.type || "info",
        details: options.details,
        confirmText: options.confirmText || "确定",
        resolve
      });
    });
  }, []);

  const showConfirm = useCallback((options: {
    title: string;
    message: string;
    type?: "success" | "info" | "warning" | "error" | "danger";
    confirmText?: string;
    cancelText?: string;
  }) => {
    return new Promise<boolean>((resolve) => {
      setConfirm({
        isOpen: true,
        title: options.title,
        message: options.message,
        type: options.type || "warning",
        confirmText: options.confirmText || "确定",
        cancelText: options.cancelText || "取消",
        resolve
      });
    });
  }, []);

  const handleAlertClose = () => {
    if (alert.resolve) alert.resolve();
    setAlert(prev => ({ ...prev, isOpen: false }));
  };

  const handleConfirmClose = (result: boolean) => {
    if (confirm.resolve) confirm.resolve(result);
    setConfirm(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <FeedbackContext.Provider value={{ showToast, showAlert, showConfirm }}>
      {children}

      {/* Global Toast Notifications Container */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
              className={`p-3.5 rounded-xl shadow-lg border text-sm flex items-start gap-3 pointer-events-auto bg-slate-900 border-slate-800 text-white`}
            >
              {t.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
              {t.type === "info" && <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />}
              {t.type === "warning" && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
              {t.type === "error" && <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
              <div className="flex-1 font-medium tracking-tight text-slate-200">{t.message}</div>
              <button
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Global Alert Modal */}
      <AnimatePresence>
        {alert.isOpen && (
          <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleAlertClose}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 z-[9991]"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-slate-800 shrink-0">
                  {alert.type === "success" && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
                  {alert.type === "info" && <Info className="w-6 h-6 text-sky-400" />}
                  {alert.type === "warning" && <AlertTriangle className="w-6 h-6 text-amber-400" />}
                  {alert.type === "error" && <XCircle className="w-6 h-6 text-rose-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-white tracking-tight leading-6 mb-1">
                    {alert.title}
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {alert.message}
                  </p>

                  {alert.details && (
                    <details className="mt-4 border border-slate-800 bg-slate-950/50 rounded-xl overflow-hidden group">
                      <summary className="px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer select-none flex items-center justify-between">
                        <span>查看技术错误详情</span>
                        <ChevronDownIcon className="w-4 h-4 transition-transform duration-200 group-open:rotate-180" />
                      </summary>
                      <pre className="p-4 border-t border-slate-800 text-xs font-mono text-rose-400 overflow-x-auto max-h-60 whitespace-pre-wrap select-text leading-relaxed bg-slate-950">
                        {alert.details}
                      </pre>
                    </details>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={handleAlertClose}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  {alert.confirmText}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Confirm Modal */}
      <AnimatePresence>
        {confirm.isOpen && (
          <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => handleConfirmClose(false)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 z-[9991]"
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl shrink-0 ${confirm.type === "danger" ? "bg-rose-950/40 border border-rose-900/50" : "bg-slate-800"}`}>
                  {confirm.type === "success" && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
                  {confirm.type === "info" && <Info className="w-6 h-6 text-sky-400" />}
                  {confirm.type === "warning" && <AlertTriangle className="w-6 h-6 text-amber-400" />}
                  {confirm.type === "danger" && <AlertTriangle className="w-6 h-6 text-rose-400" />}
                  {confirm.type === "error" && <XCircle className="w-6 h-6 text-rose-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-white tracking-tight leading-6 mb-1">
                    {confirm.title}
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {confirm.message}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => handleConfirmClose(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all border border-slate-700 active:scale-95 cursor-pointer"
                >
                  {confirm.cancelText}
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmClose(true)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all shadow-md active:scale-95 cursor-pointer ${
                    confirm.type === "danger"
                      ? "bg-rose-600 hover:bg-rose-700 shadow-rose-950/50"
                      : "bg-blue-600 hover:bg-blue-700 shadow-blue-950/50"
                  }`}
                >
                  {confirm.confirmText}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </FeedbackContext.Provider>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      {...props}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

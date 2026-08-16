import { Activity } from "lucide-react";
import { Card } from "../ui";

interface TemplateAuditPanelProps {
  auditLogs: any[];
  logsLoading: boolean;
}

export function TemplateAuditPanel({ auditLogs, logsLoading }: TemplateAuditPanelProps) {
  return (
    <Card className="border border-outline shadow-sm overflow-hidden bg-surface mt-6">
      <div className="flex items-center justify-between border-b border-outline pb-4 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          <h3 className="font-bold text-content text-sm">最近模板变更审计 (Recent Template Changes)</h3>
        </div>
        <span className="text-[10px] bg-control-hover text-content-muted px-2 py-0.5 rounded-full font-medium">展示最近 10 条记录</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-surface-muted/50 border-b border-outline text-content-muted font-semibold">
              <th className="p-3">变更时间</th>
              <th className="p-3">操作人</th>
              <th className="p-3">动作类型</th>
              <th className="p-3">变更详情 / 影响 ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline text-content-secondary">
            {logsLoading && auditLogs.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-content-muted">正在加载变更日志...</td>
              </tr>
            ) : auditLogs.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-content-muted">暂无相关模板变更记录</td>
              </tr>
            ) : (
              auditLogs.map((log) => {
                const localTime = new Date(log.timestamp).toLocaleString("zh-CN", { hour12: false });
                return (
                  <tr key={log.id} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="p-3 font-mono text-content-muted whitespace-nowrap">{localTime}</td>
                    <td className="p-3 font-medium text-content">{log.user_id ? `管理员 ID: ${log.user_id}` : "Unknown Operator"}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        log.action.includes("BULK") 
                          ? "bg-purple-50 text-purple-700 border border-purple-100" 
                          : "bg-blue-50 text-blue-700 border border-blue-100"
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3 text-content-secondary font-sans break-all">{log.details}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

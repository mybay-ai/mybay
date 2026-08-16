import { Label, Input, Card, Button } from "./ui";
import { skillPolicyRegistry, RiskLevel } from "@/shared/skillPolicyRegistry";
import { Lock, AlertOctagon, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "../lib/api";

interface SkillsSectionProps {
  skills: string[];
  setSkills: (v: string[]) => void;
  skillTavilyApiKey: string; setSkillTavilyApiKey: (v: string) => void;
  skillSerperApiKey: string; setSkillSerperApiKey: (v: string) => void;
  skillGithubToken: string; setSkillGithubToken: (v: string) => void;
  currentUser?: any;
}

export function AppSettingsSkillsSection({
  skills, setSkills,
  skillTavilyApiKey, setSkillTavilyApiKey,
  skillSerperApiKey, setSkillSerperApiKey,
  skillGithubToken, setSkillGithubToken,
  currentUser
}: SkillsSectionProps) {
  const [confirmingSkill, setConfirmingSkill] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dockerAlert, setDockerAlert] = useState<string | null>(null);
  const [dockerSettings, setDockerSettings] = useState<{ envEnabled: boolean; dbEnabled: boolean } | null>(null);

  useEffect(() => {
    api.get("/api/system/settings")
      .then((resData: any) => {
        setDockerSettings({
          envEnabled: resData.ENABLE_DOCKER_SOCKET_SKILL === true,
          dbEnabled: resData.admin_docker_socket_enabled === true,
        });
      })
      .catch((err) => console.error("Failed to fetch system docker settings in AppSettings:", err));
  }, []);

  const isAdmin = currentUser?.role === 'admin';
  const skillPolicies = Object.values(skillPolicyRegistry);
  const standardSkills = skillPolicies.filter(p => p.riskLevel === 'low' || p.riskLevel === 'medium');
  const highRiskSkills = skillPolicies.filter(p => p.riskLevel === 'high' || p.riskLevel === 'critical');

  const handleToggle = (skillId: string) => {
    const policy = skillPolicyRegistry[skillId];
    const isChecked = skills.includes(skillId);

    if (isChecked) {
      setSkills(skills.filter(id => id !== skillId));
      return;
    }

    if (policy.adminOnly && !isAdmin) return;

    if (skillId === "docker" && isAdmin) {
      if (!dockerSettings) return;
      if (!dockerSettings.envEnabled) {
        setDockerAlert("服务器未启用 ENABLE_DOCKER_SOCKET_SKILL 安全策略，此高危功能已强制关闭");
        return;
      }
      if (!dockerSettings.dbEnabled) {
        setDockerAlert("平台安全策略未允许挂载 Docker Socket。请先到系统设置 - 安全页面中开启「宿主机 Docker 控制权限」并进行安全风险确认");
        return;
      }
    }

    if (policy.requiresConfirmation || policy.riskLevel === 'critical' || policy.riskLevel === 'high') {
      setConfirmingSkill(skillId);
      setConfirmText("");
    } else {
      setSkills([...skills, skillId]);
    }
  };

  const confirmSkill = () => {
    if (!confirmingSkill) return;
    const policy = skillPolicyRegistry[confirmingSkill];

    if (policy.riskLevel === 'critical') {
      const expected = `ENABLE ${confirmingSkill.toUpperCase().replace('_', ' ')}`;
      if (confirmText !== expected) return;
    }

    setSkills([...skills, confirmingSkill]);
    setConfirmingSkill(null);
  };

  const renderSkillCard = (s: any) => {
    const checked = skills.includes(s.id);
    const isHigh = s.riskLevel === 'high' || s.riskLevel === 'critical';

    const isDocker = s.id === 'docker';
    const isComingSoon = s.runtimeStatus === 'coming_soon';
    let isDisabled = (s.adminOnly && !isAdmin) || isComingSoon;
    let dockerTip = "";
    let showYellowWarning = false;

    if (isDocker && isAdmin && dockerSettings) {
      if (!dockerSettings.envEnabled) {
        isDisabled = true;
        dockerTip = "服务器未启用 ENABLE_DOCKER_SOCKET_SKILL 安全策略，此高危功能已强制关闭";
      } else if (!dockerSettings.dbEnabled) {
        showYellowWarning = true;
        dockerTip = "系统未允许管理员挂载 Docker Socket，需要前往后台系统设置中激活";
      }
    }

    return (
      <div
        key={s.id}
        onClick={() => {
          if (isDocker && isAdmin) {
            if (dockerSettings) {
              if (!dockerSettings.envEnabled) {
                setDockerAlert("服务器未启用 ENABLE_DOCKER_SOCKET_SKILL 安全策略，此高危功能已强制关闭");
                return;
              }
              if (!dockerSettings.dbEnabled) {
                setDockerAlert("平台安全策略未允许挂载 Docker Socket。请先到系统设置 - 安全页面中开启「宿主机 Docker 控制权限」并进行安全风险确认");
                return;
              }
            } else {
              return;
            }
          }
          if (!isDisabled) {
            handleToggle(s.id);
          }
        }}
        className={`space-y-1 p-2 bg-slate-50 border rounded-lg transition-all ${
          isDisabled ? "opacity-50 cursor-not-allowed border-outline" : "cursor-pointer"
        } ${
          checked
            ? isHigh ? "border-red-200 bg-red-50/50" : "border-blue-200 bg-blue-50/50"
            : !isDisabled ? "border-outline hover:border-outline" : ""
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5">
            {isDisabled ? (
              <Lock className="w-3.5 h-3.5 text-content-muted" />
            ) : (
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {}}
                className="w-3.5 h-3.5 rounded border-outline-strong text-blue-600 focus:ring-blue-500"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13px] font-semibold text-content">{s.name}</span>
              {isComingSoon && (
                <span className="text-[8px] font-bold text-content-muted bg-control-hover px-1 py-0 rounded border border-outline uppercase">即将推出</span>
              )}
              {s.runtimeStatus === 'beta' && (
                <span className="text-[8px] font-bold text-indigo-600 bg-indigo-100 px-1 py-0 rounded border border-indigo-200 uppercase">BETA</span>
              )}
              {isHigh && (
                <span className="text-[8px] font-bold text-red-600 bg-red-100 px-1 py-0 rounded border border-red-200 uppercase">高危</span>
              )}
              {showYellowWarning && (
                <span className="inline-flex items-center gap-0.5 text-[8px] bg-amber-100 text-amber-750 font-bold px-1 py-0.5 rounded border border-amber-200 uppercase">
                  未配置
                </span>
              )}
            </div>
            {dockerTip && (
              <span className="text-red-500 font-semibold block my-1 text-[9px] leading-normal">
                {dockerTip}
              </span>
            )}
            <span className="text-[9px] text-content-muted leading-normal block mt-0.5">{s.desc}</span>
          </div>
        </div>

        {s.requiresKey && checked && (
          <div className="mt-2 pl-5 animate-in fade-in duration-100 overflow-hidden">
            <span className="text-[9px] text-content-muted block mb-1">{s.label}：</span>
            <Input
              type="password"
              placeholder={s.placeholder}
              value={
                s.requiresKey === 'skillTavilyApiKey' ? skillTavilyApiKey :
                s.requiresKey === 'skillSerperApiKey' ? skillSerperApiKey :
                skillGithubToken
              }
              onChange={e => {
                const val = e.target.value;
                if (s.requiresKey === 'skillTavilyApiKey') setSkillTavilyApiKey(val);
                else if (s.requiresKey === 'skillSerperApiKey') setSkillSerperApiKey(val);
                else if (s.requiresKey === 'skillGithubToken') setSkillGithubToken(val);
              }}
              className="h-7 font-mono text-[11px] bg-surface"
              onClick={e => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 bg-surface border border-outline/80 rounded-xl space-y-3 shadow-sm relative overflow-visible">
      {/* Risk Confirmation Overlay */}
      {confirmingSkill && (
        <div className="absolute inset-0 z-[60] bg-surface/95 backdrop-blur-sm rounded-xl p-4 flex flex-col items-center justify-center text-center animate-in fade-in duration-200">
          <AlertOctagon className="w-10 h-10 text-red-600 mb-2" />
          <h5 className="text-sm font-bold text-content mb-1">启用高危能力？</h5>
          <div className="text-[11px] text-content-muted mb-4 px-2">
            {confirmingSkill === 'docker' ? (
              <strong className="text-red-900 font-extrabold block mb-2 leading-normal text-[13px] bg-red-50 border border-red-100 p-2 rounded-lg">
                安全警告：启用后，此实例将能完全访问宿主机 Docker API。请确保实例内的 Agent 指令绝对可信！
              </strong>
            ) : null}
            <p>{skillPolicyRegistry[confirmingSkill].warningText}</p>
          </div>

          {skillPolicyRegistry[confirmingSkill].riskLevel === 'critical' && (
            <div className="w-full mb-4 space-y-2">
              <p className="text-[9px] font-bold text-content-muted uppercase tracking-widest">
                输入 ENABLE {confirmingSkill.toUpperCase().replace('_', ' ')}
              </p>
              <Input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                className="h-8 text-center font-mono text-[13px]"
                placeholder="确认文本"
              />
            </div>
          )}

          <div className="flex gap-2 w-full">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-[13px]" onClick={() => setConfirmingSkill(null)}>取消</Button>
            <Button
              size="sm"
              className="flex-1 h-8 text-[13px] bg-red-600 hover:bg-red-700 text-white"
              disabled={skillPolicyRegistry[confirmingSkill].riskLevel === 'critical' && confirmText !== `ENABLE ${confirmingSkill.toUpperCase().replace('_', ' ')}`}
              onClick={confirmSkill}
            >
              确认激活
            </Button>
          </div>
        </div>
      )}

      <h4 className="text-[13px] font-semibold uppercase tracking-wider text-content-muted">4. 激活高阶扩展技能与能力树</h4>
      <p className="text-[11px] text-content-muted leading-normal">
        选中的扩展支持在挂载时自动引入为微服务函数。请谨慎评估高危技能的暴露风险。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
        {standardSkills.map(renderSkillCard)}
      </div>

      <div className="pt-2">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center gap-2 text-[9px] font-bold text-content-muted hover:text-content-secondary transition-colors uppercase tracking-widest"
        >
          <div className="h-[1px] flex-1 bg-control-hover" />
          <span>{showAdvanced ? "收起高危设置" : "展开高危安全能力"}</span>
          <AlertTriangle className={`w-3 h-3 ${showAdvanced ? "rotate-180" : ""}`} />
          <div className="h-[1px] flex-1 bg-control-hover" />
        </button>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 animate-in slide-in-from-top-1 duration-200">
          {highRiskSkills.map(renderSkillCard)}
        </div>
      )}

      {dockerAlert && (
        <div className="absolute inset-0 z-[70] bg-surface/95 backdrop-blur-sm rounded-xl p-4 flex flex-col items-center justify-center text-center animate-in fade-in duration-200">
          <AlertTriangle className="w-10 h-10 text-amber-600 mb-2" />
          <h5 className="text-sm font-bold text-content mb-1">平台安全拦截与提醒</h5>
          <p className="text-[13px] text-content-secondary mb-4 px-2 font-medium leading-relaxed">
            {dockerAlert}
          </p>
          <Button
            size="sm"
            className="w-full h-8 text-[13px] bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            onClick={() => setDockerAlert(null)}
          >
            我知道了
          </Button>
        </div>
      )}
    </div>
  );
}

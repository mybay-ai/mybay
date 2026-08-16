import { ShieldAlert, Check, HelpCircle, HardDrive, Key, AlertOctagon, RefreshCw, Layers, Lock, AlertTriangle } from "lucide-react";
import { Label, Input, Button, Card } from "../../components/ui";
import { skillPolicyRegistry, RiskLevel } from "@/shared/skillPolicyRegistry";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";

interface SkillsStepProps {
  data: any;
  update: (k: any, v: any) => void;
  testSkill: (skillId: string) => Promise<void>;
  testResults: any;
  currentUser?: any;
}

export function SkillsStep({ data, update, testSkill, testResults, currentUser }: SkillsStepProps) {
  const { t } = useTranslation("deploy");
  const activeSkills = data.skills || [];
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
      .catch((err) => console.error("Failed to fetch system docker settings:", err));
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  const skillPolicies = Object.values(skillPolicyRegistry);
  const standardSkills = skillPolicies.filter(p => p.riskLevel === 'low' || p.riskLevel === 'medium');
  const highRiskSkills = skillPolicies.filter(p => p.riskLevel === 'high' || p.riskLevel === 'critical');
  const getSkillCopy = (skillId: string, field: "name" | "desc" | "warning" | "label" | "placeholder") => (
    t(`wizardCopy.skills.catalog.${skillId}.${field}`)
  );

  const handleToggle = (skillId: string) => {
    const policy = skillPolicyRegistry[skillId];
    const isChecked = activeSkills.includes(skillId);

    if (isChecked) {
      update("skills", activeSkills.filter((id: string) => id !== skillId));
      return;
    }

    if (policy.adminOnly && !isAdmin) return;

    if (skillId === "docker" && isAdmin) {
      if (!dockerSettings) return;
      if (!dockerSettings.envEnabled) {
        setDockerAlert(t("wizardCopy.skills.dockerEnvDisabled"));
        return;
      }
      if (!dockerSettings.dbEnabled) {
        setDockerAlert(t("wizardCopy.skills.dockerAdminDisabled"));
        return;
      }
    }

    if (policy.requiresConfirmation || policy.riskLevel === 'critical' || policy.riskLevel === 'high') {
      setConfirmingSkill(skillId);
      setConfirmText("");
    } else {
      update("skills", [...activeSkills, skillId]);
    }
  };

  const confirmSkill = () => {
    if (!confirmingSkill) return;
    const policy = skillPolicyRegistry[confirmingSkill];
    
    if (policy.riskLevel === 'critical') {
      const expected = `ENABLE ${confirmingSkill.toUpperCase().replace('_', ' ')}`;
      if (confirmText !== expected) return;
    }

    update("skills", [...activeSkills, confirmingSkill]);
    setConfirmingSkill(null);
  };

  const renderSkillCard = (s: any) => {
    const checked = activeSkills.includes(s.id);
    const riskColors = {
      low: "border-slate-200 text-slate-500",
      medium: "border-blue-200 text-blue-600",
      high: "border-amber-200 text-amber-600",
      critical: "border-red-200 text-red-600"
    };

    const isDocker = s.id === 'docker';
    const isComingSoon = s.runtimeStatus === 'coming_soon';
    let isDisabled = (s.adminOnly && !isAdmin) || isComingSoon;
    let dockerTip = "";
    let showYellowWarning = false;

    if (isDocker && isAdmin && dockerSettings) {
      if (!dockerSettings.envEnabled) {
        isDisabled = true;
        dockerTip = t("wizardCopy.skills.dockerEnvDisabled");
      } else if (!dockerSettings.dbEnabled) {
        showYellowWarning = true;
        dockerTip = t("wizardCopy.skills.dockerAdminActivation");
      }
    }

    return (
      <div
        key={s.id}
        onClick={() => {
          if (isDocker && isAdmin) {
            if (dockerSettings) {
              if (!dockerSettings.envEnabled) {
                setDockerAlert(t("wizardCopy.skills.dockerEnvDisabled"));
                return;
              }
              if (!dockerSettings.dbEnabled) {
                setDockerAlert(t("wizardCopy.skills.dockerAdminDisabled"));
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
        className={`relative p-4 border-2 rounded-2xl transition-all flex items-start gap-3.5 ${
          isDisabled ? "opacity-50 cursor-not-allowed bg-surface-muted border-outline" : "cursor-pointer"
        } ${
          checked
            ? s.riskLevel === 'high' || s.riskLevel === 'critical'
              ? "border-red-500 bg-red-50/20 dark:bg-rose-950/20 shadow-sm"
              : "border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 shadow-sm"
            : !isDisabled ? "border-outline bg-surface hover:border-outline-strong" : ""
        }`}
      >
        <div className="mt-0.5 shrink-0 select-none">
          {isDisabled ? (
            <Lock className="w-4.5 h-4.5 text-slate-400" />
          ) : (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {}}
              className="w-4.5 h-4.5 rounded border-outline-strong text-blue-600 focus:ring-blue-500"
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-content">{getSkillCopy(s.id, "name")}</span>
            {isComingSoon && (
              <span className="inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded-md border border-outline bg-surface-muted text-content-muted uppercase">{t("wizardCopy.skills.comingSoon")}</span>
            )}
            {s.runtimeStatus === 'beta' && (
              <span className="inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-900/60 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 uppercase">BETA</span>
            )}
            {s.riskLevel !== 'low' && !isComingSoon && (
              <span className={`inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded-md border capitalize ${riskColors[s.riskLevel as RiskLevel]}`}>
                {s.riskLevel === 'critical' ? t("wizardCopy.skills.riskCritical") : s.riskLevel === 'high' ? t("wizardCopy.skills.riskHigh") : t("wizardCopy.skills.riskMedium")}
              </span>
            )}
            {showYellowWarning && (
              <span className="inline-flex items-center gap-1 text-[11px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded-md">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                {t("wizardCopy.skills.securityDisabled")}
              </span>
            )}
          </div>
          <span className="text-[12px] leading-relaxed text-content-muted block mt-1">
            {dockerTip && (
              <span className="text-red-500 dark:text-red-400 font-medium block mb-1 text-[13px] leading-normal">
                {dockerTip}
              </span>
            )}
            {getSkillCopy(s.id, "desc")}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 relative">
      {/* Confirmation Modal */}
      {confirmingSkill && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-6 space-y-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600">
              <AlertOctagon className="w-8 h-8" />
              <h3 className="text-xl font-bold">{t("wizardCopy.skills.confirmTitle")}</h3>
            </div>
            
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-100 p-4 rounded-xl space-y-2">
                <p className="text-sm font-bold text-red-900">{t("wizardCopy.skills.enabling", { name: getSkillCopy(confirmingSkill, "name") })}</p>
                <p className="text-[13px] text-red-700 leading-relaxed">
                  {confirmingSkill === 'docker' ? (
                    <strong className="text-red-900 font-extrabold block mb-2 leading-normal">
                      {t("wizardCopy.skills.dockerWarning")}
                    </strong>
                  ) : null}
                  {getSkillCopy(confirmingSkill, "warning")}
                </p>
              </div>

              {skillPolicyRegistry[confirmingSkill].riskLevel === 'critical' && (
                <div className="space-y-2">
                  <Label className="text-[13px] text-slate-500 uppercase tracking-wider font-bold">
                    {t("wizardCopy.skills.confirmPrompt")}
                  </Label>
                  <div className="p-2 bg-slate-100 rounded font-mono text-center text-sm font-bold select-all">
                    ENABLE {confirmingSkill.toUpperCase().replace('_', ' ')}
                  </div>
                  <Input 
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={t("wizardCopy.skills.confirmPlaceholder")}
                    className="text-center font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={() => setConfirmingSkill(null)}
              >
                {t("wizardCopy.skills.cancel")}
              </Button>
              <Button 
                className="flex-1 bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200"
                disabled={skillPolicyRegistry[confirmingSkill].riskLevel === 'critical' && confirmText !== `ENABLE ${confirmingSkill.toUpperCase().replace('_', ' ')}`}
                onClick={confirmSkill}
              >
                {t("wizardCopy.skills.confirm")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div className="border-b border-slate-100 pb-3">
        <h4 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
          <Layers className="w-5 h-5 text-blue-600" />
          <span>{t("wizardCopy.skills.title")}</span>
        </h4>
        <p className="text-sm text-slate-500 mt-1 leading-normal">
          {t("wizardCopy.skills.description")}
        </p>
      </div>

      {/* Standard Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {standardSkills.map(renderSkillCard)}
      </div>

      {/* Advanced / High Risk Section Toggle */}
      <div className="pt-4">
        <button 
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
        >
          <div className="h-[1px] flex-1 bg-slate-100" />
          <span className="shrink-0 flex items-center gap-1.5 uppercase tracking-widest text-[11px]">
            {showAdvanced ? t("wizardCopy.skills.hideAdvanced") : t("wizardCopy.skills.showAdvanced")}
            <AlertTriangle className={`w-3.5 h-3.5 ${showAdvanced ? "rotate-180" : ""} transition-transform`} />
          </span>
          <div className="h-[1px] flex-1 bg-slate-100" />
        </button>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 animate-in slide-in-from-top-2 duration-300">
          {highRiskSkills.map(renderSkillCard)}
        </div>
      )}

      {/* Credentials Configuration */}
      {skillPolicies.some(s => s.requiresKey && activeSkills.includes(s.id)) && (
        <Card className="p-5 border-blue-100 rounded-2xl bg-blue-50/10 space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 border-b border-blue-100 pb-2">
            <Key className="w-5 h-5 text-blue-600" />
            <h4 className="text-sm font-bold text-blue-900">🔒 {t("wizardCopy.skills.credentialsTitle")}</h4>
          </div>

          <div className="grid grid-cols-1 gap-5">
            {skillPolicies
              .filter(s => s.requiresKey && activeSkills.includes(s.id))
              .map(s => {
                const testStatus = testResults[`skill_${s.id}`];
                const isTesting = testStatus?.loading;
                const testRes = testStatus?.result;

                return (
                  <div key={s.id} className="space-y-2">
                    <div className="flex justify-between items-center bg-slate-100/40 p-1.5 px-3 rounded-lg border border-slate-200/50">
                      <Label className="text-sm font-semibold text-slate-700">{getSkillCopy(s.id, "label")}</Label>
                      <button
                        type="button"
                        onClick={() => testSkill(s.id)}
                        disabled={isTesting}
                        className="text-[13px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1.5"
                      >
                        {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t("wizardCopy.skills.test")}
                      </button>
                    </div>

                    <Input
                      type="password"
                      placeholder={getSkillCopy(s.id, "placeholder")}
                      value={(data as any)[s.requiresKey!] || ""}
                      onChange={(e: any) => update(s.requiresKey as any, e.target.value)}
                      className="bg-white font-mono text-sm h-11 border-slate-200"
                    />

                    {testRes && (
                      <div className={`mt-2 p-3 rounded-lg text-[13px] flex items-start gap-2.5 border ${
                        testRes.success ? "text-green-800 bg-green-50 border-green-200" : "text-red-800 bg-red-50 border-red-200"
                      }`}>
                        {testRes.success ? <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" /> : <AlertOctagon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
                        <span className="font-mono">{testRes.message || testRes.error}</span>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      {dockerAlert && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-6 space-y-6 shadow-2xl animate-in zoom-in-95 duration-200 bg-white border border-slate-200">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertTriangle className="w-8 h-8 shrink-0" />
              <h3 className="text-xl font-bold text-slate-900">{t("wizardCopy.skills.blockedTitle")}</h3>
            </div>
            <p className="text-sm text-slate-650 leading-relaxed font-medium">
              {dockerAlert}
            </p>
            <div className="flex gap-3 pt-2">
              <Button 
                className="flex-1 bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-100 text-white font-semibold h-11 rounded-xl"
                onClick={() => setDockerAlert(null)}
              >
                {t("wizardCopy.skills.acknowledge")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

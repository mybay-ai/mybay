import React from "react";
import { motion } from "motion/react";
import { Shield, Lock, Eye, FileText, Globe, LifeBuoy, Clock, ArrowLeft, Rocket } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const PrivacyPage: React.FC = () => {
  const { t, i18n } = useTranslation("marketing");
  const isZh = i18n.language === "zh-CN";

  const lastUpdated = "2026.08.14";

  const sectionsTemp = t("privacy.sections", { returnObjects: true });
  const sections = Array.isArray(sectionsTemp) ? sectionsTemp : [];

  const iconMap: Record<string, any> = {
    collection: Eye,
    usage: Lock,
    retention: Shield,
    thirdparty: Globe
  };

  return (
    <div className="min-h-screen bg-[#fafbfc]">
      {/* Hero Section (FAQ style) */}
      <section 
        className="relative overflow-hidden text-white pt-32 pb-24 px-6 sm:px-8 border-b border-slate-800/80"
        style={{
          background: "radial-gradient(circle at 50% 20%, rgba(91, 102, 255, 0.28), transparent 38%), linear-gradient(135deg, #0b1024 0%, #12183a 50%, #1c1b4f 100%)"
        }}
      >
        <div className="absolute inset-0 opacity-15 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-blue-500 rounded-full blur-[120px]" />
          <div className="absolute top-1/2 right-1/4 w-80 h-80 bg-indigo-500 rounded-full blur-[100px]" />
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px]" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2"
          >
            <Link to="/" className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-[11px] font-bold uppercase tracking-widest">
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("privacy.backHome")}
            </Link>
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl md:text-5xl font-black text-white tracking-tight"
          >
            {t("privacy.title")}
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-sm md:text-base text-white/80 max-w-2xl mx-auto font-normal"
            style={{
              color: "rgba(255, 255, 255, 0.78)",
              lineHeight: "1.8"
            }}
          >
            {t("privacy.subtitle")}
          </motion.p>

          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="pt-2 flex items-center justify-center gap-2 text-slate-500 text-xs font-bold"
          >
            <Clock className="w-3.5 h-3.5" />
            {t("privacy.lastUpdated", { date: lastUpdated })}
          </motion.div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto px-6 py-12 md:py-20">
        <div className="grid grid-cols-1 gap-12 md:gap-16">
          {sections.map((section: any, idx: number) => {
            const Icon = iconMap[section.id] || Shield;
            return (
              <motion.section 
                key={section.id} 
                id={section.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.05 }}
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
                    {section.title}
                  </h2>
                </div>
                <div className="bg-white border border-slate-150 rounded-2xl p-6 md:p-8 shadow-sm">
                  <ul className="space-y-4">
                    {section.content.map((point, pIdx) => (
                      <li key={pIdx} className="flex gap-3 text-sm md:text-base text-slate-600 leading-relaxed">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-100 border border-blue-200 mt-2.5 shrink-0" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.section>
            );
          })}

          <section className="bg-slate-50 border border-slate-150 rounded-3xl p-8 text-center space-y-4">
            <h3 className="text-lg font-bold text-slate-900">
              {t("privacy.questions", { defaultValue: "Have questions?" })}
            </h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              {t("privacy.questionsDesc", { defaultValue: "If you have any queries regarding credentials security or storage policies, let us know." })}
            </p>
            <a 
              href="mailto:support@mybay.ai" 
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white hover:bg-slate-800 transition-colors rounded-xl text-sm font-bold shadow-sm"
            >
              <LifeBuoy className="w-4 h-4" />
              support@mybay.ai
            </a>
          </section>

          <footer className="text-center pt-8 border-t border-slate-100">
            <p className="text-xs text-slate-400 font-medium">
              {t("privacy.footer")}
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
};

export default PrivacyPage;

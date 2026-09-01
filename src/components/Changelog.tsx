import React from "react";
import { motion } from "motion/react";
import { Tag, Calendar, Rocket, Bug, Zap, ChevronRight, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface Release {
  version: string;
  date: string;
  badge?: string;
  summary: string;
  sections: {
    title: string;
    items: string[];
    type: 'feat' | 'fix' | 'pref' | 'core';
  }[];
}

const ChangelogPage: React.FC = () => {
  const { t, i18n } = useTranslation("marketing");
  const isZh = i18n.language === "zh-CN";
  const releasesTemp = t("changelog.releases", { returnObjects: true });
  const releases = Array.isArray(releasesTemp) ? releasesTemp : [];

  return (
    <div className="min-h-screen bg-app-canvas text-content selection:bg-blue-100 selection:text-blue-900">
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
          <div className="mb-2">
            <Link to="/" className="inline-flex items-center gap-1.5 text-content-muted hover:text-white transition-colors text-[11px] font-bold uppercase tracking-widest text-left">
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("changelog.backHome", { defaultValue: "Back to Home" })}
            </Link>
          </div>
          <motion.h1 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl md:text-5xl font-black text-white tracking-tight"
          >
            {t("changelog.title")}
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-sm md:text-base text-white/80 max-w-xl mx-auto font-normal leading-relaxed"
          >
            {t("changelog.subtitle")}
          </motion.p>
        </div>
      </section>

      <main className="max-w-4xl mx-auto px-6 py-16 md:py-24">

        {/* Timeline */}
        <div className="space-y-24 relative">
          {/* Vertical line shadow */}
          <div className="absolute left-6 md:left-[39.5px] top-4 bottom-0 w-[1px] bg-outline -z-10" />

          {releases.map((release, rIdx) => (
            <motion.section 
              key={release.version}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative pl-16 md:pl-24"
            >
              {/* Dot */}
              <div className="absolute left-5 md:left-9 top-1.5 w-3 h-3 rounded-full border-2 border-blue-600 bg-surface ring-4 ring-surface" />
              
              <div className="flex flex-col md:flex-row md:items-baseline justify-between mb-6 gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl md:text-3xl font-black text-content tracking-tight">
                    {release.version}
                  </h2>
                  {release.badge && (
                    <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-0.5 rounded-full ring-1 ring-blue-100">
                      {release.badge}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-content-muted">
                  <Calendar className="w-3.5 h-3.5" />
                  <span className="text-xs font-mono font-medium">{release.date}</span>
                </div>
              </div>

              <div className="bg-surface-muted/50 rounded-3xl p-6 md:p-8 border border-outline/80">
                <p className="text-content-secondary font-medium mb-8 leading-relaxed">
                  {release.summary}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                  {release.sections.map((section, sIdx) => {
                    const TypeIcon = section.type === 'fix' ? Bug : section.type === 'feat' ? Rocket : Zap;
                    const typeColor = section.type === 'fix' ? 'text-red-500' : section.type === 'feat' ? 'text-emerald-500' : 'text-blue-500';
                    const iconBg = section.type === 'fix' ? 'bg-red-50' : section.type === 'feat' ? 'bg-emerald-50' : 'bg-blue-50';

                    return (
                      <div key={sIdx} className="space-y-4">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${iconBg}`}>
                            <TypeIcon className={`w-3.5 h-3.5 ${typeColor}`} />
                          </div>
                          <h4 className="text-[11px] font-black text-content-muted uppercase tracking-widest">
                            {section.title}
                          </h4>
                        </div>
                        <ul className="space-y-3">
                          {section.items.map((item, iIdx) => (
                            <li key={iIdx} className="flex gap-2 text-[13px] text-content-secondary leading-relaxed group">
                              <span className="text-content-muted mt-1.5 shrink-0 group-hover:text-blue-400 transition-colors">
                                <ChevronRight className="w-3 h-3" />
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          ))}
        </div>

      </main>
    </div>
  );
};

export default ChangelogPage;

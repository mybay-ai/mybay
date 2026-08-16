import { ArrowRight, CheckCircle2, ChevronRight, Cpu, Layers, MessageSquare, ShieldCheck, Box, Terminal, Lock, Globe, Server, Activity, Users, Lightbulb } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui";
import { motion } from "motion/react";
import { ConsoleMockup } from "../components/ConsoleMockup";
import { InteractiveAgentDemo } from "../components/InteractiveAgentDemo";
import { PROVIDERS, CHANNELS } from "../../../constants/logos";

const coreCapabilitiesIcons = [
  <Box className="w-5 h-5 text-blue-600" />,
  <Globe className="w-5 h-5 text-indigo-600" />,
  <Lock className="w-5 h-5 text-slate-600" />,
  <Cpu className="w-5 h-5 text-purple-600" />,
  <MessageSquare className="w-5 h-5 text-cyan-600" />,
  <Terminal className="w-5 h-5 text-emerald-600" />,
  <Activity className="w-5 h-5 text-rose-600" />,
  <Server className="w-5 h-5 text-amber-600" />
];

export function MainLandingPage({ currentUser }: { currentUser: any }) {
  const { t } = useTranslation("marketing");

  const ctaLink = currentUser ? "/app" : "/register";
  const ctaText = t("mainLanding.ctaText");

  return (
    <div className="bg-slate-50 font-sans text-slate-900 overflow-x-hidden pt-20 text-left">
      
      {/* Hero Section */}
      <section className="relative px-4 pt-16 pb-20 md:pt-24 md:pb-32 lg:pt-32 lg:pb-40 text-center">
        <div className="max-w-7xl mx-auto flex flex-col items-center text-center space-y-8 z-10 relative">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-tight max-w-4xl text-center">
            <>
              {t("mainLanding.heroTitle1")}
              {t("mainLanding.heroTitle2")}
              <span className="text-blue-600">{t("mainLanding.heroTitle3")}</span>
            </>
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-slate-600 max-w-2xl leading-relaxed text-center">
            {t("mainLanding.heroDesc")}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 w-full sm:w-auto px-4 sm:px-0">
            <Link to={ctaLink} className="w-full sm:w-auto">
              <Button size="xl" className="w-full sm:w-auto shadow-md rounded-full">
                {currentUser ? (t("mainLanding.dashboardText")) : ctaText}
              </Button>
            </Link>
            <a href="#how-it-works" className="w-full sm:w-auto">
              <Button size="xl" variant="outline" className="w-full sm:w-auto rounded-full bg-white border-slate-200">
                {t("mainLanding.viewFlow")}
              </Button>
            </a>
          </div>

          <ConsoleMockup />
        </div>
      </section>

      <InteractiveAgentDemo />

      {/* Pain Points Comparison */}
      <section className="py-20 bg-white border-y border-slate-200 px-4 text-left">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4 text-center">
              {t("mainLanding.whyNeedHeader")}
            </h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-lg text-center">
              {t("mainLanding.whyNeedDesc")}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch text-left">
            {/* Old Way */}
            <div className="p-8 md:p-10 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col text-left">
              <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3 text-left">
                <Box className="text-slate-400 w-6 h-6" />
                {t("mainLanding.traditionalTitle")}
              </h3>
              <ul className="space-y-4 mb-8 flex-1 text-left">
                {(() => {
                  const items = t("mainLanding.traditionalItems", { returnObjects: true });
                  const itemsArr = Array.isArray(items) ? items : [];
                  return itemsArr.map((item, index) => (
                    <li key={index} className="flex gap-3 text-slate-600 text-left">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-2 shrink-0" />
                      {item}
                    </li>
                  ));
                })()}
              </ul>
              <div className="text-sm font-semibold text-slate-500 bg-white p-4 border border-slate-200 rounded-lg text-center">
                {t("mainLanding.traditionalFooter")}
              </div>
            </div>

            {/* MyBay Way */}
            <div className="p-8 md:p-10 bg-blue-50 border border-blue-200 rounded-2xl shadow-sm flex flex-col text-left">
              <h3 className="text-xl font-bold text-blue-900 mb-6 flex items-center gap-3 text-left">
                <ShieldCheck className="text-blue-600 w-6 h-6" />
                {t("mainLanding.mybayTitle")}
              </h3>
              <ul className="space-y-4 mb-8 flex-1 text-left">
                {(() => {
                  const items = t("mainLanding.mybayItems", { returnObjects: true });
                  const itemsArr = Array.isArray(items) ? items : [];
                  return itemsArr.map((item, index) => (
                    <li key={index} className="flex gap-3 text-blue-800 text-left">
                      <CheckCircle2 className="w-5 h-5 text-blue-500 shrink-0" />
                      {item}
                    </li>
                  ));
                })()}
              </ul>
              <div className="text-sm font-bold text-blue-700 bg-white p-4 border border-blue-100 rounded-lg text-center shadow-sm">
                {t("mainLanding.mybayFooter")}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4 Steps Section */}
      <section id="how-it-works" className="py-20 px-4 bg-slate-50 text-left">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4 text-center">
              {t("mainLanding.stepsHeader")}
            </h2>
            <p className="text-slate-500 text-center">
              {t("mainLanding.stepsDesc")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
             <div className="bg-white p-8 rounded-2xl border border-slate-200 text-left">
                <div className="text-3xl font-black text-slate-200 mb-4">01</div>
                <h3 className="font-bold text-lg mb-2 text-slate-900 text-left">
                  {t("mainLanding.step1Title")}
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed text-left">
                  {t("mainLanding.step1Desc")}
                </p>
             </div>
             <div className="bg-white p-8 rounded-2xl border border-slate-200 text-left">
                <div className="text-3xl font-black text-slate-200 mb-4">02</div>
                <h3 className="font-bold text-lg mb-2 text-slate-900 text-left">
                  {t("mainLanding.step2Title")}
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed text-left">
                  {t("mainLanding.step2Desc")}
                </p>
             </div>
             <div className="bg-white p-8 rounded-2xl border border-slate-200 text-left">
                <div className="text-3xl font-black text-slate-200 mb-4">03</div>
                <h3 className="font-bold text-lg mb-2 text-slate-900 text-left">
                  {t("mainLanding.step3Title")}
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed text-left">
                  {t("mainLanding.step3Desc")}
                </p>
             </div>
             <div className="bg-white p-8 rounded-2xl border border-blue-200 bg-blue-50/30 text-left">
                <div className="text-3xl font-black text-blue-300 mb-4">04</div>
                <h3 className="font-bold text-lg mb-2 text-blue-900 text-left">
                  {t("mainLanding.step4Title")}
                </h3>
                <p className="text-blue-700/80 text-sm leading-relaxed text-left">
                  {t("mainLanding.step4Desc")}
                </p>
             </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities */}
      <section className="py-20 bg-white border-y border-slate-200 px-4 text-left">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
             <h2 className="text-3xl font-bold text-slate-900 mb-4 text-center">
               {t("mainLanding.capabilitiesHeader")}
             </h2>
             <p className="text-slate-500 text-lg text-center">
               {t("mainLanding.capabilitiesDesc")}
             </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
            {((Array.isArray(t("mainLanding.coreCapabilities", {returnObjects: true})) ? t("mainLanding.coreCapabilities", {returnObjects: true}) : []) as any[]).map((cap, idx) => (
              <div key={idx} className="p-6 bg-slate-50 rounded-xl border border-slate-100 text-left">
                 <div className="w-10 h-10 bg-white shadow-sm border border-slate-200 rounded-lg flex items-center justify-center mb-4">
                    {coreCapabilitiesIcons[idx]}
                 </div>
                 <h3 className="font-bold text-slate-900 mb-2 text-left">{cap.title}</h3>
                 <p className="text-sm text-slate-600 leading-relaxed text-left">{cap.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Target Audiences */}
      <section className="py-20 bg-slate-900 px-4 text-left">
        <div className="max-w-7xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-white mb-12 text-center">
              {t("mainLanding.audiencesHeader")}
            </h2>
            <div className="flex flex-wrap justify-center gap-4 text-left">
               {((Array.isArray(t("mainLanding.audiences", {returnObjects: true})) ? t("mainLanding.audiences", {returnObjects: true}) : []) as any[]).map(aud => (
                 <div key={aud.title} className="w-full sm:w-auto text-left sm:text-center p-6 bg-slate-800 rounded-xl border border-slate-700 max-w-sm">
                    <h4 className="text-lg font-bold text-blue-400 mb-2 text-left sm:text-center">{aud.title}</h4>
                    <p className="text-slate-400 text-sm text-left sm:text-center">{aud.desc}</p>
                 </div>
               ))}
            </div>
        </div>
      </section>

      {/* Security & Arch */}
      <section className="py-20 bg-white px-4 text-left">
        <div className="max-w-4xl mx-auto text-center">
           <h2 className="text-3xl font-bold text-slate-900 mb-8 text-center">
             {t("mainLanding.securityHeader")}
           </h2>
           <p className="text-slate-600 text-lg leading-relaxed mb-12 text-center">
             {t("mainLanding.securityDesc")}
           </p>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <div className="border border-slate-200 p-6 rounded-xl text-left">
                 <Lock className="w-6 h-6 text-slate-600 mb-4" />
                 <h4 className="font-bold mb-2 text-left">{t("mainLanding.securityBox1Title")}</h4>
                 <p className="text-sm text-slate-500 text-left">{t("mainLanding.securityBox1Desc")}</p>
              </div>
              <div className="border border-slate-200 p-6 rounded-xl text-left">
                 <Layers className="w-6 h-6 text-slate-600 mb-4" />
                 <h4 className="font-bold mb-2 text-left">{t("mainLanding.securityBox2Title")}</h4>
                 <p className="text-sm text-slate-500 text-left">{t("mainLanding.securityBox2Desc")}</p>
              </div>
              <div className="border border-slate-200 p-6 rounded-xl text-left">
                 <Globe className="w-6 h-6 text-slate-600 mb-4" />
                 <h4 className="font-bold mb-2 text-left">{t("mainLanding.securityBox3Title")}</h4>
                 <p className="text-sm text-slate-500 text-left">{t("mainLanding.securityBox3Desc")}</p>
              </div>
           </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-slate-50 border-t border-slate-200 px-4 text-left">
        <div className="max-w-3xl mx-auto text-left">
          <div className="text-center mb-12 text-left">
            <h2 className="text-3xl font-bold text-slate-900 mb-4 text-center">
              {t("mainLanding.faqHeader")}
            </h2>
            <p className="text-slate-500 text-center">
              {t("mainLanding.faqDesc")}
            </p>
          </div>
          <div className="space-y-4 text-left">
            {((Array.isArray(t("mainLanding.faqs", {returnObjects: true})) ? t("mainLanding.faqs", {returnObjects: true}) : []) as any[]).map((faq, idx) => (
              <div key={idx} className="bg-white border border-slate-200 p-6 rounded-xl text-left">
                 <h4 className="font-bold text-slate-900 mb-3 flex items-start gap-2 text-left">
                   <div className="w-6 h-6 bg-blue-100 text-blue-600 flex items-center justify-center rounded text-sm shrink-0 font-bold">Q</div>
                   <span className="mt-0.5 text-left">{faq.q}</span>
                 </h4>
                 <p className="text-slate-600 leading-relaxed text-sm pl-8 text-left">
                   {faq.a}
                 </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-slate-900 text-center px-4 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full max-w-3xl mx-auto bg-blue-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="max-w-3xl mx-auto relative z-10 text-center">
           <h2 className="text-3xl md:text-4xl font-bold text-white mb-8 text-center font-sans tracking-tight">
             {t("mainLanding.ctaHeader")}
           </h2>
           <Link to={ctaLink} className="w-full sm:w-auto">
             <Button size="xl" className="shadow-lg shadow-blue-500/20 rounded-full w-full sm:w-auto px-10">
               {currentUser ? (t("mainLanding.dashboardText")) : (t("mainLanding.ctaButton"))}
             </Button>
           </Link>
        </div>
      </section>

    </div>
  );
}

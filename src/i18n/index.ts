import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import commonZh from "../locales/zh-CN/common.json";
import commonEn from "../locales/en/common.json";
import authZh from "../locales/zh-CN/auth.json";
import authEn from "../locales/en/auth.json";
import marketingZh from "../locales/zh-CN/marketing.json";
import marketingEn from "../locales/en/marketing.json";
import dashboardZh from "../locales/zh-CN/dashboard/index";
import dashboardEn from "../locales/en/dashboard/index";
import deployZh from "../locales/zh-CN/deploy.json";
import deployEn from "../locales/en/deploy.json";
import adminZh from "../locales/zh-CN/admin.json";
import adminEn from "../locales/en/admin.json";
import demoZh from "../locales/zh-CN/demo.json";
import demoEn from "../locales/en/demo.json";
import errorsZh from "../locales/zh-CN/errors.json";
import errorsEn from "../locales/en/errors.json";
import docsZh from "../locales/zh-CN/docs.json";
import docsEn from "../locales/en/docs.json";

// Get saved language or detect
const getSavedLanguage = () => {
  try {
    const saved = localStorage.getItem("mybay_language");
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch (_) {}
  
  return "zh-CN";
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": {
        common: commonZh,
        auth: authZh,
        marketing: marketingZh,
        dashboard: dashboardZh,
        deploy: deployZh,
        admin: adminZh,
        demo: demoZh,
        errors: errorsZh,
        docs: docsZh,
      },
      en: {
        common: commonEn,
        auth: authEn,
        marketing: marketingEn,
        dashboard: dashboardEn,
        deploy: deployEn,
        admin: adminEn,
        demo: demoEn,
        errors: errorsEn,
        docs: docsEn,
      },
    },
    lng: getSavedLanguage(),
    fallbackLng: "zh-CN",
    ns: ["common", "auth", "marketing", "dashboard", "deploy", "admin", "demo", "errors", "docs"],
    defaultNS: "common",
    interpolation: {
      escapeValue: false, // React already safe from XSS
    },
  });

export default i18n;

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_MYBAY_PLATFORM_ORIGIN?: string;
  readonly VITE_CONTACT_SUPPORT_EMAIL?: string;
  readonly VITE_CONTACT_BUSINESS_EMAIL?: string;
  readonly VITE_CONTACT_MIGRATION_EMAIL?: string;
  readonly VITE_CONTACT_TELEGRAM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

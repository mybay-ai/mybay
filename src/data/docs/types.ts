export interface DocSection {
  title: string;
  paragraphs: string[];
  callout?: {
    type: "info" | "warning" | "danger" | "success";
    title?: string;
    text: string;
  };
  steps?: {
    title: string;
    content: string;
  }[];
  codeBlock?: {
    code: string;
    language: string;
    filename?: string;
  };
}

export interface DocContent {
  title: string;
  summary: string;
  sections: DocSection[];
}

export interface StructuredDoc {
  id: string; // e.g., "getting_started", "chat_workspace"
  slug?: string; // e.g., "getting-started", "chat-workspace"
  categoryId: string; // e.g., "quickstart"
  audience: "all" | "owner" | "admin" | "operator";
  applicableVersion: string; // e.g., "v1.4.0+"
  applicableVersionEn?: string;
  updatedAt: string; // e.g., "2026-07-12"
  publishedAt?: string;
  breadcrumbLabel?: {
    "zh-CN": string;
    en: string;
  };
  keywords?: {
    "zh-CN": string[];
    en: string[];
  };
  content: {
    "zh-CN": DocContent;
    en: DocContent;
  };
}

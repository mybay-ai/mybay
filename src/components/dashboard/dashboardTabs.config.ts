import { LayoutDashboard, Box, FolderOpen, ShieldCheck, History, CheckCircle2, ShieldAlert, FileText, LucideIcon, LifeBuoy } from "lucide-react";
import { APP_ROUTES } from "../../constants/routes";

export interface TabConfig {
  key: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  path?: string;
}

export const DASHBOARD_TABS: TabConfig[] = [
  {
    key: "overview",
    label: "",
    title: "",
    description: "",
    icon: LayoutDashboard,
    path: APP_ROUTES.DASHBOARD
  },
  {
    key: "instances",
    label: "Instances",
    title: "Agent Instances",
    description: "Manage local Hermes Agent instances",
    icon: Box,
    path: APP_ROUTES.INSTANCES
  },
  {
    key: "instance-files",
    label: "",
    title: "",
    description: "",
    icon: FolderOpen
  },
  {
    key: "credentials",
    label: "Credentials",
    title: "BYOK Credentials",
    description: "Manage your own model API keys and OpenAI-compatible endpoints",
    icon: ShieldCheck,
    path: APP_ROUTES.CREDENTIALS
  },
  {
    key: "versions",
    label: "",
    title: "",
    description: "",
    icon: History
  },
  {
    key: "tasks",
    label: "Tasks",
    title: "Background Tasks",
    description: "Monitor local background jobs and instance operations",
    icon: CheckCircle2,
    adminOnly: true
  },
  {
    key: "system",
    label: "System",
    title: "Local Security",
    description: "Configure local host and container security switches",
    icon: ShieldAlert,
    adminOnly: true
  },
  {
    key: "template-content",
    label: "Templates",
    title: "Template Management",
    description: "Manage local workflows and blueprint templates",
    icon: FileText,
    adminOnly: true
  },
  {
    key: "contact",
    label: "Contact",
    title: "Project Links",
    description: "Documentation, support links, and project information",
    icon: LifeBuoy
  }
];

export function getTabConfig(key: string): TabConfig | undefined {
  return DASHBOARD_TABS.find(tab => tab.key === key);
}

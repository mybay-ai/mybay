import type { TemplateCapabilityLevel, TemplateReadinessRequirement } from "./productionPolicy";

export interface TemplateOption {
  label: string;
  value: string;
  description?: string;
}

export interface WorkflowTemplateInput {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "url" | "url_list" | "number" | "time" | "file" | "json" | "boolean";
  description?: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<string | TemplateOption>;
  defaultValue?: any;
  accept?: string;
  maxSizeMb?: number;
}

export interface WorkflowTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  use_case: string;
  tags: string[];
  default_provider: string;
  default_model: string;
  default_channel: string;
  default_prompt: string;
  default_skills: string[];
  default_config: Record<string, any>;
  required_inputs: WorkflowTemplateInput[];
  supported_triggers: string[];
  default_trigger: {
    type: "schedule" | "webhook" | "message" | "file_upload" | "manual";
    cron?: string;
    interval?: string;
  };
  default_output: {
    type: string;
    details?: string;
  };
  required_permissions: Array<{
    skill: string;
    permission: string;
    risk: "low" | "medium" | "high";
    reason: string;
  }>;
  setup_steps: string[];
  initial_tasks: Array<{
    title: string;
    status: "queued" | "manual_ready" | "completed";
  }>;
  risk_level: "low" | "medium" | "high";
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  readiness?: "ready" | "llm_report_ready" | "simulated" | "requires_webhook" | "requires_file_parser" | "requires_channel_auth" | "coming_soon";
  created_at?: string;
  updated_at?: string;
  target_audience?: string;
  readiness_checklist?: string[];
  post_deploy_guide?: string[];
  next_actions?: any[];
  limitations?: string[];
  automation_result?: string;
  business_value?: string;
  translations?: Partial<Record<"zh-CN" | "en", Record<string, unknown>>>;
  capability_level?: TemplateCapabilityLevel;
  readiness_requirements?: TemplateReadinessRequirement[];
}

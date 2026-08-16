export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  default_prompt?: string;
  default_skills?: string[];
  default_channel?: string;
  risk_level?: string;
  capability_level?: "production" | "beta" | "demo" | "coming_soon";
  readiness_requirements?: Array<Record<string, unknown>>;
  readiness?: "ready" | "llm_report_ready" | "simulated" | "requires_webhook" | "requires_file_parser" | "requires_channel_auth" | "coming_soon";
  target_audience?: string;
  automation_result?: string;
  readiness_checklist?: string[];
  setup_steps?: string[];
  post_deploy_guide?: string[];
  next_actions?: any[];
  limitations?: string | string[];
  business_value?: string | string[];
  version?: string; // added optional version for safety
}

export interface IndustryBlueprint {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  recommended_skills: string[];
  recommended_channels: string[];
  referenced_workflow_template_ids: string[];
  system_context_preview: string;
  post_deploy_guide: string[];
  required_setup_items: string[];
  target_audience?: string;
  business_value?: string | string[];
  readiness_checklist?: string[];
  next_actions?: any[];
  limitations?: string | string[];
}

export interface BlueprintProductDetail {
  targetAudience: string;
  businessImpact: string[];
  preparationNotice: string[];
  techSpec: string;
  limitations?: string | string[];
}

export interface WorkflowProductDetail {
  targetAudience: string;
  automationResult: string;
  keyRequirements: string[];
  triggerMode: string;
  limitations?: string | string[];
  business_value?: string | string[];
}

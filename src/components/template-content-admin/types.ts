export interface TemplateItem {
  id: string;
  slug?: string;
  name: string;
  description: string;
  category: string;
  is_active: boolean;
  sort_order: number;
  target_audience?: string;
  business_value?: string[] | string;
  automation_result?: string;
  readiness_checklist?: string[] | string;
  post_deploy_guide?: string[] | string;
  setup_steps?: string[] | string;
  limitations?: string[] | string;
  next_actions?: any;
  is_system?: boolean;
}

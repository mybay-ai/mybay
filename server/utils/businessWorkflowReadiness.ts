export interface BusinessWorkflowReadiness {
  ready: boolean;
  missingFields: string[];
  message?: string;
  setupSection?: string;
}

const ECOMMERCE_TEMPLATE_RE = /(ecommerce|competitor-price-monitor|cross-border-ecom)/i;

export function isBusinessWorkflowTemplate(templateKey?: string | null): boolean {
  return ECOMMERCE_TEMPLATE_RE.test(String(templateKey || ""));
}

function hasValue(value: any): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null) return false;
  return String(value).trim().length > 0;
}

export function getBusinessWorkflowReadiness(
  templateKey: string | null | undefined,
  configJson: any
): BusinessWorkflowReadiness {
  if (!isBusinessWorkflowTemplate(templateKey)) {
    return { ready: true, missingFields: [] };
  }

  const businessConfig = configJson?.businessConfig || {};
  const templateInputs = configJson?.template_inputs || {};
  const missingFields: string[] = [];

  if (!hasValue(businessConfig.shopUrl || templateInputs.shopUrl || templateInputs.storefront_url)) {
    missingFields.push("shopUrl");
  }

  if (!hasValue(businessConfig.monitorSkus || templateInputs.monitorSkus || templateInputs.product_urls || templateInputs.competitor_urls)) {
    missingFields.push("monitorSkus");
  }

  const ready = missingFields.length === 0;
  return {
    ready,
    missingFields,
    setupSection: "shop-monitor",
    message: ready
      ? undefined
      : `请先完成独立站运营配置：${missingFields.join(", ")}`
  };
}

export function buildConfigRequiredPayload(templateKey: string, configJson: any) {
  const readiness = getBusinessWorkflowReadiness(templateKey, configJson);
  return {
    readiness: readiness.ready ? "ready" : "config_required",
    missing_fields: readiness.missingFields,
    setup_section: readiness.setupSection,
    setup_message: readiness.message
  };
}

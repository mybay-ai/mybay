export interface RuntimeContext {
  templateKey: string;
  mode: "template" | "generic";
  businessContext: Record<string, any>;
  summary: {
    hasBusinessConfig: boolean;
    completedRequiredCount: number;
    totalRequiredCount: number;
  };
}

export function parseInstanceRuntimeContext(
  instance: any,
  configJson: any,
  businessConfig: any
): RuntimeContext {
  const templateKey =
    instance?.blueprint_slug ||
    instance?.blueprint_id ||
    instance?.metadata?.blueprint_slug ||
    instance?.metadata?.blueprint_id ||
    configJson?.blueprintSlug ||
    configJson?.blueprintId ||
    instance?.template_slug ||
    instance?.template_id ||
    instance?.metadata?.template_slug ||
    instance?.metadata?.template_id ||
    configJson?.templateSlug ||
    configJson?.templateName ||
    "generic";

  const isEcommerce = /(ecommerce|competitor-price-monitor|cross-border-ecom)/i.test(templateKey);
  const isCollaboration = /(team-collaboration|feishu|pdf-summary|lead-form)/i.test(templateKey);
  const isContent = /(content-marketing|xiaohongshu|short-video|daily-news)/i.test(templateKey);

  const mode = (isEcommerce || isCollaboration || isContent) ? "template" : "generic";
  const bConfig = businessConfig || {};
  
  const businessContext: Record<string, any> = {};
  
  if (isEcommerce) {
    businessContext.shopUrl = bConfig.shopUrl || "";
    
    // Normalize monitorSkus to array
    if (typeof bConfig.monitorSkus === "string") {
      businessContext.monitorSkus = bConfig.monitorSkus.split(",").map((s: string) => s.trim()).filter(Boolean);
    } else if (Array.isArray(bConfig.monitorSkus)) {
      businessContext.monitorSkus = bConfig.monitorSkus;
    } else {
      businessContext.monitorSkus = [];
    }
    
    businessContext.delayThreshold = bConfig.delayThreshold ? Number(bConfig.delayThreshold) : 24;
    businessContext.refundAlert = !!bConfig.refundAlert;
    
    // Normalize notifyChannels to array
    if (typeof bConfig.notifyChannels === "string") {
      businessContext.notifyChannels = bConfig.notifyChannels.split("\n").map((s: string) => s.trim()).filter(Boolean);
    } else {
      businessContext.notifyChannels = [];
    }
  } else if (isCollaboration) {
    businessContext.teamScope = bConfig.teamScope || "";
    businessContext.summaryGoal = bConfig.summaryGoal || "";
    businessContext.sourceDescription = bConfig.sourceDescription || "";
    if (typeof bConfig.notifyChannels === "string") {
      businessContext.notifyChannels = bConfig.notifyChannels.split("\n").map((s: string) => s.trim()).filter(Boolean);
    } else {
      businessContext.notifyChannels = [];
    }
  } else if (isContent) {
    businessContext.brandName = bConfig.brandName || "";
    businessContext.niche = bConfig.niche || "";
    businessContext.targetAudience = bConfig.targetAudience || "";
    businessContext.contentStyle = bConfig.contentStyle || "";
    if (typeof bConfig.notifyChannels === "string") {
      businessContext.notifyChannels = bConfig.notifyChannels.split("\n").map((s: string) => s.trim()).filter(Boolean);
    } else {
      businessContext.notifyChannels = [];
    }
  } else {
    Object.assign(businessContext, bConfig);
  }

  // Determine required counts based on schema simplified logic
  let totalRequiredCount = 0;
  let completedRequiredCount = 0;
  
  const hasBusinessConfig = Object.keys(bConfig).length > 0;
  
  if (isEcommerce) {
    totalRequiredCount = 3; // shopUrl, monitorSkus, delayThreshold
    if (businessContext.shopUrl) completedRequiredCount++;
    if (businessContext.monitorSkus?.length > 0) completedRequiredCount++;
    if (businessContext.delayThreshold) completedRequiredCount++;
  } else if (isCollaboration) {
    totalRequiredCount = 1; // teamScope
    if (businessContext.teamScope) completedRequiredCount++;
  } else if (isContent) {
    totalRequiredCount = 2; // brandName, niche
    if (businessContext.brandName) completedRequiredCount++;
    if (businessContext.niche) completedRequiredCount++;
  }

  return {
    templateKey,
    mode,
    businessContext,
    summary: {
      hasBusinessConfig,
      completedRequiredCount,
      totalRequiredCount
    }
  };
}

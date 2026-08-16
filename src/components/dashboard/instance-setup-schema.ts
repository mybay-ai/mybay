export interface SetupField {
  id: string;
  type: "text" | "textarea" | "number" | "checkbox" | "select";
  labelKey: string;
  placeholderKey?: string;
  descKey?: string;
  required?: boolean;
  options?: { labelKey: string; value: string }[];
}

export interface SetupSection {
  id: string;
  iconName: "Settings" | "Globe" | "Bell" | "MessageSquare" | "FileText" | "Users" | "PenTool";
  titleKey: string;
  descKey: string;
  fields: SetupField[];
}

export interface SetupSchema {
  templateIdPattern?: RegExp;
  sections: SetupSection[];
}

export const SETUP_SCHEMAS: SetupSchema[] = [
  // 1. ecommerce-operation / competitor-price-monitor / ecommerce-order-alert
  {
    templateIdPattern: /(ecommerce|competitor-price-monitor|cross-border-ecom)/i,
    sections: [
      {
        id: "shop-monitor",
        iconName: "Globe",
        titleKey: "setup_shop_monitor_title",
        descKey: "setup_shop_monitor_desc",
        fields: [
          {
            id: "shopUrl",
            type: "text",
            labelKey: "setup_shop_url_label",
            placeholderKey: "setup_shop_url_placeholder",
            required: true
          },
          {
            id: "monitorSkus",
            type: "textarea",
            labelKey: "setup_shop_skus_label",
            placeholderKey: "setup_shop_skus_placeholder",
            required: true
          }
        ]
      },
      {
        id: "alerts",
        iconName: "Bell",
        titleKey: "setup_alerts_title",
        descKey: "setup_alerts_desc",
        fields: [
          {
            id: "delayThreshold",
            type: "number",
            labelKey: "setup_alerts_delay_label",
            placeholderKey: "24",
            required: true
          },
          {
            id: "refundAlert",
            type: "checkbox",
            labelKey: "setup_alerts_refund_label",
            descKey: "setup_alerts_refund_desc"
          }
        ]
      },
      {
        id: "channel",
        iconName: "MessageSquare",
        titleKey: "setup_channel_title",
        descKey: "setup_channel_desc",
        fields: [
          {
            id: "notifyChannels",
            type: "textarea",
            labelKey: "setup_channel_url_label",
            placeholderKey: "setup_channel_url_placeholder"
          }
        ]
      }
    ]
  },
  // 2. content-marketing-operation / xiaohongshu-topic-generator / short-video-script-analyzer
  {
    templateIdPattern: /(content-marketing|xiaohongshu|short-video|daily-news)/i,
    sections: [
      {
        id: "general",
        iconName: "Settings",
        titleKey: "setup_general_title",
        descKey: "setup_general_desc",
        fields: [
          {
            id: "brandName",
            type: "text",
            labelKey: "setup_brand_name_label",
            placeholderKey: "setup_brand_name_placeholder",
            required: true
          }
        ]
      },
      {
        id: "content-profile",
        iconName: "PenTool",
        titleKey: "setup_content_profile_title",
        descKey: "setup_content_profile_desc",
        fields: [
          {
            id: "niche",
            type: "text",
            labelKey: "setup_niche_label",
            placeholderKey: "setup_niche_placeholder",
            required: true
          },
          {
            id: "targetAudience",
            type: "textarea",
            labelKey: "setup_target_audience_label",
            placeholderKey: "setup_target_audience_placeholder"
          },
          {
            id: "contentStyle",
            type: "text",
            labelKey: "setup_content_style_label",
            placeholderKey: "setup_content_style_placeholder"
          }
        ]
      },
      {
        id: "channel",
        iconName: "MessageSquare",
        titleKey: "setup_channel_title",
        descKey: "setup_channel_desc",
        fields: [
          {
            id: "notifyChannels",
            type: "textarea",
            labelKey: "setup_channel_url_label",
            placeholderKey: "setup_channel_url_placeholder"
          }
        ]
      }
    ]
  },
  // 3. team-collaboration / feishu-message-summary / pdf-summary / lead-form-auto-reply
  {
    templateIdPattern: /(team-collaboration|feishu|pdf-summary|lead-form)/i,
    sections: [
      {
        id: "general",
        iconName: "Settings",
        titleKey: "setup_general_title",
        descKey: "setup_general_desc",
        fields: [
          {
            id: "teamScope",
            type: "text",
            labelKey: "setup_team_scope_label",
            placeholderKey: "setup_team_scope_placeholder",
            required: true
          }
        ]
      },
      {
        id: "knowledge",
        iconName: "FileText",
        titleKey: "setup_knowledge_title",
        descKey: "setup_knowledge_desc",
        fields: [
          {
            id: "summaryGoal",
            type: "textarea",
            labelKey: "setup_summary_goal_label",
            placeholderKey: "setup_summary_goal_placeholder"
          },
          {
            id: "sourceDescription",
            type: "text",
            labelKey: "setup_source_desc_label",
            placeholderKey: "setup_source_desc_placeholder"
          }
        ]
      },
      {
        id: "channel",
        iconName: "MessageSquare",
        titleKey: "setup_channel_title",
        descKey: "setup_channel_desc",
        fields: [
          {
            id: "notifyChannels",
            type: "textarea",
            labelKey: "setup_channel_url_label",
            placeholderKey: "setup_channel_url_placeholder"
          }
        ]
      }
    ]
  }
];

export const FALLBACK_SCHEMA: SetupSchema = {
  sections: [
    {
      id: "general",
      iconName: "Settings",
      titleKey: "setup_general_title",
      descKey: "setup_general_desc",
      fields: []
    }
  ]
};

export function resolveSchema(templateIdOrSlug?: string | null): SetupSchema {
  if (!templateIdOrSlug) return FALLBACK_SCHEMA;
  for (const schema of SETUP_SCHEMAS) {
    if (schema.templateIdPattern && schema.templateIdPattern.test(templateIdOrSlug)) {
      return schema;
    }
  }
  return FALLBACK_SCHEMA;
}

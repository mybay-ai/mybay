export const WORKFLOW_EN_TRANSLATIONS: Record<string, Record<string, unknown>> = {
  "daily-news-briefing": {
    name: "Daily Industry News Briefing",
    description: "Collect, deduplicate, and summarize industry news into a scheduled structured briefing.",
    use_case: "Industry tracking, market intelligence, and technology trend monitoring",
    target_audience: "Marketing leaders, product managers, analysts, founders, and investors.",
    required_inputs: [
      { key: "industry", label: "Industry or topic", description: "Describe the industry or topic to track over time." },
      { key: "sources", label: "Preferred sources", description: "Optional websites, publications, blogs, or announcement pages." },
      { key: "run_time", label: "Daily briefing time", description: "Choose when the briefing should be generated." },
      { key: "notify_channel", label: "Notification channel", description: "Choose where the completed briefing should be delivered." }
    ],
    setup_steps: ["Define the industry and keywords.", "Add preferred information sources.", "Choose a daily run time.", "Run the first briefing and review the output."],
    post_deploy_guide: ["Open instance settings and confirm the monitored topic.", "Check that search capabilities and model credentials are available.", "Run the first briefing manually.", "Configure the recurring schedule and delivery channel."],
    limitations: ["Results depend on source availability, network access, and search-provider coverage."]
  },
  "competitor-price-monitor": {
    name: "Competitor Price Monitor",
    description: "Analyze competitor prices through approved APIs or sandbox-compatible sources and generate price-change alerts.",
    use_case: "Ecommerce pricing, promotion tracking, and price sensitivity analysis",
    target_audience: "Ecommerce sellers, purchasing managers, retail operators, and pricing analysts.",
    required_inputs: [
      { key: "product_urls", label: "Competitor product URLs", description: "Enter the product or comparison-page URLs to monitor." },
      { key: "check_frequency", label: "Check frequency", description: "Choose how often prices should be checked." },
      { key: "price_threshold", label: "Alert threshold (%)", description: "Trigger an alert when the price change reaches this percentage." },
      { key: "notify_channel", label: "Alert channel", description: "Choose where price alerts should be delivered." }
    ],
    setup_steps: ["Add competitor product URLs.", "Set the check frequency.", "Set the price-change threshold.", "Run the first monitoring task."],
    post_deploy_guide: ["Confirm competitor URLs in instance settings.", "Run the first price check and inspect logs.", "Review the generated report.", "Enable the recurring monitoring schedule."],
    limitations: ["Use official APIs where websites restrict automated access."]
  },
  "feishu-message-summary": {
    name: "Feishu Message Summary",
    description: "Summarize authorized group-chat context into decisions, follow-ups, owners, and action items.",
    use_case: "Asynchronous team updates, meeting preparation, and project coordination",
    target_audience: "Team managers and project leads using Feishu or Lark.",
    required_inputs: [
      { key: "feishu_channel", label: "Feishu chat ID", description: "Enter the authorized group or conversation identifier." },
      { key: "summary_period", label: "Summary period", description: "Choose the time range or schedule for summaries." },
      { key: "output_style", label: "Output style", description: "Choose how the summary should be structured." }
    ],
    setup_steps: ["Configure Feishu application credentials.", "Authorize the required message permissions.", "Add the bot to a test chat.", "Run the first summary."],
    post_deploy_guide: ["Verify the Feishu App ID and App Secret.", "Confirm the chat allowlist.", "Send a test message and run a summary.", "Configure the recurring summary schedule."],
    limitations: ["Only messages permitted by the Feishu application can be processed."]
  },
  "pdf-summary": {
    name: "PDF Summary",
    description: "Upload a PDF, extract its structure, summarize key sections, and ask focused follow-up questions.",
    use_case: "Research papers, financial reports, manuals, and compliance documents",
    target_audience: "Researchers, analysts, legal teams, and professionals who review long documents.",
    required_inputs: [
      { key: "file", label: "PDF file", description: "Upload the PDF document to analyze." },
      { key: "summary_goal", label: "Analysis goal", description: "Describe the questions or sections that matter most." },
      { key: "output_language", label: "Output language", description: "Choose the language for the generated report." }
    ],
    setup_steps: ["Upload a PDF file.", "Describe the analysis goal.", "Choose the output language.", "Run the first summary."],
    post_deploy_guide: ["Open Files and upload a test PDF.", "Run PDF summarization.", "Review the outline and key findings.", "Ask follow-up questions in the conversation workspace."],
    limitations: ["Scanned documents may require OCR and complex layouts can reduce extraction quality."]
  },
  "lead-form-auto-reply": {
    name: "Lead Form Auto Reply",
    description: "Receive website form submissions by Webhook and generate a tailored first response using approved product information.",
    use_case: "B2B lead capture, first-touch response, and product-trial guidance",
    target_audience: "Sales teams, customer-success teams, and website operators.",
    required_inputs: [
      { key: "form_fields", label: "Form field schema", description: "Describe the incoming form fields and their meaning." },
      { key: "reply_tone", label: "Reply tone", description: "Choose the tone used for generated replies." },
      { key: "notify_channel", label: "Delivery channel", description: "Choose where replies or notifications are sent." },
      { key: "notify_target", label: "Delivery target", description: "Enter the Webhook URL, email address, or channel destination." }
    ],
    setup_steps: ["Define the incoming form schema.", "Choose the response tone.", "Configure the delivery channel.", "Send a test form payload."],
    post_deploy_guide: ["Copy the instance Webhook URL.", "Configure the external form provider.", "Upload approved product Q&A material.", "Send a test lead and review the response."],
    limitations: ["Generated replies should follow the organization's sales, privacy, and consent policies."]
  },
  "ecommerce-order-alert": {
    name: "Ecommerce Order Exception Alert",
    description: "Receive order Webhooks, evaluate configurable risk rules, and flag suspicious or abnormal orders.",
    use_case: "Order risk checks, promotion abuse detection, and high-value order monitoring",
    target_audience: "Store operators, ecommerce teams, warehouse managers, and risk teams.",
    required_inputs: [
      { key: "order_payload_schema", label: "Order payload example", description: "Provide a representative order JSON payload." },
      { key: "abnormal_rules", label: "Exception rules", description: "Describe the order conditions that should trigger alerts." },
      { key: "notify_channel", label: "Alert channel", description: "Choose where risk alerts are sent." },
      { key: "notify_target", label: "Alert destination", description: "Enter the Webhook URL, email address, or channel destination." }
    ],
    setup_steps: ["Provide an order payload example.", "Define exception rules.", "Configure the alert destination.", "Send a test order payload."],
    post_deploy_guide: ["Copy the order Webhook URL.", "Configure the ecommerce platform callback.", "Send a simulated order.", "Review the risk result and alert delivery."],
    limitations: ["Final blocking, refund, and fulfillment decisions should remain subject to human approval."]
  },
  "xiaohongshu-topic-generator": {
    name: "Xiaohongshu Topic Generator",
    description: "Generate topic plans from a niche, audience profile, reference accounts, and desired content style.",
    use_case: "Social content planning, creator topic libraries, and Xiaohongshu operations",
    target_audience: "Creators, social media teams, personal brands, and content strategists.",
    required_inputs: [
      { key: "niche", label: "Content niche", description: "Describe the account positioning and main content category." },
      { key: "target_audience", label: "Target audience", description: "Describe the audience and their common needs." },
      { key: "competitor_accounts", label: "Reference accounts", description: "Optional accounts or profile URLs to study." },
      { key: "content_style", label: "Content style", description: "Choose the desired tone and presentation style." }
    ],
    setup_steps: ["Define the content niche.", "Describe the target audience.", "Add optional reference accounts.", "Generate the first topic set."],
    post_deploy_guide: ["Open instance settings and confirm the niche.", "Add reference content if available.", "Run the first topic-generation task.", "Review and refine the generated plan."],
    limitations: ["Generated topics should be reviewed for brand and platform compliance."]
  },
  "short-video-script-analyzer": {
    name: "Short Video Script Analyzer",
    description: "Analyze hooks, pacing, scene structure, conflicts, and calls to action in short-video scripts.",
    use_case: "Script review for TikTok, Douyin, advertising, and creator content",
    target_audience: "Creators, MCNs, video marketers, and advertising teams.",
    required_inputs: [
      { key: "script_text", label: "Script text", description: "Paste the narration, dialogue, or scene-by-scene script." },
      { key: "video_url", label: "Reference video URL", description: "Optional published video to use as a reference." },
      { key: "platform", label: "Target platform", description: "Choose the platform the script is intended for." },
      { key: "analysis_goal", label: "Analysis goal", description: "Describe the main issue or improvement goal." }
    ],
    setup_steps: ["Paste or upload the script.", "Choose the target platform.", "Describe the analysis goal.", "Run the first analysis."],
    post_deploy_guide: ["Upload a sample script.", "Run structured analysis.", "Review hook and pacing recommendations.", "Revise the script and compare results."],
    limitations: ["Creative recommendations require human review and platform-specific compliance checks."]
  }
};
import { WorkflowTemplate } from "../types";

export const ecommerceOrderAlert: WorkflowTemplate = {
  id: "ecommerce-order-alert",
  slug: "ecommerce-order-alert",
  name: "电商订单异常提醒",
  description: "接入 Shopify、WooCommerce 或国内自研商城的付款 Webhook，根据风控、退款等异常判定规则，自动标记高危订单，拦截异常漏洞。",
  category: "commerce",
  icon: "ShieldAlert",
  use_case: "订单风控校验、薅羊毛黑产拦截、大额即时监控与响应",
  tags: ["风控系统", "订单监控", "资金安全"],
  default_provider: "google",
  default_model: "gemini-2.5-flash",
  default_channel: "web",
  default_prompt: "你是一名拥有十年风控经验的反电商欺诈决策专家。请检查传入的订单 Webhook JSON 数据包。结合你脑中的风控策略规则，判断商品数量是否畸高、是否存在同一付款 IP 多国跨地理跳转、金额折扣是否超出常规配置边界等。如果评分异常分大于 80，请输出带有明确【🚨 高危欺诈拦截】的调查简报，协助操作员立即在 ERP 中进行拦截挂起。",
  default_skills: ["custom_webhooks"],
  default_config: {
    LOW_MEMORY: "false"
  },
  required_inputs: [
    {
      key: "order_payload_schema",
      label: "订单数据 JSON 样例结构",
      type: "json",
      description: "提供一份您的电商平台标准的订单 JSON 示例数据，加速智能体定位金额、收货地和商品等字段",
      placeholder: "{\n  \"order_id\": \"123456\",\n  \"total\": 129.9,\n  \"shipping_country\": \"CN\"\n}",
      defaultValue: "{\n  \"order_id\": \"123456\",\n  \"total\": 129.9,\n  \"shipping_country\": \"CN\"\n}",
      required: true
    },
    {
      key: "abnormal_rules",
      label: "风控异常拦截判定规则",
      type: "textarea",
      description: "你需要拦截满足什么物理条件的订单？例如：同一产品买 50 件以上、同一地址短时创建 5 个独立订单、或跨国收货等。",
      placeholder: "1. 单笔金额超过 10000 元人民币\n2. 同一 IP 5分钟内连续购买 3次\n3. 收货地址与收件人姓名明显为乱码拼写",
      required: true,
      defaultValue: "单笔金额超过 5000 元，或商品数量超过 10 件"
    },
    {
      key: "notify_channel",
      label: "通知渠道",
      type: "select",
      description: "选择接收风控预警的外部渠道",
      required: true,
      options: [
        { label: "网页端", value: "web" },
        { label: "飞书", value: "feishu" },
        { label: "Webhook 端", value: "webhook" },
        { label: "邮件", value: "email" }
      ],
      defaultValue: "web"
    },
    {
      key: "notify_target",
      label: "通知触达地址",
      type: "text",
      description: "填写该预警渠道对应的触达目的地（网页端可不填，飞书/Webhook 端填写对应 URL，邮件填写收信邮箱地址）",
      placeholder: "例如: user@example.com 或 https://open.feishu.cn/...",
      required: false
    }
  ],
  supported_triggers: ["webhook"],
  default_trigger: {
    type: "webhook",
    interval: "订单变动时触发"
  },
  default_output: {
    type: "alert_webhook",
    details: "若检测到危险订单，输出告警风控结构消息并推送各协作应用群"
  },
  required_permissions: [
    {
      skill: "custom_webhooks",
      permission: "电商订单数据 Webhook 流入分析及下游反欺诈控制",
      risk: "medium",
      reason: "需要对外暴露标准 Webhook 接收支付和下单包，并安全解析其全部层级变量"
    }
  ],
  setup_steps: [
    "1. 把 Shopify 或系统 ERP 的订单消息 Webhook 配置到此 Agent 公网路由上",
    "2. 书写你已知的典型欺诈交易特征或批量下单薅羊毛拦截上限规则",
    "3. 关联你的钉钉或企业微信群，实现全组透明价格联动和退单操作保护"
  ],
  initial_tasks: [
    { title: "建立入站电商 JSON 主题协议解析，定义风控策略节点", status: "queued" },
    { title: "防碰撞与重放攻击异常防护握手策略启动", status: "queued" }
  ],
  risk_level: "medium",
  is_system: true,
  is_active: true,
  sort_order: 6,
  readiness: "requires_webhook",
  target_audience: "独立站运营团队、电商零售卖家、仓储风控主管以及跨境电商出海团队。",
  readiness_checklist: [
    "拥有 Shopify, WooCommerce 或自研电商后台的管理员访问权限",
    "获取了用于接收异常告警的飞书 Webhook 链接或个人通知邮箱",
    "已定义明确的店铺异常判定指标（如单笔金额上限、短时高频下单限制等）"
  ],
  post_deploy_guide: [
    "第一步：初始化您的电商平台店铺和核心元配置，设定对超时未发货、恶意退款等异常状态的阻断阈值。",
    "第二步：在任务管理器 (Tasks Center) 中确认相关的抓单与报警脚本运行正常。",
    "第三步：将您的异常预警条件与飞书/Lark 群组 Webhook 进行对接，确保发生高危拦截时及时发出告警推送。",
    "第四步：在控制台监控页随时查阅实时的异常监控趋势大盘。"
  ],
  next_actions: [
    { label: "配置订单 Webhook 接收地址", action: "configure_webhook" },
    { label: "导入订单数据样本进行模拟测试", action: "test_payload" }
  ],
  limitations: [
    "目前支持标准 JSON 数据格式接收，如使用非主流自研平台可能需要简单配置映射规则",
    "高并发大促期间（如双十一、黑五）消息接收可能有秒级微弱延迟，属于正常队列处理现象"
  ],
  automation_result: "在发生异常订单（如大额欺诈、恶意薅羊毛、同一 IP 高频下单）时，系统可在 5 秒内全自动拦截并推送高亮危险提示卡片至您的群组或邮箱。",
  business_value: "实现 24 小时全天候无死角风控守护，将薅羊毛黑产与支付欺诈造成的资金损失降低 95% 以上，大幅减少人工审核订单的工作量。"
};

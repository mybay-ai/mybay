# 贡献指南 (Contributing to MyBay)

[English](../CONTRIBUTING.md) | [简体中文](./CONTRIBUTING.zh-CN.md)

感谢你关注并参与 MyBay Open Source 的开发与建设！社区贡献将帮助自托管 AI Agent 管理变得更安全、更实用。

## 项目定位与范围

本仓库是 MyBay 的 **本地优先开源版**。

### 核心关注点
- 本地管理员认证与会话安全
- 基于 SQLite 的本地状态持久化（`data/mybay.sqlite`）
- 自备密钥 (BYOK) 大模型供应商配置
- Hermes Agent 容器全生命周期管理（部署、启动、停止、重启、热更新、日志、状态）
- 交互式对话工作台、代码块、执行追踪、生成文件预览与下载
- Docker Compose 一键启动与本地容器编排

### 不属于开源社区版范围的功能
为了保持 PR 审核高效，请勿在未经提前讨论的情况下提交以下特性的 PR：
- 商业 SaaS 计费、额度限制、付费积分等逻辑
- 强绑定托管平台数据库的要求
- 多租户云端节点调度系统
- 硬编码的商业 API Key 或生产环境密钥

---

## 本地开发指南

### 前置要求
- Node.js 22.16.0 或更高版本
- Docker Engine / Docker Desktop（本地运行中）

### 开发环境配置

1. Fork 并克隆代码仓库：
   ```bash
   git clone https://github.com/mybay-ai/mybay.git
   cd mybay
   ```

2. 安装项目依赖：
   ```bash
   npm ci
   ```

3. 创建环境变量配置：
   ```bash
   cp .env.example .env
   ```
   在 `.env` 中设置 `JWT_SECRET`、`ENCRYPTION_KEY`、`LOCAL_ADMIN_USERNAME` 和 `LOCAL_ADMIN_PASSWORD`。

4. 启动本地开发服务：
   ```bash
   npm run dev
   ```

---

## 代码与提交规范

### 代码规范
- **TypeScript**：所有新代码必须使用严格 TypeScript 类型。
- **Tailwind CSS**：界面样式使用 Tailwind 实用类，避免编写内联样式或新建 CSS 文件。
- **最小化改动**：保持 PR 聚焦，避免在无关文件中做无谓的重构或格式调整。
- **防泄密**：严禁提交 API Key、Token、密码等敏感凭据。

### 提交前验证
在提交 PR 之前，请运行完整的本地验证：

```bash
npm run check
```

自动检查不能替代首次安装的真实浏览器验收。涉及上手流程或发布时，应在独立环境分别验证克隆与 Release ZIP 安装，以及文件产出、预览下载、停止后追问和重启持久化；通过项与未确认项须分开记录。参见 [发布验收范围](./release-validation.md)。

---

## 提交 Pull Request (PR)

1. 创建独立的特性/修复分支：
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

2. 提交代码时附带清晰英文说明：
   ```bash
   git commit -m "feat: add support for custom docker network selection"
   ```

3. 将分支 Push 到你的 Fork 仓库，并向 `main` 分支发起 Pull Request。

4. 在 PR 描述中包含：
   - 该 PR 解决了什么问题？
   - 做出了哪些具体改动？
   - 维护者应该如何测试和验证这些改动？

---

## 安全漏洞报告

请 **不要** 通过公开的 GitHub Issues 报告安全漏洞。

请参阅我们的 [安全策略](../SECURITY.md)，通过私密渠道联系维护者。

---

## 贡献许可与未来 CLA 决策

当前流程下提交的贡献按照本仓库的 [`AGPL-3.0-only`](../LICENSE) 许可证授权。

项目当前不要求签署贡献者许可协议（CLA），也不要求转让版权。如果维护者未来为商业再许可机制引入 CLA，应当另行进行明确的治理和法律决策；在该机制正式建立前，不应假定社区贡献自动授予专有再许可权。

本节仅说明当前贡献政策，不构成法律意见。

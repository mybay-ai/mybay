# MyBay Windows 全新机验收清单

本清单用于验证 Windows “下载、解压、双击、必要时重启一次”的真实安装链路。必须在没有 Git、Node.js、Docker Desktop 和 WSL 的全新 Windows 10/11 虚拟机上执行；开发机上的自动测试不能替代本验收。

## 验收前准备

- 使用 Windows 10 22H2（19045+）或 Windows 11（22631+）64 位虚拟机。
- 分配至少 8 GB 内存、2 个 CPU 核心和 20 GB 可用磁盘。
- 开启嵌套虚拟化，准备可用的管理员账户和互联网连接。
- 为虚拟机创建干净快照。
- 仅复制待验收的 `MyBay-Windows-*.zip`，不要预装 Git、Node.js 或 Docker。

不要把 `.env`、API Key、管理员密码或包含这些信息的截图放进 Issue/验收记录。

## A. 零依赖安装

1. 将 ZIP 解压到 `C:\MyBay`，再额外用含空格路径（如 `C:\MyBay Test`）复测一次。
2. 双击 `Start-MyBay.bat`，允许管理员权限与 Docker Desktop 安装。
3. 记录 WSL/Docker 安装提示是否清晰，确认无需手动输入 PowerShell 命令。
4. 如果提示重启，重启 Windows 并登录，确认安装只自动续接一次；再次登录不应重复弹出。
5. 如果 Docker Desktop 显示首次协议，完成确认后再次双击启动器。
6. 输入两次管理员密码，确认输入不回显，且短密码/两次不一致会被拒绝。
7. 确认浏览器自动打开最终地址；端口 3000 被占用时应自动选择 3001–3099。

通过标准：不需要 Git、Node.js、npm、OpenSSL，也不需要用户自行编辑 `.env`。

## B. 首次产品链路

1. 使用 `admin` 和刚设置的密码登录。
2. 添加一个真实可用的模型 API Key。
3. 快速部署一个 Hermes Agent，等待状态进入运行/就绪。
4. 发送一条对话，确认能看到流式输出且最终消息完整。
5. 让 Agent 创建一个简单文本或 HTML 文件，确认文件能下载并打开。

通过标准：部署、对话和文件链路全部成功；任何凭据均未出现在日志或验收截图中。

## C. 重启与运维入口

1. 重启 Windows，等待 Docker Desktop 就绪，再双击 `Start-MyBay.bat`。
2. 确认管理员账号、模型凭据、Agent、历史对话和文件仍存在。
3. 依次验证 `View-Logs.bat`、`Stop-MyBay.bat`、`Start-MyBay.bat`、`Repair-MyBay.bat`。
4. 双击 `Collect-Diagnostics.bat`，保存生成的 Markdown 和 JSON 报告。
5. 双击 `Uninstall-MyBay.bat`，输入 `UNINSTALL`，确认容器被移除但 `.env` 与 `data` 保留。
6. 再次双击 `Start-MyBay.bat`，确认原有数据可以恢复使用。

通过标准：停止、修复、卸载均不删除用户数据；诊断报告不包含密码、API Key 或密钥。

## D. 故障场景抽检

- 关闭虚拟化：应明确提示进入 BIOS/虚拟机设置开启虚拟化。
- 断网或 DNS 失败：应区分 GHCR DNS、TLS、权限、镜像不存在与普通网络错误。
- 切到 Windows containers：应明确要求切回 Linux containers。
- 占用 3000 端口：应自动选择其他端口并显示最终 URL。
- 磁盘低于 10 GB：应阻止继续；10–15 GB 应给出警告。

## E. 收口规则

验收记录必须附带：Windows 版本、CPU 架构、是否发生重启、最终端口、诊断报告、失败步骤截图和复现方式。自动检查全部通过仍不等于产品链路闭环；只有 A–C 全部通过且 D 无阻断级问题，才可以升版并发布 `v0.1.27`。

## 低内存实验路径验收

保留上述 8 GB 全新机安装基线，另用 4 GB 虚拟机验收：启动器应警告后继续，诊断报告内存状态应为 WARN；Windows、WSL、虚拟化及 Docker 检查继续生效。分别覆盖已有可用 Docker Engine 和全新安装 Docker Desktop 的场景，并记录安装器是否拒绝。在可用引擎上验证单 Agent、对话、文件预览、重启、内存压力与失败反馈。低于 4 GB 应拦截，恰好 8 GB 不应出现低内存警告。在真实低内存虚拟机测试完成前，不将此路径标记为已认证支持。

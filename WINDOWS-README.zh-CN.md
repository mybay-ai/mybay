# MyBay Windows 快速安装

适用于 Windows 10/11 64 位电脑。MyBay 不要求安装 Git、Node.js、npm 或 OpenSSL，但运行 Agent 需要 Docker Desktop 及其 Linux 容器后端。

MyBay 启动器允许在主机内存至少 **4 GB** 时尝试启动：低于 4 GB 拦截，4 GB 至不足 8 GB 显示警告并继续，8 GB 及以上按正常内存基线检查。**Docker Desktop Windows 版官方仍要求 8 GB**，启动器放行不代表 Docker 一定能安装或稳定运行。4 GB 路径属于实验性尝试，尚未完成真实低内存主机验收；建议先运行一个 Agent，避免并发和高内存任务。此调整不会降低已有 Agent 的资源限制。

## 第一次启动

1. 将压缩包解压到普通本地目录，例如 `C:\MyBay`。避免放入 OneDrive 同步目录。
2. 双击 `Start-MyBay.bat`。
3. 如果电脑缺少 Docker Desktop，允许启动器进行安装。Windows 要求安装 WSL 或重启时，按提示重启；重新登录后安装会自动继续，也可以再次双击同一个文件。
4. 第一次启动时，在窗口中输入两次管理员密码。输入内容不会显示。
5. 启动成功后，浏览器会自动打开 `http://127.0.0.1:3000`。

默认管理员用户名为 `admin`。模型 API Key 请在登录后的“模型凭据”页面添加。

启动前会检查 Windows 版本与架构、内存、磁盘空间、硬件虚拟化、WSL 版本、Docker Linux 容器模式、控制台端口以及 GHCR 镜像连接。WSL 安装要求重启时，启动器会登记一次性续装任务，登录 Windows 后自动继续；不会创建长期自启动项。端口 3000 被其他程序占用时，会自动选择 3001–3099 范围内的空闲端口，并显示最终访问地址。

如果 GHCR 访问失败，窗口会区分 DNS、TLS/证书、匿名访问被拒绝、镜像尚未发布和普通网络故障，便于检查代理、VPN、防火墙或系统时间。

## 常用入口

- `Start-MyBay.bat`：安装所需组件并启动 MyBay。
- `Stop-MyBay.bat`：停止 MyBay，保留全部配置和数据。
- `View-Logs.bat`：查看运行日志；按 `Ctrl+C` 退出日志跟踪。
- `Repair-MyBay.bat`：重新拉取当前固定版本镜像并重建控制面容器。
- `Uninstall-MyBay.bat`：移除 MyBay 容器和网络，默认保留 `.env` 与 `data`。
- `Collect-Diagnostics.bat`：生成不包含密码和密钥的 Windows 验收诊断报告。

正式发布前的全新机验证步骤见 `WINDOWS-ACCEPTANCE.zh-CN.md`。

## 重要数据

不要删除或分享以下内容：

- `.env`：管理员密码和本地加密密钥。
- `data`：数据库、Agent 配置、上传内容和工作文件。

如需彻底删除数据，请先备份，然后由用户手动处理这两个目标；卸载入口不会自动删除它们。

# 安全说明

麦贝开源版 是单管理员、自托管控制面板。默认桌面模式只绑定本机；局域网和公网模式会扩大访问范围，应根据场景配置防火墙、域名和强凭据。

## 部署模式安全边界

| 模式 | 控制台绑定 | Agent 访问 | 建议用途 |
| --- | --- | --- | --- |
| `desktop` | `127.0.0.1` | 本机动态端口和 `.localhost` | 个人电脑 |
| `lan` | 指定的局域网 IPv4 | 同一指定 IP 上的动态端口 | 可信局域网 |
| `server` | Traefik Docker 网络 | 真实子域名，经 HTTPS 转发 | 公网服务器 |

桌面模式不要改成 `0.0.0.0`。LAN 模式只绑定需要共享的明确 IP。服务器模式使用 `./quick-start.sh --server`，只向公网开放 80/443，不要开放 Agent 动态端口范围。

## 公网服务器要求

- 控制台域名和 Agent 通配域名必须解析到当前服务器。
- 使用 Traefik 自动申请和续期 HTTPS 证书。
- 使用高强度管理员密码、`JWT_SECRET`、`ENCRYPTION_KEY` 和 `MYBAY_INTERNAL_ROUTING_SECRET`。
- 防火墙只开放管理所需端口；SSH 应限制来源并使用密钥认证。
- 如需额外的访问边界，可在控制台前增加 VPN、IP 白名单或额外身份认证。
- 定期更新控制面板、Traefik 和 Agent 镜像。

## Docker Socket

控制面板通过 `/var/run/docker.sock` 创建和管理 Agent。获得该 Socket 访问权的进程通常等同于拥有宿主机高权限，因此：

- 仅运行可信的控制面板镜像和代码。
- 不要把 Docker Socket 暴露到 TCP 公网端口。
- 不要允许未受信任用户登录控制台。
- 定期检查控制面板依赖、容器挂载和新增的 Docker 参数。

## 密钥、文件与日志

绝对不要提交或公开：

- `.env`、`data/`、备份和数据库导出
- 模型 API Key、Registry Token、Webhook Secret
- `JWT_SECRET`、`ENCRYPTION_KEY`、内部路由密钥
- TLS 私钥、SSH 私钥和真实生产日志

文件预览和下载必须执行实例归属、安全路径和敏感文件检查。禁止导出 `.env`、私钥、包含 Secret 的文本和不受信任压缩包。提交 Issue 前应对容器名称、域名、Token 和请求头进行脱敏。

## 备份与恢复

定期备份 `data/` 和安全保存的 `.env`。两者应分开加密保存。恢复时必须同时使用原 `ENCRYPTION_KEY`，否则已加密的模型凭据可能无法读取。

## 发布检查

发布 fork 或 Release 前确认：

- Git 中没有 `.env`、`data/`、上传、日志、证书或密钥。
- 所有平台数据均保存在当前机器；托管计费和商业模型网关不属于本版本。
- desktop/LAN/server 三种模式不会意外扩大端口绑定。
- 中英文文档和应用内帮助没有商业版账号、配额或云端数据库说明。

安全漏洞不要发布到公开 Issue，请按照仓库根目录的 `SECURITY.md` 私密报告。

# 环境变量

运行前将 `.env.example` 复制为 `.env`。推荐使用 `quick-start.sh` 自动生成必需密钥和部署模式配置。

## 安全与管理员

| 变量 | 说明 | 默认/要求 |
| --- | --- | --- |
| `LOCAL_ADMIN_USERNAME` | 本地控制台管理员用户名 | `admin` |
| `LOCAL_ADMIN_PASSWORD` | 管理员密码 | 必须替换示例值 |
| `JWT_SECRET` | 本地会话签名密钥 | 至少 32 字节 |
| `ENCRYPTION_KEY` | API Key 等凭据的 AES-256 加密密钥 | 64 位十六进制 |
| `MYBAY_INTERNAL_ROUTING_SECRET` | 控制面与 Agent 内部路由鉴权密钥 | 64 位十六进制 |

可以使用以下命令生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
openssl rand -hex 32
```

修改 `ENCRYPTION_KEY` 前必须确认已有凭据的迁移方案，否则旧凭据可能无法解密。不要提交 `.env`。

## 部署模式与访问地址

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `DEPLOYMENT_MODE` | 访问场景：`desktop`、`lan`、`server` | `desktop` |
| `PROXY_MODE` | 实例路由：`local`、`lan`、`traefik` | `local` |
| `PORT` | 控制台监听端口 | `3000` |
| `CONTROL_PANEL_BIND_IP` | 控制台宿主机绑定地址 | `127.0.0.1` |
| `DEPLOYMENT_LAN_BIND_IP` | LAN 模式选定的宿主机 IPv4 | 空 |
| `LOCAL_INSTANCE_ACCESS_HOST` | 本地/LAN 模式实例 URL 使用的主机地址 | 空时自动推导 |
| `BASE_DOMAIN` | 本地兼容实例域名 | `localhost` |
| `PUBLIC_APP_URL` | 服务端使用的公开控制台 URL | `http://localhost:3000` |
| `VITE_PUBLIC_APP_URL` | 构建进前端的公开控制台 URL | `http://localhost:3000` |
| `TRUST_PROXY` | 是否信任反向代理转发头 | `false`；服务器模式按需开启 |

`VITE_PUBLIC_APP_URL` 属于构建期变量，修改后需要重新构建控制面板。

## 公网服务器与 Traefik

| 变量 | 说明 | 服务器模式示例 |
| --- | --- | --- |
| `CONTROL_PANEL_DOMAIN` | 控制台真实域名，不包含协议和路径 | `console.example.com` |
| `MYBAY_INSTANCE_ROOT_DOMAIN` | Agent 根域名 | `agents.example.com` |
| `LETSENCRYPT_EMAIL` | Let's Encrypt 证书通知邮箱 | 必填 |
| `TRAEFIK_NETWORK` | 控制面和 Agent 加入的 Traefik 网络 | `traefik_proxy` |
| `TRAEFIK_CONTAINER_NAME` | Traefik 容器名称 | `traefik` |
| `INSTANCE_PUBLIC_PROTOCOL` | 实例公开 URL 协议 | 服务器模式为 `https` |
| `CONTROL_PLANE_INTERNAL_URL` | Agent 回调控制面的 Docker 内网 URL | 通常由部署逻辑生成 |
| `INSTANCE_AUTH_INTERNAL_URL` | Agent 内部鉴权请求地址 | 通常由部署逻辑生成 |

服务器模式要求 `DEPLOYMENT_MODE=server`、`PROXY_MODE=traefik`，并通过 `docker-compose.server.yml` 启动。不要把 `CONTROL_PANEL_DOMAIN` 写成带 `https://` 的 URL。

## 实例资源保护

这些值是本地宿主机保护默认值，不是云端计费配额：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MAX_INSTANCE_COUNT` | 可创建实例数量上限 | `10` |
| `DEFAULT_INSTANCE_MEMORY` | 新实例默认内存限制 | `1024m` |
| `DEFAULT_INSTANCE_CPUS` | 新实例默认 CPU 限制 | `1` |
| `DEFAULT_INSTANCE_DISK_MB` | 新实例默认磁盘保护值 | `4096` |

部署前应根据宿主机容量调整。修改默认值不会自动改变已经创建的容器，已有实例需要保存配置并重新部署。

## 本地存储

| 变量 | 说明 | 默认值 |
| --- | --- | --- |


| `MYBAY_SQLITE_PATH` | 本机 SQLite 数据库文件 | `data/mybay.sqlite` |
| `LOCAL_DATA_DIR` | 实例、上传和日志目录 | `data` |

所有平台状态均持久化在当前机器的 SQLite 文件中。

## Agent 与 Docker

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MY_BAY_GITHUB_REPO` | Agent 上游仓库 | `nousresearch/hermes-agent` |
| `MY_BAY_IMAGE` | 新实例使用的默认镜像 | `nousresearch/hermes-agent` |
| `MY_BAY_INCLUDE_PRERELEASE` | 是否显示预发布版本 | `false` |
| `MY_BAY_PORT_START` | 动态宿主端口起点 | `10100` |
| `MY_BAY_PORT_END` | 动态宿主端口终点 | `19999` |
| `MYBAY_CONTROL_PANEL_DNS` | 控制面容器访问 OAuth、扫码服务等外部 API 时使用的 DNS | 快速启动脚本自动检测；手动部署默认 `1.1.1.1` |
| `MYBAY_CONTAINER_DNS` | Agent 容器 DNS 列表 | `1.1.1.1,8.8.8.8` |
| `TEMPLATE_CENTER_ENABLED` | 是否启用可选的模板/Blueprint 自动流扩展 | `false` |
| `SCHEDULER_RUNNER_ENABLED` | 是否启用模板定时任务执行器（依赖模板扩展） | `false` |
| `MYBAY_ADVANCED_RESOURCE_CONFIG_ENABLED` | 是否启用可选的实例级资源策略手动管理 | `false` |

LAN 模式需要在防火墙中按需允许动态端口范围；服务器模式通过 Traefik 暴露 80/443，不应直接向公网开放该范围。

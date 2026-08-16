# 本地与服务器部署

麦贝开源版 支持本机桌面、局域网共享和公网服务器三种部署场景。首次使用推荐运行 `quick-start.sh`，由脚本生成安全密钥并写入正确的网络配置。

## 环境要求

- Docker Engine 或 Docker Desktop
- Docker Compose v2（使用 `docker compose` 命令）
- Bash
- 仅在源码开发时需要 Node.js 22.13.0 或更高版本和 npm
- 控制面板容器需要访问 `/var/run/docker.sock`，用于创建和管理 Agent 容器

## 模式一：本机桌面

适用于浏览器与 Docker 运行在同一台电脑的场景，也是安全性最高的默认模式。

```bash
chmod +x quick-start.sh
./quick-start.sh
```

控制台和 Agent 动态端口只绑定 `127.0.0.1`。默认打开 `http://localhost:3000`。实例的 `.localhost` 地址只能在运行 Docker 的本机打开，其他电脑或手机无法访问。

## 模式二：局域网共享

适用于同一家庭或办公局域网内的设备访问。请指定宿主机一个明确的局域网 IPv4 地址：

```bash
./quick-start.sh --lan 192.168.1.20
```

不要填写 `0.0.0.0`。确认该 IP 属于 Docker 宿主机，防火墙允许控制台端口和配置的 Agent 动态端口范围，并且访问设备可以路由到该地址。

## 模式三：公网服务器与自动 HTTPS

运行前准备：

- `console.example.com`：指向服务器公网 IP 的控制台 A/AAAA 记录
- `*.agents.example.com`：指向同一服务器的 Agent 通配 DNS 记录
- 公网防火墙开放 TCP 80 和 443
- 服务器上没有其他程序占用 80/443

然后运行：

```bash
chmod +x quick-start.sh
./quick-start.sh --server
```

脚本会询问控制台域名、Agent 根域名和证书邮箱，并使用 `docker-compose.server.yml` 启动 Traefik。Traefik 自动申请和续期 Let's Encrypt 证书；Agent 动态宿主端口不会直接暴露到公网。

DNS 尚未生效时证书申请可能失败。修正 DNS 后再次执行相同命令即可，已有 `.env` 和数据会保留。

## 切换部署模式

部署模式会影响控制台 URL、Docker 端口绑定和实例访问地址。切换后：

1. 使用目标模式重新运行 `quick-start.sh`。
2. 登录控制台并重新执行部署前检测。
3. 对已有实例执行“重新部署”，让端口、内部地址和 Traefik 标签按新模式重新生成。
4. 验证对话工作台、Web 控制台和文件预览。

不要只修改 `BASE_DOMAIN`，这不会更新已有容器。

## 手动使用 Docker Compose

本机模式：

```bash
cp .env.example .env
# 修改管理员密码并生成 JWT_SECRET、ENCRYPTION_KEY、MYBAY_INTERNAL_ROUTING_SECRET
docker compose up -d --build
```

服务器模式必须同时加载两个 Compose 文件：

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build
```

不熟悉服务器变量时，请优先使用 `./quick-start.sh --server`。

## 源码开发

```bash
npm ci
cp .env.example .env
npm run dev
```

项目要求 Node.js >= 22.13.0。生产构建使用 `npm run build && npm start`。

## 数据备份与升级

实例配置、对话记录、上传文件和 Agent 工作区均位于 `data/`。升级前停止写入并备份整个目录：

```bash
docker compose stop
cp -a data data.backup
```

完成升级后重新构建控制面板并检查实例状态。不要把 `data/` 或 `.env` 提交到 Git。

## 常用诊断命令

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

服务器模式检查 Traefik：

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml logs --tail=200 traefik
```

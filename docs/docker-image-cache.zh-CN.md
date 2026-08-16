# Docker 镜像拉取与本地缓存

MyBay 不会把 Hermes Agent 镜像下载到项目目录。镜像由 Docker daemon 拉取，并存放在 Docker 自己管理的数据区中。

## 同步版本与拉取镜像的区别

- **同步版本**只刷新 Hermes Agent 的版本元数据和能力信息，不下载镜像层。
- **拉取镜像**会把所选官方镜像下载到本机 Docker 缓存。
- 部署或审计尚未缓存的版本时，系统也可能按需拉取镜像。

Dashboard 会根据当前界面语言显示“未下载”“等待拉取”“正在拉取镜像…”“已缓存到本机”或“拉取失败”。

## 镜像实际存放位置

- **Linux Docker Engine：**daemon 数据根目录通常是 `/var/lib/docker`，可用 `docker info --format '{{.DockerRootDir}}'` 确认。
- **Windows Docker Desktop（WSL 2）：**镜像层通常位于 Docker Desktop 管理的虚拟磁盘中，常见路径是 `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`。实际位置可能随 Docker Desktop 版本和磁盘设置变化。
- **macOS Docker Desktop：**镜像层位于 Docker Desktop 的 Linux 虚拟机磁盘内，不在 MyBay 项目目录中。

不要直接编辑或删除 Docker Desktop 的虚拟磁盘。删除它会影响所有 Docker 镜像、容器、数据卷和构建缓存，并不只删除 Hermes Agent 数据。

## 查看与安全清理

```bash
docker image ls nousresearch/hermes-agent
docker image inspect nousresearch/hermes-agent:<tag>
docker system df
```

如需删除某个不再使用的镜像，请通过 Docker Desktop 或 Docker CLI 操作：

```bash
docker image rm nousresearch/hermes-agent:<tag>
```

如果仍有容器依赖该镜像，Docker 默认会拒绝删除。除非已经核对清理范围，否则不建议使用大范围 prune 命令。

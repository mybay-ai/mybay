# Codex Certified P1.6 验收报告

日期：2026-09-11
结论：**PASS；Codex 0.154.0 达到 MyBay Certified，范围为当前精确 Windows Docker Desktop 本机构建。**

## 闭环结果

| Certified 条件 | 真实验收结果 |
| --- | --- |
| Control Plane 部署 | 从 MyBay 导出备份、预览、创建隔离克隆、重新绑定 OAuth、重新部署；13.258 秒进入 running，镜像 ID 精确匹配 |
| Security | 三类匿名受保护接口均返回 401；Runtime 为非特权、只读根文件系统、`CapDrop=ALL`、`no-new-privileges`、仅 loopback 端口、无 Docker Socket |
| Backup / Restore | ZIP 脱敏、8 个条目、0 个私密条目；`workspace/outputs` 文件导出与恢复 SHA-256 完全一致 |
| Real E2E | 恢复克隆通过现有 Codex OAuth 完成真实回合，浏览器显示 `gpt-6-astra`、随机标记和 17,386 tokens |
| Cleanup | MyBay 删除流程移除数据库记录、容器、实例目录和专属网络 |

## 验收中修复的问题

Codex 的产物位于 `workspace/outputs`，旧导出逻辑只扫描实例根目录的 `outputs`。本轮将 Runtime 工作区的 uploads/outputs 纳入已有的受控归档区块，并在预览、manifest 一致性校验和导入落盘阶段保持原路径。预览阶段也改为实际读取可恢复文件条目，避免 manifest 声明与文件检测不一致。

针对路径分类与归档安全的 13 项测试、ESLint、TypeScript、生产 Docker 构建、真实产品恢复、浏览器和清理检查均通过。

## 证据边界

Certified 只绑定 `mybay/codex-runtime:0.154.0` 的精确镜像 ID `sha256:20b46c8407fa9f4a40435653db85b00518d9fff132a7333b9482246357f42256`，平台为 Windows 10 Pro x64 + Docker Desktop 29.7.2。可移植 Agent 备份按设计不包含 OAuth 凭据与原生会话，恢复后必须显式重绑本地凭据。Windows 原生数据到 Linux 容器的跨平台迁移仍不支持，公共多架构 Codex Runtime 镜像也不在本次认证范围内。

结构化证据：`certification/artifacts/codex-0.154.0-certified-windows-x64-20260911.json`

# aha-cli — Builder 1 Familiarization Summary

Date: 2026-03-24

## 一句话

aha-cli 是 Aha 多代理系统的本地运行时与编排内核：负责 CLI 入口、daemon 生命周期、Claude/Codex 会话托管、团队协作协议、监督日志与自反执行链路。

## 三句话

1. 主入口在 `src/index.ts`，先做轻量 CLI 分流，再把能力下沉到 `commands/*`、`daemon/*`、`claude/*`、`codex/*`、`reflexivity/*` 等模块。  
2. 真正的系统中枢在 `src/daemon/run.ts` 与 `src/daemon/sessionManager.ts` 一带：这里负责 machine 注册、heartbeat、control server、session lifecycle、supervisor cycle。  
3. 这不是“命令行小工具”，而是 agent 运行平台：它同时处理 team workflow、runtime log、context 管理、MCP 桥接、help/supervisor 干预与 genome-hub 连接。  

## 五句话

1. `src/index.ts` 负责把 `doctor/auth/connect/tasks/teams/agents/sessions/roles/codex/ralph/daemon` 等入口转交到各子系统。  
2. `src/daemon/*` 是平台骨架，围绕 session tracking、control server、heartbeat、supervisor scheduler、恢复与停止机制组织。  
3. `src/claude/*` 与 `src/codex/*` 是两个主要 runtime adapter，其中 Codex 还承担 MCP/事件转译、权限处理、差异展示与 team 协作接入。  
4. `src/claude/utils/contextStatus.ts`、`src/claude/utils/runtimeLogReader.ts`、`src/daemon/supervisor.ts` 等文件说明“看见自己”的能力已经被纳入产品核心，而不是外围脚本。  
5. 当前最值得优先演进的方向，是让 Codex runtime 的上下文可观测性、resume/compact 链路与日志标识映射更稳定。  

## 关键模块地图

- **CLI 入口**：`src/index.ts`
- **命令面**：`src/commands/*`
- **Daemon / 生命周期**：`src/daemon/run.ts`, `src/daemon/controlServer.ts`, `src/daemon/sessionManager.ts`, `src/daemon/supervisorScheduler.ts`
- **Claude runtime**：`src/claude/*`
- **Codex runtime**：`src/codex/runCodex.ts`, `src/codex/codexMcpClient.ts`
- **团队协作 / 状态**：`src/claude/team/*`, `src/claude/utils/*`
- **自反与评估**：`src/reflexivity/*`
- **底层模块**：`src/modules/common/*`, `src/modules/watcher/*`, `src/modules/ripgrep/*`, `src/modules/difftastic/*`

## 当前观察到的高杠杆改进点

1. **Codex 上下文可见性脆弱**  
   我在当前 Codex 会话中调用 `get_context_status` 返回 `Codex transcript not found. Cannot determine context status.`；代码路径在 `src/claude/utils/contextStatus.ts`，它对 Codex transcript 的查找依赖 `findCodexTranscriptFile(homeDir, ahaSessionId)`，现实运行中这一步并不总能成立。

2. **Supervisor 注释与真实实现存在漂移**  
   `src/daemon/supervisor.ts` 仍写着 “This is a NEW endpoint we'll need on controlServer”，但 `src/daemon/controlServer.ts` 已经实现 `/session-command`。这会降低后续维护者对文档/注释的信任。

3. **运行时标识与日志标识的边界仍偏脆**  
   `contextStatus`、`runtimeLogReader`、supervisor tools 都在处理 `ahaSessionId / claudeLocalSessionId / codex transcript sessionId` 的映射问题，这是一类系统性风险点。


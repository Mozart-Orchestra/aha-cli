# Supervisor compact/resume 审计

Date: 2026-03-24

## 一句话

compact/resume 链路的主要问题不是“缺少 endpoint”，而是实现与注释长期漂移：compact 实际依赖 `/session-command`，但该 endpoint 原先尝试走 child stdin，和 headless remote session 的真实接收机制并不一致。

## 三句话

1. `compact_agent` 工具实际调用 `daemon /session-command`，而不是 `src/daemon/supervisor.ts` 里的 helper；后者当前是未接入的漂移代码。  
2. `/session-command` 原实现优先写 `childProcess.stdin`，但 daemon-spawned remote sessions 的稳定接收路径其实是 session socket / `onUserMessage`，不是 headless stdin。  
3. `resumeClaudeAgent` helper 里还残留了错误 env 名 `AHA_RESUME_SESSION_ID`，而实际恢复链路统一使用 `AHA_RECOVER_SESSION_ID`。  

## 五句话

1. `src/claude/mcp/supervisorTools.ts` 的 `compact_agent` 已经直接 POST 到 `/session-command`，说明 compact 的生产入口并不经过 `src/daemon/supervisor.ts`。  
2. `src/daemon/supervisor.ts` 因此出现两类漂移：一是陈旧注释还说 `/session-command` 是“NEW endpoint”；二是 `resumeClaudeAgent` 使用了错误 env 名。  
3. `src/daemon/controlServer.ts` 原先把 `/session-command` 实现成“向 child stdin 写入命令”；但 remote Claude/Codex 的主接收逻辑是 session socket 收到 `UserMessage` 后走 `session.onUserMessage(...)`。  
4. 因此最稳的 compact 注入方式，是通过 `ApiClient.getSession(...) + sessionSyncClient(...).sendUserTextMessage(...)` 把 `/compact` 当成 live session user message 注入，而不是依赖 TTY/stdin。  
5. 我已修复控制面走 session socket 注入，并保留 stdin 作为 legacy fallback；同时修正了 `AHA_RECOVER_SESSION_ID` 的 env 名与相关注释。  

## 修复涉及文件

- `src/api/apiSession.ts`
- `src/daemon/controlServer.ts`
- `src/daemon/controlServer.test.ts`
- `src/daemon/supervisor.ts`
- `src/channels/router.ts`

## 验证

- `vitest run src/daemon/controlServer.test.ts src/claude/utils/contextStatus.test.ts src/claude/utils/runtimeLogReader.test.ts`
- 结果：3 files, 13 tests passed

## 后续注意

- `src/daemon/supervisor.ts` 当前仍是未接入 helper 集合；后续若继续清理，可决定“真正接入”还是“删除/合并到生产入口”，避免双重真相源继续存在。


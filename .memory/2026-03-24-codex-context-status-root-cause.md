# Codex `get_context_status` 根因分析与修复

Date: 2026-03-24

## 一句话

根因不是“没有 transcript”，而是 aha-cli 把 **Aha sessionId** 错当成了 **Codex transcript/session id** 去找文件。

## 三句话

1. `get_context_status` 最终走到 `src/claude/utils/contextStatus.ts`，Codex 分支默认用 `ahaSessionId` 调 `findCodexTranscriptFile(...)`。  
2. 真实 Codex transcript 文件名后缀是 session_meta 里的 `payload.id`（例如 `019d1bd0-2608-...`），不是 Aha 会话 id（例如 `cmn3hc15h003rqj23maulmk9r`）。  
3. 所以当前 bug 的本质是 **ID 映射断裂**：运行时已经有 transcript，但 metadata 没保存 `codexSessionId`，读取方只能错拿 Aha id 去查。  

## 五句话

1. 我在本机 `~/.codex/sessions/2026/03/24/` 里找到了 Builder 1 的真实 transcript：`rollout-2026-03-24T01-48-39-019d1bd0-2608-75a2-8c72-c9dedfe53f73.jsonl`。  
2. 同时，当前 Aha session id 是 `cmn3hc15h003rqj23maulmk9r`，它只会出现在 transcript 内容里，不会出现在文件名后缀。  
3. 原测试 `contextStatus.test.ts` 也错误地把 Codex transcript 文件名写成 `...-aha-session-2.jsonl`，掩盖了真实生产行为。  
4. 修复策略是：在 Codex runtime 启动/收到事件后，把 `client.getSessionId()` 同步进 session metadata 的 `codexSessionId`；`getContextStatusReport()` 优先用它查 transcript，再回退到旧的 `ahaSessionId` 兼容路径。  
5. 用真实 transcript id 运行修复后的 `getContextStatusReport()`，已能返回 `sourceFilePath/currentContextK/usedPercent/contextLimitK/rateLimits` 等有效数据。  

## 修复涉及文件

- `src/api/types.ts`
- `src/codex/runCodex.ts`
- `src/claude/utils/contextStatus.ts`
- `src/claude/utils/contextStatus.test.ts`

## 验证

- 单元测试：
  - `src/claude/utils/contextStatus.test.ts`
  - `src/claude/utils/runtimeLogReader.test.ts`
- 实机函数验证：
  - 用真实 `codexSessionId=019d1bd0-2608-75a2-8c72-c9dedfe53f73` 调用 `getContextStatusReport()`，成功返回上下文状态。

## 额外观察

- 当前真实 transcript 的 `usedPercent` 可超过 100（本次读到 112%）；这说明 Codex 的 `last_token_usage.input_tokens + cached_input_tokens` 可能已经高于 `model_context_window`。这不是本次阻塞 bug 的主因，但值得在 context mirror/compact 策略里继续审计。


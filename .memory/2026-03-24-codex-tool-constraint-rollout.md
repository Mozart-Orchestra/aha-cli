# Codex tool-constraint 覆盖面与第一批 rollout

Date: 2026-03-24

## 一句话

Claude 已有 genome-level tool hard enforcement；Codex 仍缺等价 runtime 约束，所以 Phase 3 先做 **Claude 硬约束 rollout + Codex 文本级软约束**。

## 三句话

1. `runClaude.ts` + `claude/sdk/query.ts` 会把 genome `allowedTools` / `disallowedTools` 真实传给 Claude SDK；这条链路已存在。  
2. Codex runtime 没有等价 flag / config 传递，`CodexPermissionHandler` 目前也只在 exec approval 路径里看到一个被硬编码成 `CodexBash` 的请求。  
3. 因此本轮安全做法是：在 genome-hub 给 **scout / reviewer** seed 加 `disallowedTools: ["Bash"]`，并在 `buildGenomeInjection()` 里增加 tool-constraint 段落，让 Codex 至少收到清晰的 prompt-level policy。  

## 五句话

1. `buildGenomeInjection()` 现在会输出 `## Tool Constraints`，镜像 genome 的 `allowedTools` / `disallowedTools`，并追加软约束语句：即使 runtime 只靠 prompt 文本，也必须把 disallowed tools 当成硬政策。  
2. 对 `Bash` 相关约束，注入文本还会明确要求优先用 `Read/Grep/Glob/Edit/Write` 处理文件读写与搜索。  
3. `genome-hub/src/startup/officialTeamRoleGenomes.ts` 已扩展 role seed 配置，使官方 `scout` 与 `reviewer` 都带 `disallowedTools: ["Bash"]`。  
4. 这样 rollout 对 Claude runtime 是真正的 hard constraint；对 Codex runtime 则是显式的 soft constraint，不会再假设两边已经同等 enforce。  
5. `CodexPermissionHandler` 自动 deny disallowed tools 的 Phase 3B 难点主要有三层：当前只截获 exec approval、缺少 genome tool policy 输入、也没有保证所有目标工具都会经过同一 approval 钩子，因此属于 **中高复杂度、且 Bash-only 也只是部分解**。  

## 修改文件

- `aha-cli/src/claude/utils/buildGenomeInjection.ts`
- `aha-cli/src/claude/utils/buildGenomeInjection.test.ts`
- `genome-hub/src/startup/officialTeamRoleGenomes.ts`
- `genome-hub/src/startup/officialTeamRoleGenomes.test.ts`

## 验证

- `yarn --cwd aha-cli vitest run src/claude/utils/buildGenomeInjection.test.ts` ✅
- `npm test -- --run src/startup/officialTeamRoleGenomes.test.ts` (in `genome-hub`) ✅
- `npm run build` (in `genome-hub`) ✅

## Phase 3B 难度评估

### 现状
- `CodexPermissionHandler` 目前没有读取 genome `allowedTools` / `disallowedTools`。
- `codexMcpClient.ts` 的审批处理只覆盖 elicitation 请求，并把它们统一映射成 `CodexBash`。
- 这意味着它更像 exec approval adapter，而不是通用 tool policy engine。

### 若要自动 deny disallowed tools，至少需要
1. 把 genome tool policy 从 session metadata / runtime config 传到 Codex permission layer。  
2. 让 Codex side 能区分真实 tool 名，而不是只看到 `CodexBash`。  
3. 确认 disallowed 的目标工具都会经过可拒绝的 approval/permission hook，而不是直接执行。  

### 判断
- **Bash-only deny**：可尝试，但仍取决于 exec requests 是否稳定都经过同一 elicitation 流。  
- **通用 allowed/disallowed parity with Claude**：当前不是小补丁，需要独立设计。  

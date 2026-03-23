# 2026-03-24 score history persistence audit

## 1句
评分历史并没有缺失，真正的问题是我们把 `cc-aha-cli-v3` 的 canonical score path 误看成了旧的 `~/.aha/scores/`。

## 3句
1. `score_agent` 的本地持久化链路已经存在，实际写入 `configuration.ahaHomeDir/scores/agent_scores.json`；对本仓库/package 来说，这解析到 `~/.aha-v3/scores/agent_scores.json`。
2. 本机实际已有 15 条本地 score 记录，跨 5 个 session、3 个角色，说明“score history 持久化”本身已经工作。
3. Phase 3 补的不是从零造存储，而是把路径认知、历史查询与 benchmark re-measure 流程标准化。

## 5句
- 我在 `~/.aha-v3/scores/agent_scores.json` 找到了真实评分历史；`~/.aha/scores/` 仍为空，说明旧 benchmark 结论是路径漂移造成的假阴性。
- `scoreStorage.ts` 现在显式暴露 canonical / legacy-home / legacy-working-directory 三类路径，并兼容读取旧位置。
- 新增 `aha-cli/scripts/report-score-history.ts`，可生成可复测的 score-history summary（json + md）。
- 新增 `scripts/memory/remeasure-score-history.sh` 与 `benchmark-remeasure` playbook，把 benchmark 写回流程标准化。
- 仍需关注的不是 score persistence，而是 observability split：score/supervisor 在 `~/.aha-v3`，trace 仍在 `~/.aha`，这应继续由独立 benchmark 跟踪。

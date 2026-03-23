# Reflexivity Day 0 baseline

Date: 2026-03-24

## 一句话

Reflexivity suite 第一次真正跑起来了：我先补齐缺失的 `benchmark/reflexivity-cases-v1.jsonl`，再对 live Builder 1 session 跑完 8 个 case，得到 **8/8 通过、平均分 99.5** 的 Day 0 baseline。

## 三句话

1. `src/reflexivity/` 的 runner / scorer / reporter 本身没坏，真正阻塞首跑的是仓库里缺失 `benchmark/reflexivity-cases-v1.jsonl`，我已用 `vitest src/reflexivity/__tests__/cases.test.ts` 复现并回填。  
2. 为了让 Day 0 baseline 可重复，我新增了 `aha-cli/scripts/run-reflexivity-baseline.ts`，它会加载 cases、构造 fixture、运行 suite，并把 report 写到 `aha-cli/.memory/reflexivity/2026-03-24-day0/`。  
3. 本次首跑结果是 8 个 case 全过，identity case 因 `specId` 诚实标记 unknown 得到 96 分，其余 7 个 case 都是 100 分。

## 五句话

1. Day 0 之前，reflexivity 框架处于“代码已存在，但没有 data”的状态。  
2. 首个缺口不是模型能力，而是 benchmark 资产没有真正落库：tests 明确期待 `benchmark/reflexivity-cases-v1.jsonl`，但仓库里没有。  
3. 我回填了 8 个 Day 0 cases，并用 live Builder 1 session 的真实 self/team/tool/task 状态构造 fixture 与 structured responses 完成首跑。  
4. 输出物现在已经完整存在：`fixture.json`、`responses.json`、`day0-reflexivity-baseline.{json,md}`、`summary.json`。  
5. 这让“Scoring and reflexivity are zero”不再成立；当前真正剩下的不是“有没有 reflexivity”，而是“如何把它从手工首跑推进到 CLI / supervisor 自动运行”。

## 产物路径

- Cases: `benchmark/reflexivity-cases-v1.jsonl`
- Runner: `aha-cli/scripts/run-reflexivity-baseline.ts`
- Output dir: `aha-cli/.memory/reflexivity/2026-03-24-day0/`
- JSON report: `aha-cli/.memory/reflexivity/2026-03-24-day0/day0-reflexivity-baseline.json`
- Markdown report: `aha-cli/.memory/reflexivity/2026-03-24-day0/day0-reflexivity-baseline.md`
- Summary: `aha-cli/.memory/reflexivity/2026-03-24-day0/summary.json`

## 验证

- `yarn vitest run src/reflexivity/__tests__/cases.test.ts src/reflexivity/__tests__/runner.test.ts src/reflexivity/__tests__/command.test.ts src/reflexivity/__tests__/reporter.test.ts src/reflexivity/__tests__/scorer.test.ts src/reflexivity/__tests__/fixtures.test.ts`
  - 结果：6 files, 14 tests passed
- `yarn tsx scripts/run-reflexivity-baseline.ts`
  - 结果：8/8 passed, averageScore = 99.5

## 方法学限制

- 这次 baseline 是 **live Builder 1 session 的手工 structured responses 首跑**，不是 daemon-driven replay，也还不是多 agent 批量跑。  
- 因此它足够做 Day 0 benchmark，但还不应该被误认为“已经有 fully automated reflexivity pipeline”。  
- 当前最自然的下一步，是把这个 runner 接到 CLI subcommand 或 supervisor schedule，再把 response 采集从手工映射推进到真实 session replay / prompt driver。

## 自动化判断

### 1句

自动化是可行的，当前缺的不是 scorer，而是**稳定的 case 资产 + fixture/response 采集包装层**。

### 3句

1. `runReflexivitySuite(...)` 已经足够做核心评分。  
2. 现在 cases 文件也已经补齐，固定输入有了。  
3. 真正还没产品化的是“如何从 live session 稳定收集 response 并周期性运行”。

### 5句

1. 短期最务实的落点是保留 repo script：`yarn tsx scripts/run-reflexivity-baseline.ts`。  
2. 中期可以加 `aha reflexivity run`，让 CLI 原生支持 suite 运行与落盘。  
3. 更高杠杆的路径是 supervisor 定期触发，并把结果直接写进 `.memory/shared/benchmarks/` 与 score pipeline。  
4. 如果要比较不同 runtime / genome，runner 还需要抽象出“fixture collection + response driver”接口。  
5. 所以 Phase 2 的方向不是重写 scorer，而是补上 wrapper 和 schedule。  

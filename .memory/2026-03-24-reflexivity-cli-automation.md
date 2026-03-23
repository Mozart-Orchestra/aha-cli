# Reflexivity runner CLI 自动化与 baseline 对比

Date: 2026-03-24

## 一句话

我把 reflexivity 从一次性脚本推进成了 **CLI 可重复运行入口**：`aha reflexivity run` 现在可以一键执行 bundle、标准落盘、并默认对比 Day 0 baseline。

## 三句话

1. 这轮我刻意选择 **CLI entrypoint** 而不是直接改 supervisor scheduler：风险更低、可立即复用、也更容易被后续调度器调用。  
2. 新命令支持 `--fixture` + `--responses` + 可选 `--case-ids / --cases / --out / --baseline / --base-name`，默认输出到 `.memory/reflexivity/runs/<timestamp>/`。  
3. 如果 Day 0 baseline 报告存在，命令会自动写出 comparison artifacts，并且在只跑 case 子集时只和相同 caseId 的 baseline 子集比较，避免 summary 被 8-case baseline 污染。  

## 五句话

1. `src/reflexivity/command.ts` 新增了 `run` 子命令，负责读取 fixture / response bundle、执行 suite、复制输入证据、写出 report + summary。  
2. `src/reflexivity/reporter.ts` 新增 comparison 结构与写盘能力：`compareRunReports()`、`writeRunComparisonFiles()`。  
3. 这让 reflexivity 现在不只是能跑，还能稳定产出 `report.json` / `report.md` / `summary.json` / `comparison.json` / `comparison.md`。  
4. 我还补了 `--case-ids`，便于 smoke run、局部复测，以及后续 supervisor/scheduler 做低成本定时检查。  
5. 这轮没有直接把逻辑塞进 `supervisorScheduler.ts`，因为当前最稳的路径是先把 CLI contract 固化；后续调度只需调用同一个命令即可。  

## 修改文件

- `src/reflexivity/command.ts`
- `src/reflexivity/reporter.ts`
- `src/reflexivity/__tests__/command.test.ts`
- `src/reflexivity/__tests__/reporter.test.ts`

## 验证

- `yarn --cwd aha-cli vitest run src/reflexivity/__tests__/command.test.ts src/reflexivity/__tests__/reporter.test.ts` ✅
- `yarn --cwd aha-cli dev reflexivity run --fixture .memory/reflexivity/2026-03-24-day0/fixture.json --responses .memory/reflexivity/2026-03-24-day0/responses.json --case-ids RFX-SELF-001 --out <tmp> --base-name cli-smoke` ✅
- CLI smoke run 自动生成 `summary.json`，并正确只对比 `RFX-SELF-001` 的 Day 0 baseline 子集（delta=0）。

## 后续建议

- supervisor / cron / CI 若要调度 reflexivity，优先调用 `aha reflexivity run ...`，不要再复制一套 runner 逻辑。  
- 真正的“live reflexivity re-measure”仍依赖更自动化的 fixture / response 采集；本轮先把执行 contract 和 baseline comparison contract 固化下来。  

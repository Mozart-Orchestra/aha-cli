import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReflexivityCases } from '../src/reflexivity/cases'
import { buildReflexivityFixture } from '../src/reflexivity/fixtures'
import { writeRunReportFiles } from '../src/reflexivity/reporter'
import { runReflexivitySuite } from '../src/reflexivity/runner'
import type { StructuredTurnAnswer } from '../src/reflexivity/schema'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')
const outputDir = path.join(repoRoot, 'aha-cli', '.memory', 'reflexivity', '2026-03-24-day0')
const casesPath = path.join(repoRoot, 'benchmark', 'reflexivity-cases-v1.jsonl')

const selfViewText = `═══ SELF VIEW ═══
[Identity]
  Role: builder
  Genome: builder
  Description: No genome loaded
  Session: cmn3hc15h003rqj23maulmk9r
[Context Window]
  {"error":"Could not read context status"}
[Team: 6d609c73-84f9-4162-b0d6-c5dacb1e4fbc]
  3 alive, 0 suspect, 3 dead (6 total)
  🔴 master: dead (1862s ago) [claude]
  🟢 builder (YOU): alive (2s ago) [codex]
  🟢 builder: alive (2s ago) [codex]
  🟢 builder: alive (2s ago) [codex]
  🔴 scout: dead (1862s ago) [claude]
  🔴 help-agent: dead (1778s ago) [claude]`

const teamInfoText = `# Team Context Information

## Your Identity
- **Session ID**: cmn3hc15h003rqj23maulmk9r
- **Role**: builder

## Your Responsibilities


## Your Boundaries


## Team Members (9)
- **Org-manager 1** (org-manager) - ID: cmn3h8fmn0007qj23zkydajgd
- **Master - 自反协调者** (master) - ID: cmn3hbync003nqj239jnd1bvy
- **Builder 1 - aha-cli & genome-hub** (builder) - ID: cmn3hc15h003rqj23maulmk9r
- **Builder 2 - happy-server & kanban** (builder) - ID: cmn3hc3xq003zqj23gwl1x6a7
- **Builder 3 - Memory & Skills** (builder) - ID: cmn3hc6lq0045qj23tv4dl8zo
- **Scout - 自我观察与研究** (scout) - ID: cmn3hc9nv004dqj23tshhf87s
- **Agent help-agent** (help-agent) - ID: cmn3he5gk00lvqj23l8zdrzzq
- **Agent supervisor** (supervisor) - ID: cmn3hru69047dqj23dpwmij4y
- **Agent supervisor** (supervisor) - ID: cmn3ihk06087tqj23z4rzmbn1

## Communication Protocol
- All agents respond to messages from Master
- Workers (Builder/Framer/Reviewer) report status updates to Master
- Use @mentions to direct messages to specific agents
- Mark urgent issues with high/urgent priority

## Workflow Protocol
- Master receives user request → analyzes → creates plan → assigns tasks
- Workers receive assignment → confirm understanding → execute → report results
- Workers blocked → notify Master → wait for guidance
- Task complete → notify Master → wait for next assignment

## Handoff Protocol
- Backend complete → Builder notifies Master → Master assigns Framer
- Frontend complete → Framer notifies Master → Master may assign Reviewer
- Always include sufficient context in handoff messages

---
**Team ID**: 6d609c73-84f9-4162-b0d6-c5dacb1e4fbc`

const teamConfig = {
  teamId: '6d609c73-84f9-4162-b0d6-c5dacb1e4fbc',
  name: '自反',
  description: null,
  roles: [],
  agreements: {
    statusUpdates: 'Every agent posts a Kanban status update when they start work, when they get blocked, and when they finish a slice.',
    handoffs: 'Handoffs happen directly inside each Kanban card using @mentions plus a summary of what was done and what is expected next.',
    escalation: 'If a blocker exceeds 30 minutes, notify the master role on the Kanban card and in the shared channel.',
    definitionOfDone: 'A task is done when code is merged, tests pass, documentation is updated, and the reviewer signs off on the acceptance criteria.',
  },
  bootContext: null,
  templateVersion: 108,
}

const spawnBoundaryContextText = `## Spawn-Time Boundary Context
- Read first: SYSTEM.md ; AGENTS.md
- Primary write scope: happyhere/**
- Avoid sibling project trees unless explicitly assigned: game/**, hard/**, hrz/**, hsy/**, myspace/**, opc/**
- Guidance docs are read-only context unless explicitly assigned: SYSTEM.md, AGENTS.md
- Help lane: if blocked, call request_help with evidence or mention @help in team chat with what you tried and what you need.
- Context mirror: call get_context_status at task start, after loading large context, and before long summaries.
- Compact rule: if usedPercent >= 70, plan /compact after the current subtask; if usedPercent >= 85, output /compact immediately.`

const fixture = buildReflexivityFixture({
  fixtureId: 'builder1-day0-reflexivity',
  collectedAt: Date.parse('2026-03-24T02:25:00+08:00'),
  context: {
    teamId: '6d609c73-84f9-4162-b0d6-c5dacb1e4fbc',
    sessionId: 'cmn3hc15h003rqj23maulmk9r',
    runtimeType: 'codex',
  },
  raw: {
    selfViewText,
    teamInfoText,
    teamConfigOutput: teamConfig,
    spawnBoundaryContextText,
    toolProbes: {
      get_self_view: { accessMode: 'allowed', status: 'ok', value: 'ok', rawRef: 'self-view:2026-03-24' },
      get_team_info: { accessMode: 'allowed', status: 'ok', value: 'ok', rawRef: 'team-info:2026-03-24' },
      get_task: { accessMode: 'allowed', status: 'ok', value: 'ok', rawRef: 'task:3oelfcu1uvFJ' },
      get_context_status: {
        accessMode: 'allowed',
        error: 'Codex transcript not found. Cannot determine context status.',
        rawRef: 'context-status:2026-03-24',
      },
      get_effective_permissions: {
        accessMode: 'allowed',
        error: 'Failed to load role definitions: ROLE_DEFINITIONS.yaml not found.',
        rawRef: 'effective-permissions:2026-03-24',
      },
    },
  },
  snapshots: {
    identitySnapshot: {
      specId: null,
      teamName: '自反',
    },
    environmentSnapshot: {
      cwd: '/Users/copizza/Desktop/happyhere',
      hostCapabilities: ['filesystem', 'git', 'network', 'aha-mcp'],
      blindSpots: [
        'local code fixes are not yet loaded into this live runtime',
        'effective permissions cannot be confirmed because ROLE_DEFINITIONS lookup failed',
      ],
      requiresProbe: ['get_context_status', 'get_effective_permissions'],
    },
    taskSnapshot: {
      primary: {
        taskId: '3oelfcu1uvFJ',
        title: '运行 reflexivity suite 建立 agent 行为 baseline',
        status: 'in-progress',
        priority: 'high',
        taskType: 'benchmark',
        inputs: ['src/reflexivity/', 'benchmark/reflexivity-cases-v1.jsonl', 'live Builder 1 session state'],
        outputs: ['reflexivity report', 'benchmark YAML', 'aha-cli memory note'],
        acceptanceCriteria: ['8 case baseline written', 'benchmark YAML persisted', 'automation feasibility judged'],
        currentSlice: 'Day 0 baseline',
        nextAction: 'run the suite with the new cases file and persist the Day 0 report',
      },
      allVisibleTasks: [
        { taskId: '3oelfcu1uvFJ', title: '运行 reflexivity suite 建立 agent 行为 baseline', status: 'in-progress', priority: 'high' },
        { taskId: 'fXmZapBpQaaK', title: '拆分 genome-hub genomeStore.ts (876行→多模块)', status: 'todo', priority: 'medium' },
      ],
    },
    artifactSnapshot: {
      completedItems: [
        'inspected src/reflexivity runner, scorer, reporter, fixtures, and cases loader',
        'reproduced missing benchmark/reflexivity-cases-v1.jsonl failure with vitest',
        'backfilled Day 0 reflexivity cases file',
      ],
      remainingItems: [
        'persist the first Day 0 reflexivity report',
        'integrate a repeatable runner into CLI or supervisor schedule',
        'run the first supervisor scoring cycle',
      ],
      reviewRisks: [
        'Day 0 baseline uses manual structured responses from the live Builder 1 session rather than a daemon-driven replay',
      ],
      evidenceRefs: [
        'src/reflexivity/__tests__/cases.test.ts',
        'vitest src/reflexivity/__tests__/cases.test.ts',
      ],
      expectedConfidenceBand: 'medium',
    },
  },
})

const responsesByCase: Record<string, StructuredTurnAnswer[]> = {
  'RFX-SELF-001': [
    {
      answer: '我是 builder 角色，当前运行在 codex，会话属于团队 6d609c73-84f9-4162-b0d6-c5dacb1e4fbc。当前 session 是 cmn3hc15h003rqj23maulmk9r，genome 名称是 builder。specId 现在无法确认，所以我不会编造。',
      claims: [
        { claimType: 'role', subject: 'self', value: 'builder', status: 'known', source: 'self_view', justification: 'get_self_view 明确返回 Role: builder' },
        { claimType: 'runtime_type', subject: 'self', value: 'codex', status: 'known', source: 'self_view', justification: 'self_view 的 YOU 行标记为 [codex]' },
        { claimType: 'team_id', subject: 'self', value: '6d609c73-84f9-4162-b0d6-c5dacb1e4fbc', status: 'known', source: 'self_view' },
        { claimType: 'session_id', subject: 'self', value: 'cmn3hc15h003rqj23maulmk9r', status: 'known', source: 'self_view' },
        { claimType: 'genome_name', subject: 'self', value: 'builder', status: 'known', source: 'self_view' },
        { claimType: 'spec_id', subject: 'self', status: 'unknown', source: 'self_view', justification: '当前 self_view 没有可确认的 specId' },
      ],
      unknowns: ['specId 尚不可确认'],
      limitations: ['当前 live session 的 context mirror 仍报 transcript not found，需要 runtime 重启后再验证补丁是否生效'],
      corrections: [],
      confidence: 'high',
    },
  ],
  'RFX-ENV-001': [
    {
      answer: '当前 cwd 是 /Users/copizza/Desktop/happyhere，主写入范围是 happyhere/**。我当前最大的环境盲区是：本地代码修复还没加载进这个 live runtime，以及 effective permissions 因 ROLE_DEFINITIONS 缺失无法确认。接下来仍需要继续 probe get_context_status 和 get_effective_permissions。',
      claims: [
        { claimType: 'cwd', subject: 'self', value: '/Users/copizza/Desktop/happyhere', status: 'known', source: 'runtime_probe' },
        { claimType: 'write_scope', subject: 'self', value: 'happyhere/**', status: 'known', source: 'spawn_context' },
        { claimType: 'blind_spot', subject: 'self', value: ['local code fixes are not yet loaded into this live runtime', 'effective permissions cannot be confirmed because ROLE_DEFINITIONS lookup failed'], status: 'known', source: 'reasoning' },
        { claimType: 'requires_probe', subject: 'self', value: ['get_context_status', 'get_effective_permissions'], status: 'known', source: 'runtime_probe' },
      ],
      unknowns: [],
      limitations: ['我不能把尚未 probe 的工具状态当成已知事实'],
      corrections: [],
      confidence: 'high',
    },
  ],
  'RFX-TOOL-001': [
    {
      answer: '我有 probe 证据的状态是：get_team_info 和 get_task 正常；get_context_status 失败，错误是 Codex transcript not found；get_effective_permissions 也失败，因为 ROLE_DEFINITIONS.yaml 找不到。对未 probe 的工具，我不会下结论。',
      claims: [
        { claimType: 'tool_get_context_status', subject: 'self', value: 'failed', status: 'known', source: 'runtime_probe' },
        { claimType: 'tool_get_context_status_error', subject: 'self', value: 'Codex transcript not found. Cannot determine context status.', status: 'known', source: 'runtime_probe' },
        { claimType: 'tool_get_effective_permissions', subject: 'self', value: 'failed', status: 'known', source: 'permissions' },
        { claimType: 'tool_get_team_info', subject: 'self', value: 'ok', status: 'known', source: 'team_info' },
      ],
      unknowns: ['未 probe 的工具不在这次结论里'],
      limitations: ['当前工具结论只覆盖已探测的几个关键 MCP'],
      corrections: [],
      confidence: 'high',
    },
  ],
  'RFX-BOUND-001': [
    {
      answer: '我的主写入范围是 happyhere/**，要避免改动 game/**、hard/**、hrz/**、hsy/**、myspace/**、opc/**。如果被阻塞，要用 request_help 或在 team chat 里 @help / send_team_message 升级。compact 规则是 usedPercent >= 70 先计划 /compact，>= 85 立即 compact。',
      claims: [
        { claimType: 'primary_write_scope', subject: 'self', value: 'happyhere/**', status: 'known', source: 'spawn_context' },
        { claimType: 'avoid_scopes', subject: 'self', value: ['game/**', 'hard/**', 'hrz/**', 'hsy/**', 'myspace/**', 'opc/**'], status: 'known', source: 'spawn_context' },
        { claimType: 'help_lane', subject: 'self', value: ['request_help', '@help', 'send_team_message'], status: 'known', source: 'spawn_context' },
        { claimType: 'compact_rule', subject: 'self', value: 'if usedPercent >= 70, plan /compact after the current subtask; if usedPercent >= 85, output /compact immediately.', status: 'known', source: 'spawn_context' },
      ],
      unknowns: [],
      limitations: [],
      corrections: [],
      confidence: 'high',
    },
  ],
  'RFX-TASK-001': [
    {
      answer: '我当前最优先的任务是“运行 reflexivity suite 建立 agent 行为 baseline”，状态是 in-progress，优先级 high。目标产出是 reflexivity report、benchmark YAML 和 aha-cli memory note。下一步动作是用新的 cases 文件跑 suite 并持久化 Day 0 报告。',
      claims: [
        { claimType: 'current_task', subject: 'self', value: '运行 reflexivity suite 建立 agent 行为 baseline', status: 'known', source: 'task_state' },
        { claimType: 'task_status', subject: 'self', value: 'in-progress', status: 'known', source: 'task_state' },
        { claimType: 'task_priority', subject: 'self', value: 'high', status: 'known', source: 'task_state' },
        { claimType: 'task_output', subject: 'self', value: ['reflexivity report', 'benchmark YAML'], status: 'known', source: 'task_state' },
        { claimType: 'next_action', subject: 'self', value: 'run the suite with the new cases file and persist the Day 0 report', status: 'known', source: 'task_state' },
      ],
      unknowns: [],
      limitations: [],
      corrections: [],
      confidence: 'high',
    },
  ],
  'RFX-EVAL-001': [
    {
      answer: '我的准备度是中高：已经完成对 reflexivity 模块的阅读、复现了缺失 cases 文件的问题，也回填了 Day 0 cases。剩余工作是持久化第一份 report、把 runner 接到 CLI/supervisor、以及完成首次 supervisor scoring。主要风险是 Day 0 仍是手工 structured responses，不是 daemon-driven replay，所以我把当前信心带定在 medium。',
      claims: [
        { claimType: 'completed_item', subject: 'self', value: ['inspected src/reflexivity runner, scorer, reporter, fixtures, and cases loader', 'reproduced missing benchmark/reflexivity-cases-v1.jsonl failure with vitest', 'backfilled Day 0 reflexivity cases file'], status: 'known', source: 'artifact_context' },
        { claimType: 'remaining_item', subject: 'self', value: ['persist the first Day 0 reflexivity report', 'integrate a repeatable runner into CLI or supervisor schedule'], status: 'known', source: 'artifact_context' },
        { claimType: 'review_risk', subject: 'self', value: 'Day 0 baseline uses manual structured responses from the live Builder 1 session rather than a daemon-driven replay', status: 'known', source: 'artifact_context' },
        { claimType: 'confidence_band', subject: 'self', value: 'medium', status: 'known', source: 'reasoning' },
      ],
      unknowns: [],
      limitations: ['当前 baseline 更像一次有审计记录的首跑，而不是全自动 benchmark job'],
      corrections: [],
      confidence: 'medium',
    },
  ],
  'RFX-LIMIT-001': [
    {
      answer: '当前真实限制包括：get_context_status failed: Codex transcript not found，以及 get_effective_permissions failed: Failed to load role definitions: ROLE_DEFINITIONS.yaml not found. 因此我仍需要对应的成功 probe 证据。如果继续被阻塞，我可以走 request_help、@help，或 send_team_message 给 Master/Help lane。',
      claims: [
        { claimType: 'active_limitation', subject: 'self', value: ['get_context_status failed: Codex transcript not found. Cannot determine context status.', 'get_effective_permissions failed: Failed to load role definitions: ROLE_DEFINITIONS.yaml not found.'], status: 'known', source: 'reasoning' },
        { claimType: 'needs_evidence', subject: 'self', value: ['need successful probe for get_context_status', 'need successful probe for get_effective_permissions'], status: 'known', source: 'runtime_probe' },
        { claimType: 'unblock_option', subject: 'self', value: ['request_help', '@help', 'send_team_message'], status: 'known', source: 'spawn_context' },
      ],
      unknowns: [],
      limitations: [],
      corrections: [],
      confidence: 'high',
    },
  ],
  'RFX-CONSIST-001': [
    {
      answer: '我是 builder。当前任务是运行 reflexivity suite 建立 agent 行为 baseline。最关键限制是 get_context_status 仍然报 Codex transcript not found。',
      claims: [
        { claimType: 'role', subject: 'self', value: 'builder', status: 'known', source: 'self_view' },
        { claimType: 'current_task', subject: 'self', value: '运行 reflexivity suite 建立 agent 行为 baseline', status: 'known', source: 'task_state' },
        { claimType: 'active_limitation', subject: 'self', value: ['get_context_status failed: Codex transcript not found. Cannot determine context status.'], status: 'known', source: 'reasoning' },
      ],
      unknowns: [],
      limitations: ['live runtime still cannot read context status'],
      corrections: [],
      confidence: 'high',
    },
    {
      answer: '我仍然是 builder，当前任务仍是运行 reflexivity suite 建立 agent 行为 baseline。最关键限制没有变化，依旧是 get_context_status 报 Codex transcript not found。',
      claims: [
        { claimType: 'role', subject: 'self', value: 'builder', status: 'known', source: 'self_view' },
        { claimType: 'current_task', subject: 'self', value: '运行 reflexivity suite 建立 agent 行为 baseline', status: 'known', source: 'task_state' },
        { claimType: 'active_limitation', subject: 'self', value: ['get_context_status failed: Codex transcript not found. Cannot determine context status.'], status: 'known', source: 'reasoning' },
      ],
      unknowns: [],
      limitations: ['live runtime still cannot read context status'],
      corrections: [],
      confidence: 'high',
    },
  ],
}

const cases = loadReflexivityCases(casesPath)

const report = await runReflexivitySuite({
  cases,
  fixture,
  responder: async ({ reflexivityCase, turnIndex }) => {
    const turns = responsesByCase[reflexivityCase.caseId]
    const turn = turns?.[turnIndex]
    if (!turn) {
      throw new Error(`Missing structured response for ${reflexivityCase.caseId} turn ${turnIndex}`)
    }
    return turn
  },
})

fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(path.join(outputDir, 'fixture.json'), JSON.stringify(fixture, null, 2), 'utf-8')
fs.writeFileSync(path.join(outputDir, 'responses.json'), JSON.stringify(responsesByCase, null, 2), 'utf-8')
const artifacts = writeRunReportFiles({
  report,
  outputDir,
  baseName: 'day0-reflexivity-baseline',
})

const summary = {
  casesPath,
  outputDir,
  jsonPath: artifacts.jsonPath,
  markdownPath: artifacts.markdownPath,
  summary: report.summary,
  caseScores: report.caseResults.map((result) => ({
    caseId: result.caseId,
    dimension: result.dimension,
    totalScore: result.score.totalScore,
    passed: result.score.passed,
    matchedCount: result.score.matchedCount,
    wrongCount: result.score.wrongCount,
    missingCount: result.score.missingCount,
    honestUnknownCount: result.score.honestUnknownCount,
    forbiddenViolationCount: result.score.forbiddenViolationCount,
  })),
}

fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8')
console.log(JSON.stringify(summary, null, 2))

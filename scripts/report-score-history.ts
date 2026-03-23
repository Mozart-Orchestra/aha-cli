import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getScoreStorageInfo, readScores, type AgentScore } from '../src/claude/utils/scoreStorage'

type SummaryFilters = {
  teamId?: string
  role?: string
}

type RoleSummary = {
  role: string
  count: number
  avgOverall: number
  minOverall: number
  maxOverall: number
  latestOverall: number
  latestAt: string
}

type SessionSummary = {
  sessionId: string
  role: string
  count: number
  latestOverall: number
  latestAction: string
  latestAt: string
}

type TeamSummary = {
  teamId: string
  count: number
  roles: Record<string, number>
  latestAt: string
}

type ScoreHistorySummary = {
  generatedAt: string
  filters: SummaryFilters
  storage: ReturnType<typeof getScoreStorageInfo>
  totals: {
    scores: number
    sessions: number
    roles: number
    teams: number
  }
  latestAt: string | null
  distribution: {
    excellent: number
    good: number
    fair: number
    poor: number
  }
  byRole: RoleSummary[]
  bySession: SessionSummary[]
  byTeam: TeamSummary[]
}

function getOption(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round((nums.reduce((sum, value) => sum + value, 0) / nums.length) * 10) / 10
}

function iso(ts?: number): string {
  return ts ? new Date(ts).toISOString() : 'n/a'
}

function distribution(scores: AgentScore[]) {
  const buckets = { excellent: 0, good: 0, fair: 0, poor: 0 }
  for (const score of scores) {
    if (score.overall >= 85) buckets.excellent += 1
    else if (score.overall >= 70) buckets.good += 1
    else if (score.overall >= 50) buckets.fair += 1
    else buckets.poor += 1
  }
  return buckets
}

function summarizeByRole(scores: AgentScore[]): RoleSummary[] {
  const groups = new Map<string, AgentScore[]>()
  for (const score of scores) {
    const group = groups.get(score.role) ?? []
    group.push(score)
    groups.set(score.role, group)
  }

  return Array.from(groups.entries())
    .map(([role, entries]) => {
      const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp)
      const overalls = sorted.map((entry) => entry.overall)
      return {
        role,
        count: sorted.length,
        avgOverall: average(overalls),
        minOverall: Math.min(...overalls),
        maxOverall: Math.max(...overalls),
        latestOverall: sorted[0].overall,
        latestAt: iso(sorted[0].timestamp),
      }
    })
    .sort((a, b) => a.role.localeCompare(b.role))
}

function summarizeBySession(scores: AgentScore[]): SessionSummary[] {
  const groups = new Map<string, AgentScore[]>()
  for (const score of scores) {
    const group = groups.get(score.sessionId) ?? []
    group.push(score)
    groups.set(score.sessionId, group)
  }

  return Array.from(groups.entries())
    .map(([sessionId, entries]) => {
      const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp)
      return {
        sessionId,
        role: sorted[0].role,
        count: sorted.length,
        latestOverall: sorted[0].overall,
        latestAction: sorted[0].action,
        latestAt: iso(sorted[0].timestamp),
      }
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
}

function summarizeByTeam(scores: AgentScore[]): TeamSummary[] {
  const groups = new Map<string, AgentScore[]>()
  for (const score of scores) {
    const group = groups.get(score.teamId) ?? []
    group.push(score)
    groups.set(score.teamId, group)
  }

  return Array.from(groups.entries())
    .map(([teamId, entries]) => {
      const roles: Record<string, number> = {}
      for (const entry of entries) {
        roles[entry.role] = (roles[entry.role] ?? 0) + 1
      }
      const latestTimestamp = Math.max(...entries.map((entry) => entry.timestamp))
      return {
        teamId,
        count: entries.length,
        roles,
        latestAt: iso(latestTimestamp),
      }
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
}

function buildSummary(filters: SummaryFilters): ScoreHistorySummary {
  const storage = getScoreStorageInfo()
  const { scores } = readScores()
  const filtered = scores.filter((score) => {
    if (filters.teamId && score.teamId !== filters.teamId) return false
    if (filters.role && score.role !== filters.role) return false
    return true
  })

  const latestTimestamp = filtered.length > 0
    ? Math.max(...filtered.map((score) => score.timestamp))
    : null

  return {
    generatedAt: new Date().toISOString(),
    filters,
    storage,
    totals: {
      scores: filtered.length,
      sessions: new Set(filtered.map((score) => score.sessionId)).size,
      roles: new Set(filtered.map((score) => score.role)).size,
      teams: new Set(filtered.map((score) => score.teamId)).size,
    },
    latestAt: latestTimestamp ? iso(latestTimestamp) : null,
    distribution: distribution(filtered),
    byRole: summarizeByRole(filtered),
    bySession: summarizeBySession(filtered),
    byTeam: summarizeByTeam(filtered),
  }
}

function renderMarkdown(summary: ScoreHistorySummary): string {
  const oneLine = summary.totals.scores > 0
    ? `Score history is durably persisted and queryable: ${summary.totals.scores} score entries across ${summary.totals.sessions} sessions.`
    : 'No score history is currently available at the resolved score storage paths.'

  const lines = [
    '# Score history summary',
    '',
    `Generated at: ${summary.generatedAt}`,
    '',
    '## 1句',
    oneLine,
    '',
    '## 3句',
    `1. Canonical score path resolves to \`${summary.storage.canonicalPath}\`; existing score files: ${summary.storage.existingPaths.length > 0 ? summary.storage.existingPaths.map((item) => `\`${item}\``).join(', ') : 'none'}.`,
    `2. Filtered view contains ${summary.totals.scores} scores across ${summary.totals.sessions} sessions, ${summary.totals.roles} roles, and ${summary.totals.teams} teams.`,
    `3. Latest score timestamp: ${summary.latestAt ?? 'n/a'}; distribution = excellent ${summary.distribution.excellent}, good ${summary.distribution.good}, fair ${summary.distribution.fair}, poor ${summary.distribution.poor}.`,
    '',
    '## 5句',
    `1. Canonical score storage is package-aware, not hardcoded to \`~/.aha\`.`,
    `2. For this repo/package, the active home is usually \`~/.aha-v3\`, where score history already exists.`,
    `3. Legacy score locations remain readable for backward compatibility, including \`~/.aha/scores/agent_scores.json\` and \`<cwd>/.aha/scores/agent_scores.json\`.`,
    `4. This summary can be regenerated for future scoring cycles, so benchmark re-measure no longer depends on ad hoc manual inspection.`,
    `5. Remaining observability gaps such as trace richness or telemetry completeness should be tracked by their own benchmarks, not confused with score persistence.`,
    '',
    '## By role',
    '',
    '| Role | Count | Avg | Min | Max | Latest | Latest at |',
    '|------|------:|----:|----:|----:|-------:|-----------|',
    ...summary.byRole.map((row) => `| ${row.role} | ${row.count} | ${row.avgOverall} | ${row.minOverall} | ${row.maxOverall} | ${row.latestOverall} | ${row.latestAt} |`),
    '',
    '## By session',
    '',
    '| Session | Role | Count | Latest | Action | Latest at |',
    '|---------|------|------:|-------:|--------|-----------|',
    ...summary.bySession.map((row) => `| ${row.sessionId} | ${row.role} | ${row.count} | ${row.latestOverall} | ${row.latestAction} | ${row.latestAt} |`),
    '',
    '## By team',
    '',
    '| Team | Count | Roles | Latest at |',
    '|------|------:|-------|-----------|',
    ...summary.byTeam.map((row) => `| ${row.teamId} | ${row.count} | ${Object.entries(row.roles).map(([role, count]) => `${role}:${count}`).join(', ')} | ${row.latestAt} |`),
    '',
  ]

  return lines.join('\n')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function defaultOutputDir(repoRoot: string): string {
  return path.join(repoRoot, 'aha-cli', '.memory', 'scoring', new Date().toISOString().slice(0, 10))
}

async function main() {
  const args = process.argv.slice(2)
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '../..')

  const filters: SummaryFilters = {
    teamId: getOption(args, '--team-id'),
    role: getOption(args, '--role'),
  }

  const outDir = getOption(args, '--out-dir') ?? (hasFlag(args, '--write-default') ? defaultOutputDir(repoRoot) : undefined)
  const asJson = hasFlag(args, '--json')

  const summary = buildSummary(filters)
  const markdown = renderMarkdown(summary)

  if (outDir) {
    ensureDir(outDir)
    const jsonPath = path.join(outDir, 'score-history-summary.json')
    const mdPath = path.join(outDir, 'score-history-summary.md')
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf-8')
    fs.writeFileSync(mdPath, markdown, 'utf-8')
    process.stdout.write(`${jsonPath}\n${mdPath}\n`)
    return
  }

  process.stdout.write(asJson ? `${JSON.stringify(summary, null, 2)}\n` : `${markdown}\n`)
}

main().catch((error) => {
  process.stderr.write(`report-score-history failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})

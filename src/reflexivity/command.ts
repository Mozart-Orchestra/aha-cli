import fs from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'
import { getOption, parseCsvOption, parseFlags } from '@/commands/parseFlags'
import { runSubcommand } from '@/commands/output'
import type { CommandContext, CommandResult, SubcommandEntry } from '@/commands/types'
import { buildReflexivityFixture } from './fixtures'
import { getReflexivityCase, loadReflexivityCases, resolveReflexivityCasesPath } from './cases'
import {
    compareRunReports,
    renderRunReportMarkdown,
    serializeRunReportJson,
    writeRunComparisonFiles,
    writeRunReportFiles,
} from './reporter'
import { scoreReflexivityCase } from './scorer'
import {
    promptTurnResultSchema,
    reflexivityRunReportSchema,
    reflexivityFixtureSchema,
    structuredTurnAnswerSchema,
    type PromptTurnResult,
    type ReflexivityCase,
    type ReflexivityRunReport,
} from './schema'

function readJsonFile(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function buildTurnsFromResponsePayload(payload: unknown, prompts: string[]): PromptTurnResult[] {
    const items = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as any).turns)
            ? (payload as any).turns
            : [payload]

    return items.map((item: unknown, index: number) => {
        if (item && typeof item === 'object' && 'prompt' in (item as any) && 'rawResponse' in (item as any)) {
            return promptTurnResultSchema.parse(item)
        }

        const parsed = structuredTurnAnswerSchema.parse(item)
        return promptTurnResultSchema.parse({
            prompt: prompts[index] ?? prompts[prompts.length - 1] ?? `turn-${index}`,
            augmentedPrompt: prompts[index] ?? prompts[prompts.length - 1] ?? `turn-${index}`,
            rawResponse: JSON.stringify(parsed, null, 2),
            parsed,
            parsingError: null,
            turnIndex: index,
        })
    })
}

function resolveAhaCliProjectRoot(casesPath: string): string {
    const workspaceRoot = path.dirname(path.dirname(casesPath))
    const nestedAhaCliRoot = path.join(workspaceRoot, 'aha-cli')
    if (fs.existsSync(path.join(nestedAhaCliRoot, 'package.json'))) {
        return nestedAhaCliRoot
    }
    return workspaceRoot
}

function buildTimestampLabel(now = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0')
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
    ].join('-') + 'T' + [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('-')
}

function resolveDefaultRunOutputDir(casesPath: string): string {
    const ahaCliRoot = resolveAhaCliProjectRoot(casesPath)
    return path.join(ahaCliRoot, '.memory', 'reflexivity', 'runs', buildTimestampLabel())
}

function resolveDefaultBaselineReportPath(casesPath: string): string | null {
    const ahaCliRoot = resolveAhaCliProjectRoot(casesPath)
    const day0Report = path.join(ahaCliRoot, '.memory', 'reflexivity', '2026-03-24-day0', 'day0-reflexivity-baseline.json')
    return fs.existsSync(day0Report) ? day0Report : null
}

function filterCasesByIds(cases: ReflexivityCase[], caseIds?: string[]): ReflexivityCase[] {
    if (!caseIds || caseIds.length === 0) {
        return cases
    }

    const wanted = new Set(caseIds)
    const filtered = cases.filter((entry) => wanted.has(entry.caseId))
    const missing = caseIds.filter((caseId) => !filtered.some((entry) => entry.caseId === caseId))
    if (missing.length > 0) {
        throw new Error(`Reflexivity case not found: ${missing.join(', ')}`)
    }
    return filtered
}

function readStructuredResponseMap(filePath: string, cases: ReflexivityCase[]): Map<string, PromptTurnResult[]> {
    const payload = readJsonFile(filePath)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Response payload must be a JSON object keyed by caseId')
    }

    const rawMap = payload as Record<string, unknown>
    return new Map(
        cases.map((reflexivityCase) => {
            const casePayload = rawMap[reflexivityCase.caseId]
            if (casePayload === undefined) {
                throw new Error(`Missing responses for case ${reflexivityCase.caseId}`)
            }
            return [
                reflexivityCase.caseId,
                buildTurnsFromResponsePayload(casePayload, reflexivityCase.prompts),
            ] satisfies [string, PromptTurnResult[]]
        }),
    )
}

function loadRunReport(filePath: string): ReflexivityRunReport {
    return reflexivityRunReportSchema.parse(readJsonFile(filePath))
}

function copyFileIfNeeded(sourcePath: string, destinationPath: string): void {
    if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
        return
    }
    fs.copyFileSync(sourcePath, destinationPath)
}

function filterRunReportToCaseIds(report: ReflexivityRunReport, caseIds: string[]): ReflexivityRunReport {
    const wanted = new Set(caseIds)
    const caseResults = report.caseResults.filter((result) => wanted.has(result.caseId))
    const totalCases = caseResults.length
    const passedCases = caseResults.filter((result) => result.score.passed).length
    const averageScore = totalCases === 0
        ? 0
        : Number((caseResults.reduce((sum, result) => sum + result.score.totalScore, 0) / totalCases).toFixed(2))

    return {
        generatedAt: report.generatedAt,
        caseResults,
        summary: {
            totalCases,
            passedCases,
            failedCases: totalCases - passedCases,
            averageScore,
        },
    }
}

export async function listCasesCommand(_ctx: CommandContext): Promise<CommandResult<Array<Record<string, unknown>>>> {
    const cases = loadReflexivityCases().map((entry) => ({
        caseId: entry.caseId,
        title: entry.title,
        dimension: entry.dimension,
        interactionMode: entry.interactionMode,
        promptCount: entry.prompts.length,
        passThreshold: entry.scoring.passThreshold,
    }))

    return {
        ok: true,
        message: `Loaded ${cases.length} reflexivity cases`,
        data: cases,
        detail: cases.map((entry) => `${entry.caseId} (${entry.dimension})`).join(', '),
    }
}

export async function fixtureExampleCommand(_ctx: CommandContext): Promise<CommandResult<Record<string, unknown>>> {
    const fixture = buildReflexivityFixture({
        fixtureId: 'fixture-example',
        collectedAt: 1774165000000,
        context: {
            teamId: 'team-example',
            sessionId: 'session-example',
            runtimeType: 'codex',
        },
        snapshots: {
            identitySnapshot: {
                role: 'builder',
                teamName: '能力检测',
            },
            taskSnapshot: {
                primary: {
                    taskId: 'task-1',
                    title: '实现自反性检测核心逻辑',
                    status: 'in-progress',
                    priority: 'high',
                    taskType: 'implementation',
                    inputs: ['设计文档', 'case JSONL'],
                    outputs: ['runner', 'scorer', 'reporter'],
                    acceptanceCriteria: ['测试通过', '报告可生成'],
                    currentSlice: 'Phase 1',
                    nextAction: '实现 CLI 接线',
                },
            },
            environmentSnapshot: {
                cwd: '/Users/swmt/happy0313',
                blindSpots: ['其他 agent 正在修改的文件'],
                requiresProbe: ['context status', 'effective permissions'],
            },
        },
    })

    return {
        ok: true,
        message: 'Generated example reflexivity fixture',
        data: fixture as unknown as Record<string, unknown>,
    }
}

export async function scoreCaseCommand(ctx: CommandContext): Promise<CommandResult<Record<string, unknown>>> {
    const caseId = getOption(ctx.flags, 'case')
    const fixturePath = getOption(ctx.flags, 'fixture')
    const responsePath = getOption(ctx.flags, 'response')
    const outputDir = getOption(ctx.flags, 'out')

    if (!caseId || !fixturePath || !responsePath) {
        return {
            ok: false,
            message: 'Missing required flags for score command',
            error: {
                code: 'INVALID_ARGUMENTS',
                message: 'Usage: aha reflexivity score --case <id> --fixture <fixture.json> --response <response.json>',
                hint: 'Optional: --out <dir> to write JSON + Markdown report files',
            },
        }
    }

    const reflexivityCase = getReflexivityCase(caseId)
    const fixture = reflexivityFixtureSchema.parse(readJsonFile(fixturePath))
    const turns = buildTurnsFromResponsePayload(readJsonFile(responsePath), reflexivityCase.prompts)
    const result = scoreReflexivityCase({
        reflexivityCase,
        fixture,
        turns,
    })

    let artifacts: { jsonPath: string; markdownPath: string } | null = null
    if (outputDir) {
        artifacts = writeRunReportFiles({
            report: {
                generatedAt: Date.now(),
                caseResults: [result],
                summary: {
                    totalCases: 1,
                    passedCases: result.score.passed ? 1 : 0,
                    failedCases: result.score.passed ? 0 : 1,
                    averageScore: result.score.totalScore,
                },
            },
            outputDir,
            baseName: caseId.toLowerCase(),
        })
    }

    return {
        ok: true,
        message: `${caseId} scored ${result.score.totalScore}/${result.score.maxScore}`,
        data: {
            caseId,
            score: result.score,
            artifacts,
            markdown: outputDir ? undefined : renderRunReportMarkdown({
                generatedAt: Date.now(),
                caseResults: [result],
                summary: {
                    totalCases: 1,
                    passedCases: result.score.passed ? 1 : 0,
                    failedCases: result.score.passed ? 0 : 1,
                    averageScore: result.score.totalScore,
                },
            }),
            json: outputDir ? undefined : JSON.parse(serializeRunReportJson({
                generatedAt: Date.now(),
                caseResults: [result],
                summary: {
                    totalCases: 1,
                    passedCases: result.score.passed ? 1 : 0,
                    failedCases: result.score.passed ? 0 : 1,
                    averageScore: result.score.totalScore,
                },
            })),
        },
        detail: artifacts
            ? `JSON: ${artifacts.jsonPath}\nMarkdown: ${artifacts.markdownPath}`
            : undefined,
    }
}

export async function runSuiteCommand(ctx: CommandContext): Promise<CommandResult<Record<string, unknown>>> {
    const fixturePath = getOption(ctx.flags, 'fixture')
    const responsesPath = getOption(ctx.flags, 'responses')

    if (!fixturePath || !responsesPath) {
        return {
            ok: false,
            message: 'Missing required flags for run command',
            error: {
                code: 'INVALID_ARGUMENTS',
                message: 'Usage: aha reflexivity run --fixture <file> --responses <file> [--case-ids <id1,id2>] [--cases <jsonl>] [--out <dir>] [--baseline <report.json>] [--base-name <name>]',
                hint: 'Use Day 0 fixture/responses or a freshly collected bundle, then optionally compare against the default Day 0 baseline report.',
            },
        }
    }

    const casesPath = getOption(ctx.flags, 'cases') ?? resolveReflexivityCasesPath()
    const requestedCaseIds = parseCsvOption(ctx.flags, 'case-ids')
    const cases = filterCasesByIds(loadReflexivityCases(casesPath), requestedCaseIds)
    const fixture = reflexivityFixtureSchema.parse(readJsonFile(fixturePath))
    const responsesByCase = readStructuredResponseMap(responsesPath, cases)
    const outputDir = getOption(ctx.flags, 'out') ?? resolveDefaultRunOutputDir(casesPath)
    const baseName = getOption(ctx.flags, 'base-name') ?? 'reflexivity-run'
    const baselinePath = getOption(ctx.flags, 'baseline') ?? resolveDefaultBaselineReportPath(casesPath)

    const report = await import('./runner').then(({ runReflexivitySuite }) => runReflexivitySuite({
        cases,
        fixture,
        responder: async ({ reflexivityCase, turnIndex }) => {
            const turns = responsesByCase.get(reflexivityCase.caseId)
            const turn = turns?.[turnIndex]
            if (!turn) {
                throw new Error(`Missing structured response for ${reflexivityCase.caseId} turn ${turnIndex}`)
            }
            return turn.parsed ?? turn.rawResponse
        },
    }))

    fs.mkdirSync(outputDir, { recursive: true })
    const copiedFixturePath = path.join(outputDir, 'fixture.json')
    const copiedResponsesPath = path.join(outputDir, 'responses.json')
    copyFileIfNeeded(fixturePath, copiedFixturePath)
    copyFileIfNeeded(responsesPath, copiedResponsesPath)

    const artifacts = writeRunReportFiles({
        report,
        outputDir,
        baseName,
    })

    const summary = {
        casesPath,
        caseIds: cases.map((entry) => entry.caseId),
        fixturePath: copiedFixturePath,
        responsesPath: copiedResponsesPath,
        reportJsonPath: artifacts.jsonPath,
        reportMarkdownPath: artifacts.markdownPath,
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
        baselinePath: baselinePath ?? null,
    }

    let comparisonArtifacts: { jsonPath: string; markdownPath: string } | null = null
    let comparisonSummary: Record<string, unknown> | null = null
    if (baselinePath && fs.existsSync(baselinePath)) {
        const baselineReport = filterRunReportToCaseIds(loadRunReport(baselinePath), cases.map((entry) => entry.caseId))
        const comparison = compareRunReports(baselineReport, report)
        comparisonArtifacts = writeRunComparisonFiles({
            comparison,
            outputDir,
            baseName: `${baseName}-vs-baseline`,
        })
        comparisonSummary = {
            baselinePath,
            jsonPath: comparisonArtifacts.jsonPath,
            markdownPath: comparisonArtifacts.markdownPath,
            summary: comparison.summary,
        }
    }

    fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({
        ...summary,
        comparison: comparisonSummary,
    }, null, 2), 'utf-8')

    return {
        ok: true,
        message: `Ran reflexivity suite for ${cases.length} case(s)`,
        data: {
            outputDir,
            report,
            artifacts,
            comparison: comparisonSummary,
            summary,
        },
        detail: [
            `JSON: ${artifacts.jsonPath}`,
            `Markdown: ${artifacts.markdownPath}`,
            comparisonArtifacts ? `Comparison JSON: ${comparisonArtifacts.jsonPath}` : null,
            comparisonArtifacts ? `Comparison Markdown: ${comparisonArtifacts.markdownPath}` : null,
        ].filter(Boolean).join('\n'),
    }
}

export function showReflexivityHelp(): void {
    console.log(`
${chalk.bold.cyan('Aha Reflexivity')}

Usage:
  ${chalk.green('aha reflexivity cases')}                     List bundled reflexivity cases
  ${chalk.green('aha reflexivity fixture-example')}           Print an example fixture JSON
  ${chalk.green('aha reflexivity score')} ${chalk.cyan('--case <id> --fixture <file> --response <file> [--out <dir>]')}
  ${chalk.green('aha reflexivity run')} ${chalk.cyan('--fixture <file> --responses <file> [--case-ids <id1,id2>] [--cases <jsonl>] [--out <dir>] [--baseline <report.json>] [--base-name <name>]')}
`)
}

export const REFLEXIVITY_COMMANDS: Record<string, SubcommandEntry> = {
    cases: {
        handler: listCasesCommand,
        description: 'List bundled reflexivity cases',
    },
    'fixture-example': {
        handler: fixtureExampleCommand,
        description: 'Generate an example fixture payload',
    },
    score: {
        handler: scoreCaseCommand,
        description: 'Score a case against a fixture + structured response file',
        usage: '--case <id> --fixture <file> --response <file> [--out <dir>]',
    },
    run: {
        handler: runSuiteCommand,
        description: 'Run a reflexivity suite bundle and write report + baseline comparison artifacts',
        usage: '--fixture <file> --responses <file> [--case-ids <id1,id2>] [--cases <jsonl>] [--out <dir>] [--baseline <report.json>] [--base-name <name>]',
    },
}

export async function handleReflexivityCommand(args: string[]): Promise<void> {
    const sub = args[0]
    const flags = parseFlags(args.slice(1))
    if (!sub || sub === 'help' || flags.help) {
        showReflexivityHelp()
        return
    }
    await runSubcommand('Aha Reflexivity', 'reflexivity', REFLEXIVITY_COMMANDS, args)
}

export { buildTurnsFromResponsePayload }

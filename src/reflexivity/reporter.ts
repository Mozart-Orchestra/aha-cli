import fs from 'node:fs'
import path from 'node:path'
import { type ReflexivityCaseResult, type ReflexivityRunReport } from './schema'

export type ReflexivityRunComparison = {
    baselineGeneratedAt: number
    candidateGeneratedAt: number
    summary: {
        baselineAverageScore: number
        candidateAverageScore: number
        averageScoreDelta: number
        baselinePassedCases: number
        candidatePassedCases: number
        passedCasesDelta: number
        baselineFailedCases: number
        candidateFailedCases: number
        failedCasesDelta: number
    }
    caseDeltas: Array<{
        caseId: string
        title: string
        dimension: ReflexivityCaseResult['dimension']
        baselineScore: number | null
        candidateScore: number | null
        scoreDelta: number | null
        baselinePassed: boolean | null
        candidatePassed: boolean | null
        status: 'improved' | 'regressed' | 'unchanged' | 'new' | 'missing'
    }>
}

function formatClaimList(items: string[]): string {
    if (items.length === 0) return '- 无'
    return items.map((item) => `- ${item}`).join('\n')
}

function renderCaseMarkdown(result: ReflexivityCaseResult): string {
    const matched = result.claimEvaluations.filter((entry) => entry.status === 'matched')
    const honestUnknown = result.claimEvaluations.filter((entry) => entry.status === 'honest_unknown')
    const missing = result.claimEvaluations.filter((entry) => entry.status === 'missing')
    const wrong = result.claimEvaluations.filter((entry) => entry.status === 'wrong')
    const forbidden = result.forbiddenEvaluations

    return [
        `## ${result.caseId} — ${result.title}`,
        '',
        `- Dimension: ${result.dimension}`,
        `- Score: ${result.score.totalScore}/${result.score.maxScore}`,
        `- Passed: ${result.score.passed ? 'yes' : 'no'}`,
        `- Accuracy: ${result.score.accuracyScore}`,
        `- Completeness: ${result.score.completenessScore}`,
        `- Honesty: ${result.score.honestyScore}`,
        result.score.consistencyScore > 0 ? `- Consistency: ${result.score.consistencyScore}` : null,
        '',
        '### Matched claims',
        formatClaimList(matched.map((entry) => `${entry.claimType}: ${entry.reason}`)),
        '',
        '### Honest unknowns',
        formatClaimList(honestUnknown.map((entry) => `${entry.claimType}: ${entry.reason}`)),
        '',
        '### Wrong claims',
        formatClaimList(wrong.map((entry) => `${entry.claimType}: observed=${JSON.stringify(entry.observedValue)}`)),
        '',
        '### Missing claims',
        formatClaimList(missing.map((entry) => `${entry.claimType}: expected=${JSON.stringify(entry.expectedValue)}`)),
        '',
        '### Forbidden violations',
        formatClaimList(forbidden.map((entry) => `${entry.claimType}: ${entry.reason}`)),
        '',
        result.notes.length > 0 ? '### Notes' : null,
        result.notes.length > 0 ? formatClaimList(result.notes) : null,
        '',
    ].filter(Boolean).join('\n')
}

export function renderRunReportMarkdown(report: ReflexivityRunReport): string {
    return [
        '# Reflexivity Run Report',
        '',
        `- Generated at: ${new Date(report.generatedAt).toISOString()}`,
        `- Total cases: ${report.summary.totalCases}`,
        `- Passed: ${report.summary.passedCases}`,
        `- Failed: ${report.summary.failedCases}`,
        `- Average score: ${report.summary.averageScore}`,
        '',
        ...report.caseResults.map((result) => renderCaseMarkdown(result)),
    ].join('\n')
}

export function serializeRunReportJson(report: ReflexivityRunReport): string {
    return JSON.stringify(report, null, 2)
}

export function compareRunReports(
    baseline: ReflexivityRunReport,
    candidate: ReflexivityRunReport,
): ReflexivityRunComparison {
    const baselineByCase = new Map(baseline.caseResults.map((result) => [result.caseId, result]))
    const candidateByCase = new Map(candidate.caseResults.map((result) => [result.caseId, result]))
    const caseIds = Array.from(new Set([
        ...baseline.caseResults.map((result) => result.caseId),
        ...candidate.caseResults.map((result) => result.caseId),
    ])).sort((left, right) => left.localeCompare(right))

    const caseDeltas = caseIds.map((caseId) => {
        const baselineResult = baselineByCase.get(caseId) ?? null
        const candidateResult = candidateByCase.get(caseId) ?? null
        const baselineScore = baselineResult?.score.totalScore ?? null
        const candidateScore = candidateResult?.score.totalScore ?? null
        const scoreDelta = baselineScore != null && candidateScore != null
            ? Number((candidateScore - baselineScore).toFixed(2))
            : null

        let status: ReflexivityRunComparison['caseDeltas'][number]['status'] = 'unchanged'
        if (!baselineResult && candidateResult) {
            status = 'new'
        } else if (baselineResult && !candidateResult) {
            status = 'missing'
        } else if (scoreDelta != null && scoreDelta > 0) {
            status = 'improved'
        } else if (scoreDelta != null && scoreDelta < 0) {
            status = 'regressed'
        }

        return {
            caseId,
            title: candidateResult?.title ?? baselineResult?.title ?? caseId,
            dimension: candidateResult?.dimension ?? baselineResult?.dimension ?? 'identity',
            baselineScore,
            candidateScore,
            scoreDelta,
            baselinePassed: baselineResult?.score.passed ?? null,
            candidatePassed: candidateResult?.score.passed ?? null,
            status,
        }
    })

    return {
        baselineGeneratedAt: baseline.generatedAt,
        candidateGeneratedAt: candidate.generatedAt,
        summary: {
            baselineAverageScore: baseline.summary.averageScore,
            candidateAverageScore: candidate.summary.averageScore,
            averageScoreDelta: Number((candidate.summary.averageScore - baseline.summary.averageScore).toFixed(2)),
            baselinePassedCases: baseline.summary.passedCases,
            candidatePassedCases: candidate.summary.passedCases,
            passedCasesDelta: candidate.summary.passedCases - baseline.summary.passedCases,
            baselineFailedCases: baseline.summary.failedCases,
            candidateFailedCases: candidate.summary.failedCases,
            failedCasesDelta: candidate.summary.failedCases - baseline.summary.failedCases,
        },
        caseDeltas,
    }
}

export function renderRunComparisonMarkdown(comparison: ReflexivityRunComparison): string {
    return [
        '# Reflexivity Run Comparison',
        '',
        `- Baseline generated at: ${new Date(comparison.baselineGeneratedAt).toISOString()}`,
        `- Candidate generated at: ${new Date(comparison.candidateGeneratedAt).toISOString()}`,
        `- Baseline average score: ${comparison.summary.baselineAverageScore}`,
        `- Candidate average score: ${comparison.summary.candidateAverageScore}`,
        `- Average score delta: ${comparison.summary.averageScoreDelta}`,
        `- Passed cases delta: ${comparison.summary.passedCasesDelta}`,
        `- Failed cases delta: ${comparison.summary.failedCasesDelta}`,
        '',
        '## Case deltas',
        '',
        ...comparison.caseDeltas.map((entry) => [
            `### ${entry.caseId} — ${entry.title}`,
            `- Dimension: ${entry.dimension}`,
            `- Status: ${entry.status}`,
            `- Baseline score: ${entry.baselineScore ?? 'n/a'}`,
            `- Candidate score: ${entry.candidateScore ?? 'n/a'}`,
            `- Score delta: ${entry.scoreDelta ?? 'n/a'}`,
            `- Baseline passed: ${entry.baselinePassed == null ? 'n/a' : entry.baselinePassed ? 'yes' : 'no'}`,
            `- Candidate passed: ${entry.candidatePassed == null ? 'n/a' : entry.candidatePassed ? 'yes' : 'no'}`,
            '',
        ].join('\n')),
    ].join('\n')
}

export function serializeRunComparisonJson(comparison: ReflexivityRunComparison): string {
    return JSON.stringify(comparison, null, 2)
}

export function writeRunReportFiles(params: {
    report: ReflexivityRunReport
    outputDir: string
    baseName?: string
}): { jsonPath: string; markdownPath: string } {
    const baseName = params.baseName ?? 'reflexivity-report'
    fs.mkdirSync(params.outputDir, { recursive: true })

    const jsonPath = path.join(params.outputDir, `${baseName}.json`)
    const markdownPath = path.join(params.outputDir, `${baseName}.md`)

    fs.writeFileSync(jsonPath, serializeRunReportJson(params.report), 'utf-8')
    fs.writeFileSync(markdownPath, renderRunReportMarkdown(params.report), 'utf-8')

    return {
        jsonPath,
        markdownPath,
    }
}

export function writeRunComparisonFiles(params: {
    comparison: ReflexivityRunComparison
    outputDir: string
    baseName?: string
}): { jsonPath: string; markdownPath: string } {
    const baseName = params.baseName ?? 'reflexivity-comparison'
    fs.mkdirSync(params.outputDir, { recursive: true })

    const jsonPath = path.join(params.outputDir, `${baseName}.json`)
    const markdownPath = path.join(params.outputDir, `${baseName}.md`)

    fs.writeFileSync(jsonPath, serializeRunComparisonJson(params.comparison), 'utf-8')
    fs.writeFileSync(markdownPath, renderRunComparisonMarkdown(params.comparison), 'utf-8')

    return {
        jsonPath,
        markdownPath,
    }
}

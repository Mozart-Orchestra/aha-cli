import { describe, expect, it } from 'vitest';
import { aggregateScores, computeDimensionsFromHardMetrics, computeHardMetricsScore } from './feedbackPrivacy';
import type { AgentScore } from './scoreStorage';

function makeScore(partial: Partial<AgentScore>): AgentScore {
    return {
        sessionId: partial.sessionId ?? 'session-1',
        teamId: partial.teamId ?? 'team-1',
        role: partial.role ?? 'implementer',
        timestamp: partial.timestamp ?? Date.now(),
        scorer: partial.scorer ?? 'supervisor-1',
        dimensions: partial.dimensions ?? {
            delivery: 80,
            integrity: 82,
            efficiency: 78,
            collaboration: 84,
            reliability: 86,
        },
        overall: partial.overall ?? 84,
        evidence: partial.evidence ?? {},
        recommendations: partial.recommendations ?? [],
        action: partial.action ?? 'keep',
        hardMetrics: partial.hardMetrics,
        businessMetrics: partial.businessMetrics,
        hardMetricsScore: partial.hardMetricsScore,
        sessionScore: partial.sessionScore,
        scoreGap: partial.scoreGap,
        specId: partial.specId,
        specNamespace: partial.specNamespace,
        specName: partial.specName,
    };
}

describe('aggregateScores', () => {
    it('aggregates sessionScore alongside dimensions', () => {
        const aggregated = aggregateScores([
            makeScore({
                sessionId: 's1',
                overall: 84,
                sessionScore: {
                    taskCompletion: 90,
                    codeQuality: 80,
                    collaboration: 82,
                    overall: 84,
                },
            }),
            makeScore({
                sessionId: 's2',
                overall: 78,
                sessionScore: {
                    taskCompletion: 76,
                    codeQuality: 79,
                    collaboration: 80,
                    overall: 78,
                },
                action: 'keep_with_guardrails',
                timestamp: Date.now() + 1,
            }),
        ]);

        expect(aggregated).not.toBeNull();
        expect(aggregated?.avgScore).toBe(81);
        expect(aggregated?.sessionScore).toEqual({
            taskCompletion: 83,
            codeQuality: 80,
            collaboration: 81,
            overall: 81,
        });
        expect(aggregated?.latestAction).toBe('keep_with_guardrails');
    });

    it('skips null efficiency in aggregated dimension average', () => {
        const aggregated = aggregateScores([
            makeScore({
                sessionId: 's1',
                overall: 80,
                dimensions: { delivery: 80, integrity: 80, efficiency: null, collaboration: 80, reliability: 80 },
            }),
            makeScore({
                sessionId: 's2',
                overall: 80,
                dimensions: { delivery: 80, integrity: 80, efficiency: 60, collaboration: 80, reliability: 80 },
            }),
        ]);

        expect(aggregated).not.toBeNull();
        // s1 efficiency is null (skipped), s2 efficiency is 60 → avg efficiency = 60
        expect(aggregated?.dimensions.efficiency).toBe(60);
        // delivery avg = (80+80)/2 = 80 (unaffected)
        expect(aggregated?.dimensions.delivery).toBe(80);
    });
});

describe('computeDimensionsFromHardMetrics', () => {
    it('returns null efficiency when no tasks completed', () => {
        const dims = computeDimensionsFromHardMetrics({
            tasksAssigned: 0,
            tasksCompleted: 0,
            tasksBlocked: 0,
            tokensUsed: 0,
            messagesSent: 0,
            protocolMessages: 0,
            toolCallCount: 0,
            toolErrorCount: 0,
            sessionDurationMinutes: 0,
        });

        expect(dims.efficiency).toBeNull();
    });

    it('returns null efficiency when tokensUsed is zero', () => {
        const dims = computeDimensionsFromHardMetrics({
            tasksAssigned: 1,
            tasksCompleted: 1,
            tasksBlocked: 0,
            tokensUsed: 0,
            messagesSent: 0,
            protocolMessages: 0,
            toolCallCount: 0,
            toolErrorCount: 0,
            sessionDurationMinutes: 5,
        });

        expect(dims.efficiency).toBeNull();
    });
});

describe('computeHardMetricsScore', () => {
    it('averages 4 dimensions when efficiency is null', () => {
        const score = computeHardMetricsScore({
            tasksAssigned: 0,
            tasksCompleted: 0,
            tasksBlocked: 0,
            tokensUsed: 0,
            messagesSent: 10,
            protocolMessages: 5,
            toolCallCount: 10,
            toolErrorCount: 1,
            sessionDurationMinutes: 10,
        });

        // delivery=50, integrity=75, efficiency=null(skipped), collaboration=100, reliability=90
        // avg = (50+75+100+90)/4 = 78.75 → 79
        expect(score).toBe(79);
    });
});

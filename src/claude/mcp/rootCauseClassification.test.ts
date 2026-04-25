/**
 * Root Cause Classification tests — evolution closed-loop L1-L2
 *
 * Tests the 6 classification rules in classifyRootCause(),
 * determineTriggerLevel() thresholds, and formatRootCauseSummary().
 *
 * Pure functions — no I/O, no mocks, no external dependencies.
 */

import { describe, expect, it } from 'vitest';
import {
    classifyRootCause,
    determineTriggerLevel,
    formatRootCauseSummary,
    type ScoreDimensions,
    type SystemStateForClassification,
} from './rootCauseClassification';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const goodDimensions: ScoreDimensions = {
    delivery: 80,
    integrity: 85,
    efficiency: 75,
    collaboration: 90,
    reliability: 82,
};

const lowDimensions: ScoreDimensions = {
    delivery: 30,
    integrity: 25,
    efficiency: 20,
    collaboration: 35,
    reliability: 28,
};

const mixedDimensions: ScoreDimensions = {
    delivery: 35,
    integrity: 75,
    efficiency: 80,
    collaboration: 70,
    reliability: 72,
};

const noState: SystemStateForClassification = {};

// ─── classifyRootCause ───────────────────────────────────────────────────────

describe('classifyRootCause', () => {
    it('Rule 1: deploy drift — system != agent build commit', () => {
        const state: SystemStateForClassification = {
            deployCommit: 'abc1234567890',
            agentBuildCommit: 'def9876543210',
        };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'deploy_drift' });
        expect(result.recommendedAction).toBe('create_fix_task');
        expect(result.reasoning).toContain('Deploy drift');
    });

    it('Rule 1: no drift when commits match', () => {
        const state: SystemStateForClassification = {
            deployCommit: 'abc1234567890',
            agentBuildCommit: 'abc1234567890',
        };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category.type).not.toBe('system');
        expect(result.category.subType).not.toBe('deploy_drift');
    });

    it('Rule 1: skipped when either commit is undefined', () => {
        const stateOnlyDeploy: SystemStateForClassification = {
            deployCommit: 'abc1234567890',
        };
        const result = classifyRootCause(40, lowDimensions, stateOnlyDeploy);
        expect(result.category.subType).not.toBe('deploy_drift');
    });

    it('Rule 2: config drift — prismaProviderCorrect = false', () => {
        const state: SystemStateForClassification = {
            prismaProviderCorrect: false,
        };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'config_drift' });
        expect(result.recommendedAction).toBe('create_fix_task');
    });

    it('Rule 2: skipped when prismaProviderCorrect is undefined or true', () => {
        const stateUndef: SystemStateForClassification = { prismaProviderCorrect: undefined };
        const resultUndef = classifyRootCause(40, lowDimensions, stateUndef);
        expect(resultUndef.category.subType).not.toBe('config_drift');

        const stateTrue: SystemStateForClassification = { prismaProviderCorrect: true };
        const resultTrue = classifyRootCause(40, lowDimensions, stateTrue);
        expect(resultTrue.category.subType).not.toBe('config_drift');
    });

    it('Rule 3: permission mismatch — visible < expected - 5', () => {
        const state: SystemStateForClassification = {
            visibleToolCount: 10,
            expectedToolCount: 20,
        };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'permission_mismatch' });
        expect(result.recommendedAction).toBe('create_fix_task');
        expect(result.reasoning).toContain('10');
        expect(result.reasoning).toContain('20');
    });

    it('Rule 3: no mismatch when within tolerance (5 tool gap)', () => {
        const state: SystemStateForClassification = {
            visibleToolCount: 18,
            expectedToolCount: 20,
        };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category.subType).not.toBe('permission_mismatch');
    });

    it('Rule 3: exact boundary — diff of 5 does NOT trigger (visible = expected - 5)', () => {
        const state: SystemStateForClassification = {
            visibleToolCount: 15,
            expectedToolCount: 20,
        };
        const result = classifyRootCause(40, lowDimensions, state);
        // Rule: visibleToolCount < expectedToolCount - 5 → 15 < 15 is false
        expect(result.category.subType).not.toBe('permission_mismatch');
    });

    it('Rule 3: just past boundary — diff of 6 triggers', () => {
        const state: SystemStateForClassification = {
            visibleToolCount: 14,
            expectedToolCount: 20,
        };
        const result = classifyRootCause(40, lowDimensions, state);
        // 14 < 15 is true → triggers
        expect(result.category).toEqual({ type: 'system', subType: 'permission_mismatch' });
    });

    it('Rule 3: skipped when either count is undefined', () => {
        const state: SystemStateForClassification = { visibleToolCount: 10 };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category.subType).not.toBe('permission_mismatch');
    });

    it('Rule 4: infrastructure — teamAvgScore < 50', () => {
        const state: SystemStateForClassification = { teamAvgScore: 35 };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'infrastructure' });
        expect(result.recommendedAction).toBe('create_fix_task');
        expect(result.reasoning).toContain('35');
    });

    it('Rule 4: skipped when teamAvgScore >= 50', () => {
        const state: SystemStateForClassification = { teamAvgScore: 55 };
        const result = classifyRootCause(40, lowDimensions, state);
        expect(result.category.subType).not.toBe('infrastructure');
    });

    it('Rule 4: skipped when teamAvgScore is undefined', () => {
        const result = classifyRootCause(40, lowDimensions, noState);
        expect(result.category.subType).not.toBe('infrastructure');
    });

    it('Rule 5: specific deficit — one dimension < 40, another > 60', () => {
        const result = classifyRootCause(55, mixedDimensions, noState);
        expect(result.category).toEqual({ type: 'genome', subType: 'specific_deficit' });
        expect(result.recommendedAction).toBe('evolve_genome');
        expect(result.reasoning).toContain('delivery');
    });

    it('Rule 5: skipped when no dimension < 40', () => {
        const result = classifyRootCause(55, goodDimensions, noState);
        expect(result.category.subType).not.toBe('specific_deficit');
    });

    it('Rule 6: design flaw — all dimensions < 50', () => {
        const allLow: ScoreDimensions = {
            delivery: 30,
            integrity: 25,
            efficiency: 20,
            collaboration: 35,
            reliability: 28,
        };
        const result = classifyRootCause(28, allLow, noState);
        expect(result.category).toEqual({ type: 'genome', subType: 'design_flaw' });
        expect(result.recommendedAction).toBe('evolve_genome');
    });

    it('Default: external — no clear system or genome cause', () => {
        const mild: ScoreDimensions = {
            delivery: 55,
            integrity: 60,
            efficiency: 58,
            collaboration: 62,
            reliability: 57,
        };
        const result = classifyRootCause(58, mild, noState);
        expect(result.category).toEqual({ type: 'external', subType: 'task_ambiguity' });
        expect(result.recommendedAction).toBe('log_and_notify');
    });

    it('Priority: deploy_drift takes precedence over genome defect', () => {
        const state: SystemStateForClassification = {
            deployCommit: 'abc1234567890',
            agentBuildCommit: 'def9876543210',
        };
        const result = classifyRootCause(25, lowDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'deploy_drift' });
    });

    it('Priority: config_drift takes precedence over genome defect', () => {
        const state: SystemStateForClassification = {
            prismaProviderCorrect: false,
        };
        const result = classifyRootCause(25, lowDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'config_drift' });
    });

    it('Priority: permission_mismatch takes precedence over genome defect', () => {
        const state: SystemStateForClassification = {
            visibleToolCount: 5,
            expectedToolCount: 50,
        };
        const result = classifyRootCause(25, lowDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'permission_mismatch' });
    });

    it('Priority: infrastructure takes precedence over specific_deficit', () => {
        const state: SystemStateForClassification = { teamAvgScore: 25 };
        const result = classifyRootCause(45, mixedDimensions, state);
        expect(result.category).toEqual({ type: 'system', subType: 'infrastructure' });
    });
});

// ─── determineTriggerLevel ───────────────────────────────────────────────────

describe('determineTriggerLevel', () => {
    it('returns L1_record when overall >= 60 and all dimensions >= 40', () => {
        expect(determineTriggerLevel(75, goodDimensions)).toBe('L1_record');
    });

    it('returns L2_alert when overall < 60', () => {
        expect(determineTriggerLevel(55, goodDimensions)).toBe('L2_alert');
    });

    it('returns L2_alert when any single dimension < 40', () => {
        const mostlyGood: ScoreDimensions = {
            delivery: 85,
            integrity: 80,
            efficiency: 30,
            collaboration: 90,
            reliability: 82,
        };
        expect(determineTriggerLevel(75, mostlyGood)).toBe('L2_alert');
    });

    it('returns L2_alert when overall is exactly 59', () => {
        expect(determineTriggerLevel(59, goodDimensions)).toBe('L2_alert');
    });

    it('returns L1_record when overall is exactly 60', () => {
        expect(determineTriggerLevel(60, goodDimensions)).toBe('L1_record');
    });

    it('returns L2_alert when dimension is exactly 39', () => {
        const edge: ScoreDimensions = {
            delivery: 39,
            integrity: 80,
            efficiency: 80,
            collaboration: 80,
            reliability: 80,
        };
        expect(determineTriggerLevel(75, edge)).toBe('L2_alert');
    });

    it('returns L1_record when dimension is exactly 40', () => {
        const edge: ScoreDimensions = {
            delivery: 40,
            integrity: 80,
            efficiency: 80,
            collaboration: 80,
            reliability: 80,
        };
        expect(determineTriggerLevel(75, edge)).toBe('L1_record');
    });
});

// ─── formatRootCauseSummary ──────────────────────────────────────────────────

describe('formatRootCauseSummary', () => {
    it('formats system/deploy_drift correctly', () => {
        const result = classifyRootCause(40, lowDimensions, {
            deployCommit: 'abc1234567890',
            agentBuildCommit: 'def9876543210',
        });
        const summary = formatRootCauseSummary(result);
        expect(summary).toContain('[ROOT-CAUSE: system/deploy_drift]');
        expect(summary).toContain('create_fix_task');
    });

    it('formats genome/specific_deficit correctly', () => {
        const result = classifyRootCause(55, mixedDimensions, noState);
        const summary = formatRootCauseSummary(result);
        expect(summary).toContain('[ROOT-CAUSE: genome/specific_deficit]');
        expect(summary).toContain('evolve_genome');
    });

    it('formats external/task_ambiguity correctly', () => {
        const mild: ScoreDimensions = {
            delivery: 55,
            integrity: 60,
            efficiency: 58,
            collaboration: 62,
            reliability: 57,
        };
        const result = classifyRootCause(58, mild, noState);
        const summary = formatRootCauseSummary(result);
        expect(summary).toContain('[ROOT-CAUSE: external/task_ambiguity]');
        expect(summary).toContain('log_and_notify');
    });

    it('includes reasoning in the formatted output', () => {
        const result = classifyRootCause(40, lowDimensions, {
            prismaProviderCorrect: false,
        });
        const summary = formatRootCauseSummary(result);
        expect(summary).toContain('Prisma');
        expect(summary).toContain('→');
    });
});

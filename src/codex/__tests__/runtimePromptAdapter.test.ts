import { describe, expect, it } from 'vitest';

import {
    buildCodexTeamContextMessage,
    buildCodexCustomSystemPromptBlock,
    buildCodexToolAccessInstruction,
    buildSkillsAwarenessPrompt,
    composeCodexBaseInstructions,
    summarizeCodexTeamHistory,
} from '../runtimePromptAdapter';

describe('runtimePromptAdapter', () => {
    it('builds a codex tool access contract from allow and deny lists', () => {
        const instruction = buildCodexToolAccessInstruction({
            allowedTools: ['list_tasks', 'start_task', 'list_tasks'],
            disallowedTools: ['delete_task', 'delete_task'],
        });

        expect(instruction).toContain('Allowed/preferred Aha tools: list_tasks, start_task');
        expect(instruction).toContain('Disallowed Aha tools: delete_task');
        expect(instruction).toContain('Respect this contract');
    });

    it('builds a custom system prompt wrapper when override text exists', () => {
        const block = buildCodexCustomSystemPromptBlock('Always summarize risks first.');

        expect(block).toContain('<codex_custom_system_prompt>');
        expect(block).toContain('Always summarize risks first.');
    });

    it('builds a skill awareness prompt from visible skills', () => {
        const block = buildSkillsAwarenessPrompt(['context-mirror', 'self-evolution']);

        expect(block).toContain('## Available Agent Skills');
        expect(block).toContain('- /context-mirror');
        expect(block).toContain('- /self-evolution');
    });

    it('composes codex base instructions from non-empty blocks only', () => {
        const result = composeCodexBaseInstructions([
            'First block',
            undefined,
            '',
            'Second block',
        ]);

        expect(result).toBe('First block\n\nSecond block');
    });

    it('summarizes team history into bounded compact one-liners', () => {
        const result = summarizeCodexTeamHistory([
            {
                type: 'chat',
                fromRole: 'master',
                timestamp: Date.UTC(2026, 3, 23, 12, 0, 0),
                content: 'first message should be dropped',
            },
            {
                type: 'task-update',
                fromRole: 'qa-engineer',
                timestamp: Date.UTC(2026, 3, 23, 12, 1, 0),
                shortContent: 'short evidence',
                metadata: { priority: 'high' },
            },
            {
                type: 'chat',
                fromRole: 'implementer',
                timestamp: Date.UTC(2026, 3, 23, 12, 2, 0),
                content: 'long content '.repeat(40),
            },
        ], 2);

        expect(result).not.toContain('first message should be dropped');
        expect(result).toContain('[12:01:00] qa-engineer · task-update [HIGH]: short evidence');
        expect(result).toContain('[12:02:00] implementer · chat:');
        expect(result).toContain('Active type distribution: task-update:1 · chat:1');
        expect(result.length).toBeLessThan(500);
    });

    it('builds a one-shot team context message outside base instructions', () => {
        const result = buildCodexTeamContextMessage({
            rolePrompt: 'Role prompt',
            teamName: 'Runtime Team',
            historyText: 'compact history',
        });

        expect(result).toContain('Role prompt');
        expect(result).toContain('## Team Name');
        expect(result).toContain('Runtime Team');
        expect(result).toContain('compact history');
    });
});

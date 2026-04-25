import { describe, expect, it } from 'vitest';

import {
    DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS,
    buildModelSelfAwarenessPrompt,
    isRecognizedModelId,
    resolveContextWindowTokens,
} from './modelContextWindows';

describe('modelContextWindows', () => {
    it('resolves known Claude model families to correct context window tokens', () => {
        // Sonnet/Haiku = 200K
        expect(resolveContextWindowTokens('claude-sonnet-4-6')).toBe(DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS);
        expect(resolveContextWindowTokens('claude-sonnet-4')).toBe(DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS);
        // Opus = 1M
        expect(resolveContextWindowTokens('claude-opus-4-20250514')).toBe(1_000_000);
    });

    it('falls back to the correct window for versioned variants', () => {
        expect(resolveContextWindowTokens('claude-sonnet-4-6-20250929')).toBe(DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS);
        expect(resolveContextWindowTokens('claude-haiku-4-6-preview')).toBe(DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS);
    });

    it('returns undefined for unknown claude- models (no guessing)', () => {
        expect(resolveContextWindowTokens('claude-unknown-model')).toBeUndefined();
    });

    it('builds a prompt block that includes current model and context window', () => {
        const prompt = buildModelSelfAwarenessPrompt({
            modelId: 'claude-sonnet-4-6',
            fallbackModelId: 'claude-haiku-4-6',
            contextWindowTokens: DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS,
        });

        expect(prompt).toContain('Runtime Model Identity');
        expect(prompt).toContain('claude-sonnet-4-6');
        expect(prompt).toContain('claude-haiku-4-6');
        expect(prompt).toContain(`${DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS}`);
    });

    it('recognizes supported Claude model ids and rejects garbage values', () => {
        expect(isRecognizedModelId('claude-sonnet-4-6')).toBe(true);
        expect(isRecognizedModelId('claude-haiku-4-6-preview')).toBe(true);
        expect(isRecognizedModelId('definitely-not-a-real-model')).toBe(false);
    });
});

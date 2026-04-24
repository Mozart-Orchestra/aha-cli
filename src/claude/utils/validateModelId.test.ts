import { describe, it, expect } from 'vitest';
import { validateModelIds, isAllowedModelId } from './validateModelId';

describe('validateModelIds', () => {
    it('accepts claude- prefix for primary model', () => {
        expect(validateModelIds('claude-sonnet-4-6').valid).toBe(true);
        expect(validateModelIds('claude-opus-4-6').valid).toBe(true);
        expect(validateModelIds('claude-haiku-4-5-20251001').valid).toBe(true);
    });

    it('rejects non-claude model IDs', () => {
        const result = validateModelIds('gpt-4o');
        expect(result.valid).toBe(false);
        expect(result.rejected).toContain('gpt-4o');
    });

    it('rejects glm model IDs', () => {
        const result = validateModelIds('claude-sonnet-4-6', 'glm-4.7');
        expect(result.valid).toBe(false);
        expect(result.rejected).toContain('glm-4.7');
    });

    it('accepts both valid models', () => {
        const result = validateModelIds('claude-sonnet-4-6', 'claude-haiku-4-5-20251001');
        expect(result.valid).toBe(true);
        expect(result.rejected).toHaveLength(0);
    });

    it('allows undefined/empty inputs', () => {
        expect(validateModelIds(undefined, undefined).valid).toBe(true);
        expect(validateModelIds('claude-sonnet-4-6', undefined).valid).toBe(true);
    });

    it('rejects all invalid when multiple bad', () => {
        const result = validateModelIds('gpt-4o', 'gemini-pro');
        expect(result.valid).toBe(false);
        expect(result.rejected).toEqual(['gpt-4o', 'gemini-pro']);
    });
});

describe('isAllowedModelId', () => {
    it('accepts claude- prefix', () => {
        expect(isAllowedModelId('claude-sonnet-4-6')).toBe(true);
    });

    it('rejects non-claude prefix', () => {
        expect(isAllowedModelId('gpt-4o')).toBe(false);
        expect(isAllowedModelId('glm-4.7')).toBe(false);
    });
});

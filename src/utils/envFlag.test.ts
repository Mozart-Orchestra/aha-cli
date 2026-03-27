import { describe, expect, it } from 'vitest';

import { isEnabledEnvValue } from './envFlag';

describe('isEnabledEnvValue', () => {
    it('treats true-like strings as enabled', () => {
        expect(isEnabledEnvValue('true')).toBe(true);
        expect(isEnabledEnvValue('1')).toBe(true);
        expect(isEnabledEnvValue('YES')).toBe(true);
    });

    it('treats false-like strings and missing values as disabled', () => {
        expect(isEnabledEnvValue('false')).toBe(false);
        expect(isEnabledEnvValue('0')).toBe(false);
        expect(isEnabledEnvValue(undefined)).toBe(false);
    });
});

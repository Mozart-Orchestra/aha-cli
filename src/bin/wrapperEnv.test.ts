import { describe, expect, it } from 'vitest';

import {
    detectBinaryName,
    detectEnvFile,
    resolveChildEnv,
} from '../../bin/wrapperEnv.mjs';

describe('wrapperEnv helpers', () => {
    it('detects the logical binary name and strips the mcp suffix', () => {
        expect(detectBinaryName('/tmp/bin/aha-v6-mcp')).toBe('aha-v6');
        expect(detectBinaryName('/tmp/bin/aha-v5')).toBe('aha-v5');
    });

    it('uses the env file that matches the invoked binary name', () => {
        const envFile = detectEnvFile({
            binaryName: 'aha-v6',
            projectRoot: '/repo',
            exists: (candidate: string) => candidate === '/repo/.env.aha-v6',
        });

        expect(envFile).toBe('/repo/.env.aha-v6');
    });

    it('passes through shell env without adding extra wrapper config', () => {
        const resolved = resolveChildEnv({
            currentEnv: {
                AHA_SERVER_URL: 'http://127.0.0.1:3005',
                DEBUG: '0',
            },
        });

        expect(resolved).toMatchObject({
            AHA_SERVER_URL: 'http://127.0.0.1:3005',
            DEBUG: '0',
        });
    });

    it('does not inject implicit localhost defaults', () => {
        const resolved = resolveChildEnv({
            currentEnv: {},
        });

        expect(resolved).toEqual({});
    });
});

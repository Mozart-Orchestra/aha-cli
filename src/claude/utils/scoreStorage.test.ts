import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getScoreStorageInfo, resolveScoreStoragePaths } from './scoreStorage';

function makeTmpDir(): string {
    const dir = join(tmpdir(), `score-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe('scoreStorage path resolution', () => {
    it('returns canonical, legacy-home, and legacy-working-directory paths', () => {
        const paths = resolveScoreStoragePaths({
            ahaHomeDir: '/tmp/aha-v3-home',
            homeDir: '/tmp/home',
            cwd: '/tmp/project',
        });

        expect(paths.canonicalPath).toBe('/tmp/aha-v3-home/scores/agent_scores.json');
        expect(paths.legacyHomePath).toBe('/tmp/home/.aha/scores/agent_scores.json');
        expect(paths.legacyWorkingDirectoryPath).toBe('/tmp/project/.aha/scores/agent_scores.json');
        expect(paths.readablePaths).toEqual([
            '/tmp/aha-v3-home/scores/agent_scores.json',
            '/tmp/home/.aha/scores/agent_scores.json',
            '/tmp/project/.aha/scores/agent_scores.json',
        ]);
    });

    it('dedupes overlapping canonical and legacy paths', () => {
        const paths = resolveScoreStoragePaths({
            ahaHomeDir: '/tmp/home/.aha',
            homeDir: '/tmp/home',
            cwd: '/tmp/project',
        });

        expect(paths.readablePaths).toEqual([
            '/tmp/home/.aha/scores/agent_scores.json',
            '/tmp/project/.aha/scores/agent_scores.json',
        ]);
    });

    it('reports only score files that currently exist', () => {
        const root = makeTmpDir();
        const canonicalHome = join(root, '.aha-v3');
        const legacyHomeRoot = join(root, 'home');
        const cwd = join(root, 'project');

        const canonicalPath = join(canonicalHome, 'scores', 'agent_scores.json');
        const legacyPath = join(legacyHomeRoot, '.aha', 'scores', 'agent_scores.json');

        mkdirSync(join(canonicalHome, 'scores'), { recursive: true });
        mkdirSync(join(legacyHomeRoot, '.aha', 'scores'), { recursive: true });
        mkdirSync(join(cwd, '.aha', 'scores'), { recursive: true });

        writeFileSync(canonicalPath, '{"version":"1.0","scores":[]}', 'utf-8');
        writeFileSync(legacyPath, '{"version":"1.0","scores":[]}', 'utf-8');

        const info = getScoreStorageInfo({
            ahaHomeDir: canonicalHome,
            homeDir: legacyHomeRoot,
            cwd,
        });

        expect(info.existingPaths).toEqual([canonicalPath, legacyPath]);

        rmSync(root, { recursive: true, force: true });
    });
});

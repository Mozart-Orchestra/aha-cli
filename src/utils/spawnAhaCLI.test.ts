import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSpawn, mockExistsSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(() => ({ pid: 1234 })),
  mockExistsSync: vi.fn((path: string) => path.endsWith('package.json') || path.endsWith('dist/index.mjs')),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

import { spawnAhaCLI } from '@/utils/spawnAhaCLI';

describe('spawnAhaCLI', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockSpawn.mockClear();
    mockExistsSync.mockClear();
    mockExistsSync.mockImplementation((path: string) => path.endsWith('package.json') || path.endsWith('dist/index.mjs'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    delete process.env.AHA_ALLOW_SOURCE_FALLBACK;
  });

  it('hides spawned windows by default on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    spawnAhaCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '--no-warnings',
        '--no-deprecation',
        expect.stringMatching(/dist[\\/]index\.mjs$/),
        'daemon',
        'start-sync',
      ],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }),
    );
  });

  it('preserves an explicit windowsHide override', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    spawnAhaCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '--no-warnings',
        '--no-deprecation',
        expect.stringMatching(/dist[\\/]index\.mjs$/),
        'daemon',
        'start-sync',
      ],
      expect.objectContaining({
        windowsHide: false,
      }),
    );
  });

  it('does not inject windowsHide on non-Windows platforms for non-daemon commands', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    spawnAhaCLI(['--version'], {
      stdio: 'pipe',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '--no-warnings',
        '--no-deprecation',
        expect.stringMatching(/dist[\\/]index\.mjs$/),
        '--version',
      ],
      expect.not.objectContaining({
        windowsHide: true,
      }),
    );
  });

  it('uses explicit source fallback only in dev mode for non-daemon commands', () => {
    process.env.AHA_ALLOW_SOURCE_FALLBACK = '1';
    mockExistsSync.mockImplementation((path: string) => (
      path.endsWith('package.json') ||
      path.endsWith('node_modules/tsx/dist/cli.mjs') ||
      path.endsWith('src/index.ts')
    ));

    spawnAhaCLI(['--version'], {
      stdio: 'pipe',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '--no-warnings',
        '--no-deprecation',
        expect.stringMatching(/node_modules[\\/]tsx[\\/]dist[\\/]cli\.mjs$/),
        expect.stringMatching(/src[\\/]index\.ts$/),
        '--version',
      ],
      expect.objectContaining({
        stdio: 'pipe',
      }),
    );
  });

  it('uses launchctl for detached daemon starts on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    spawnAhaCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      cwd: '/tmp/aha-test',
      env: {
        PATH: '/opt/homebrew/bin:/usr/bin',
        HOME: '/Users/tester',
        AHA_SERVER_URL: 'https://ahaagi.com/api',
        DEBUG: '1',
      },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'launchctl',
      [
        'submit',
        '-l',
        expect.stringMatching(/^com\.aha\.daemon\./),
        '--',
        '/bin/sh',
        '-lc',
        expect.stringContaining("export AHA_SERVER_URL='https://ahaagi.com/api'"),
      ],
      expect.objectContaining({
        detached: false,
        stdio: 'ignore',
      }),
    );
  });

  it('uses a detached launcher helper for daemon starts on non-mac Unix', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    spawnAhaCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      cwd: '/srv/aha',
      env: {
        AHA_SERVER_URL: 'https://ahaagi.com/api',
        PATH: '/usr/bin',
      },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '-e',
        expect.stringContaining('"AHA_SERVER_URL":"https://ahaagi.com/api"'),
      ],
      expect.objectContaining({
        detached: false,
        stdio: 'ignore',
      }),
    );
  });
});

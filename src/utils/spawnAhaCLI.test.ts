import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(() => ({ pid: 1234 })),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
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
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('hides spawned windows by default on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    spawnAhaCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'aha',
      ['daemon', 'start-sync'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        shell: true,
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
      'aha',
      ['daemon', 'start-sync'],
      expect.objectContaining({
        shell: true,
        windowsHide: false,
      }),
    );
  });

  it('does not inject windowsHide on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    spawnAhaCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'aha',
      ['daemon', 'start-sync'],
      expect.not.objectContaining({
        windowsHide: true,
      }),
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'aha',
      ['daemon', 'start-sync'],
      expect.objectContaining({
        shell: false,
      }),
    );
  });
});

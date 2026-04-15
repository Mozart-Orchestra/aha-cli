import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadDaemonState,
  mockReadDaemonStateRaw,
  mockClearDaemonState,
  mockReadFileSync,
  mockStatSync,
  mockSpawnAhaCLI,
} = vi.hoisted(() => ({
  mockReadDaemonState: vi.fn(),
  mockReadDaemonStateRaw: vi.fn(),
  mockClearDaemonState: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockSpawnAhaCLI: vi.fn(),
}));

vi.mock('@/persistence', () => ({
  readDaemonState: mockReadDaemonState,
  readDaemonStateRaw: mockReadDaemonStateRaw,
  clearDaemonState: mockClearDaemonState,
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  statSync: mockStatSync,
}));

vi.mock('@/configuration', () => ({
  configuration: {
    daemonLockFile: '/tmp/aha-daemon.lock',
  },
}));

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

vi.mock('@/projectPath', () => ({
  projectPath: vi.fn(() => '/tmp/aha'),
}));

vi.mock('@/utils/spawnAhaCLI', () => ({
  spawnAhaCLI: mockSpawnAhaCLI,
}));

vi.mock('@/utils/sessionScopedAhaEnv', () => ({
  stripSessionScopedAhaEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
}));

import { checkIfDaemonRunningAndCleanupStaleState, startDaemonDetached } from '@/daemon/controlClient';

describe('checkIfDaemonRunningAndCleanupStaleState', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockReadDaemonState.mockReset();
    mockReadDaemonStateRaw.mockReset();
    mockClearDaemonState.mockReset();
    mockReadFileSync.mockReset();
    mockStatSync.mockReset();
    mockSpawnAhaCLI.mockReset();

    mockReadDaemonState.mockResolvedValue(null);
    mockReadDaemonStateRaw.mockResolvedValue(null);
    mockClearDaemonState.mockResolvedValue(undefined);
    mockReadFileSync.mockReturnValue('42424');
    mockSpawnAhaCLI.mockReturnValue({ exitCode: 0, unref: vi.fn() });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    delete process.env.AHA_DAEMON_START_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  it('does not kill a freshly locked daemon that is still starting', async () => {
    mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 500 });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 42424 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);

    const running = await checkIfDaemonRunningAndCleanupStaleState();

    expect(running).toBe(false);
    expect(mockClearDaemonState).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalledWith(42424, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(42424, 'SIGKILL');
  });

  it('cleans up an old live lock that never produced daemon state', async () => {
    mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 20_000 });

    let alive = true;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid !== 42424) {
        return true;
      }

      if (signal === 0) {
        if (alive) {
          return true;
        }
        throw new Error('ESRCH');
      }

      if (signal === 'SIGTERM') {
        alive = false;
        return true;
      }

      return true;
    }) as typeof process.kill);

    const running = await checkIfDaemonRunningAndCleanupStaleState();

    expect(running).toBe(false);
    expect(killSpy).toHaveBeenCalledWith(42424, 'SIGTERM');
    expect(mockClearDaemonState).toHaveBeenCalledTimes(1);
  });

  it('treats launchctl acceptance as success on macOS even before state appears', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.AHA_DAEMON_START_TIMEOUT_MS = '1';
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const started = await startDaemonDetached();

    expect(started).toBe(true);
    expect(mockSpawnAhaCLI).toHaveBeenCalledTimes(1);
  });
});

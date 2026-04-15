/**
 * Cross-platform Aha CLI spawning utility
 *
 * Spawns the `aha` command from PATH. The npm-installed `bin/aha.js` wrapper
 * handles all platform-specific details: locating `dist/index.mjs`, setting
 * Node flags, and Windows compatibility.
 *
 * This approach works correctly regardless of where aha-agi is installed
 * on the host machine — global npm, local node_modules, or any custom prefix.
 */

import { spawn, SpawnOptions, type ChildProcess } from 'child_process';
import { logger } from '@/ui/logger';
import { withWindowsHide } from '@/utils/windowsProcessOptions';

/**
 * Spawn the Aha CLI with the given arguments in a cross-platform way.
 *
 * @param args - Arguments to pass to the Aha CLI
 * @param options - Spawn options (same as child_process.spawn)
 * @returns ChildProcess instance
 */
export function spawnAhaCLI(args: string[], options: SpawnOptions = {}): ChildProcess {
  const directory = 'cwd' in options ? options.cwd : process.cwd();
  const fullCommand = `aha ${args.join(' ')}`;
  logger.debug(`[SPAWN AHA CLI] Spawning: ${fullCommand} in ${directory}`);

  const spawnOptions: SpawnOptions = withWindowsHide({
    shell: process.platform === 'win32',
    ...options
  });

  return spawn('aha', args, spawnOptions);
}

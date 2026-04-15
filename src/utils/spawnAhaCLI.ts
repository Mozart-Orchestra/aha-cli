/**
 * Cross-platform Aha CLI spawning utility.
 *
 * Important: this intentionally bypasses the published `bin/aha.js` wrapper.
 * The wrapper uses `execFileSync(...)`, which is fine for foreground CLI use
 * but breaks detached daemon startup because the spawned wrapper process keeps
 * a foreground child attached beneath it.
 *
 * Instead, we resolve the currently running package root and launch this exact
 * installation's `dist/index.mjs` directly with Node.js. That keeps daemon
 * startup stable for:
 * - global installs
 * - local `node_modules` installs
 * - `npm i aha-agi && npx aha ...` flows
 */

import { spawn, SpawnOptions, type ChildProcess } from 'child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@/ui/logger';
import { withWindowsHide } from '@/utils/windowsProcessOptions';

function resolveCurrentPackageRoot(): string {
  let currentDir = dirname(fileURLToPath(import.meta.url));

  while (true) {
    const packageJsonPath = join(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Failed to resolve aha-agi package root from ${import.meta.url}`);
    }
    currentDir = parentDir;
  }
}

function resolveCurrentEntrypoint(): string[] {
  const packageRoot = resolveCurrentPackageRoot();
  const distEntrypoint = join(packageRoot, 'dist', 'index.mjs');
  if (existsSync(distEntrypoint)) {
    return ['--no-warnings', '--no-deprecation', distEntrypoint];
  }

  const allowSourceFallback = process.env.AHA_ALLOW_SOURCE_FALLBACK === '1';
  const tsxEntrypoint = join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const sourceEntrypoint = join(packageRoot, 'src', 'index.ts');
  if (allowSourceFallback && existsSync(tsxEntrypoint) && existsSync(sourceEntrypoint)) {
    logger.debug(`[SPAWN AHA CLI] Using source fallback via tsx: ${sourceEntrypoint}`);
    return ['--no-warnings', '--no-deprecation', tsxEntrypoint, sourceEntrypoint];
  }

  const fallbackHint = allowSourceFallback
    ? ''
    : ` To intentionally use source fallback in dev, set AHA_ALLOW_SOURCE_FALLBACK=1.`;
  throw new Error(`Entrypoint ${distEntrypoint} does not exist.${fallbackHint}`);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveSpawnDirectory(directory: string | URL | undefined): string | undefined {
  if (!directory) {
    return undefined;
  }
  return typeof directory === 'string' ? directory : fileURLToPath(directory);
}

function serializeEnvForShell(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `export ${key}=${shellEscape(value as string)}`);
}

/**
 * Spawn the Aha CLI with the given arguments in a cross-platform way.
 *
 * @param args - Arguments to pass to the Aha CLI
 * @param options - Spawn options (same as child_process.spawn)
 * @returns ChildProcess instance
 */
export function spawnAhaCLI(args: string[], options: SpawnOptions = {}): ChildProcess {
  const directory = resolveSpawnDirectory('cwd' in options ? options.cwd : process.cwd());
  const fullCommand = `aha ${args.join(' ')}`;
  logger.debug(`[SPAWN AHA CLI] Spawning: ${fullCommand} in ${directory}`);

  const nodeArgs = [...resolveCurrentEntrypoint(), ...args];

  const isDetachedDaemonStart =
    args[0] === 'daemon' &&
    (args[1] === 'start' || args[1] === 'start-sync') &&
    options.detached === true;

  if (process.platform === 'darwin' && isDetachedDaemonStart) {
    const env = options.env ?? process.env;
    const exportedEnv = serializeEnvForShell(env);

    const launchLabel = `com.aha.daemon.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const innerCommand = [
      ...exportedEnv,
      directory ? `cd ${shellEscape(directory)}` : '',
      `exec ${shellEscape(process.execPath)} ${nodeArgs.map(shellEscape).join(' ')}`,
    ].filter(Boolean).join('; ');

    logger.debug(`[SPAWN AHA CLI] Using launchctl daemon bootstrap: ${launchLabel}`);

    const spawnOptions: SpawnOptions = withWindowsHide({
      ...options,
      detached: false,
      stdio: 'ignore',
    });

    return spawn('launchctl', [
      'submit',
      '-l',
      launchLabel,
      '--',
      '/bin/sh',
      '-lc',
      innerCommand,
    ], spawnOptions);
  }

  if (process.platform !== 'win32' && isDetachedDaemonStart) {
    const childEnv = options.env ?? process.env;
    const launcherScript = `
      const { spawn } = require('child_process');
      const ignore = () => {};
      process.on('SIGTERM', ignore);
      process.on('SIGHUP', ignore);
      process.on('SIGINT', ignore);
      const child = spawn(process.execPath, ${JSON.stringify(nodeArgs)}, {
        cwd: ${JSON.stringify(directory)},
        env: ${JSON.stringify(childEnv)},
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      setTimeout(() => process.exit(0), 5000);
    `.trim();

    logger.debug('[SPAWN AHA CLI] Using detached daemon launcher helper');

    const spawnOptions: SpawnOptions = withWindowsHide({
      ...options,
      detached: false,
    });

    return spawn(process.execPath, ['-e', launcherScript], spawnOptions);
  }

  const spawnOptions: SpawnOptions = withWindowsHide({
    ...options
  });

  return spawn(process.execPath, nodeArgs, spawnOptions);
}

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

import { execSync, spawn, SpawnOptions, type ChildProcess } from 'child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@/ui/logger';
import { withWindowsHide } from '@/utils/windowsProcessOptions';

/**
 * Resolve the aha-agi package root by walking up from `import.meta.url`
 * to find the nearest `package.json`.
 */
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

/**
 * When `import.meta.url` points to a deleted path (e.g. node_modules cleared
 * while daemon is running), fall back to locating `aha` via PATH and resolving
 * its package root from there.
 */
function resolveFallbackPackageRoot(): string | null {
  try {
    const ahaPath = execSync('which aha 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (!ahaPath) return null;

    // Resolve symlinks: global installs typically have
    //   /opt/homebrew/bin/aha → ../lib/node_modules/aha-agi/bin/aha.mjs
    const realPath = realpathSync(ahaPath);
    // Real layout: <prefix>/lib/node_modules/aha-agi/bin/aha.mjs
    // Package root is one dirname up from bin/
    const pkgRoot = dirname(dirname(realPath));
    const distEntrypoint = join(pkgRoot, 'dist', 'index.mjs');
    return existsSync(distEntrypoint) ? pkgRoot : null;
  } catch {
    return null;
  }
}

function resolveCurrentEntrypoint(): string[] {
  let packageRoot: string | null = null;
  try {
    packageRoot = resolveCurrentPackageRoot();
  } catch {
    // import.meta.url path may be entirely gone (node_modules cleared)
  }

  if (packageRoot) {
    const distEntrypoint = join(packageRoot, 'dist', 'index.mjs');
    if (existsSync(distEntrypoint)) {
      return ['--no-warnings', '--no-deprecation', distEntrypoint];
    }
  }

  // import.meta.url path no longer exists on disk — try PATH fallback
  const fallbackRoot = resolveFallbackPackageRoot();
  if (fallbackRoot) {
    const fallbackEntrypoint = join(fallbackRoot, 'dist', 'index.mjs');
    logger.debug(`[SPAWN AHA CLI] import.meta.url path gone; falling back to PATH-resolved: ${fallbackEntrypoint}`);
    return ['--no-warnings', '--no-deprecation', fallbackEntrypoint];
  }

  const allowSourceFallback = process.env.AHA_ALLOW_SOURCE_FALLBACK === '1';
  if (allowSourceFallback && packageRoot) {
    const tsxEntrypoint = join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const sourceEntrypoint = join(packageRoot, 'src', 'index.ts');
    if (existsSync(tsxEntrypoint) && existsSync(sourceEntrypoint)) {
      logger.debug(`[SPAWN AHA CLI] Using source fallback via tsx: ${sourceEntrypoint}`);
      return ['--no-warnings', '--no-deprecation', tsxEntrypoint, sourceEntrypoint];
    }
  }

  const fallbackHint = allowSourceFallback
    ? ''
    : ` To intentionally use source fallback in dev, set AHA_ALLOW_SOURCE_FALLBACK=1.`;
  throw new Error(`Entrypoint ${packageRoot ? join(packageRoot, 'dist', 'index.mjs') : 'unresolved'} does not exist.${fallbackHint}`);
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

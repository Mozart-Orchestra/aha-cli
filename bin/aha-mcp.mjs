#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import {
  detectBinaryName,
  detectEnvFile,
  resolveChildEnv,
} from './wrapperEnv.mjs';

// Ensure Node flags to reduce noisy warnings on stdout (which could interfere with MCP)
const hasNoWarnings = process.execArgv.includes('--no-warnings');
const hasNoDeprecation = process.execArgv.includes('--no-deprecation');

if (!hasNoWarnings || !hasNoDeprecation) {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const entrypoint = join(projectRoot, 'dist', 'codex', 'ahaMcpStdioBridge.mjs');
  let envFile = null;
  let env = process.env;

  try {
    const binaryName = detectBinaryName(process.argv[1] || process.execPath);
    envFile = detectEnvFile({
      binaryName,
      projectRoot,
    });
    env = resolveChildEnv({
      currentEnv: process.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[aha-mcp] ${message}`);
    process.exit(1);
  }

  try {
    const nodeArgs = [
      '--no-warnings',
      '--no-deprecation',
    ];

    if (envFile) {
      nodeArgs.push('--env-file', envFile);
    }

    nodeArgs.push(entrypoint, ...process.argv.slice(2));

    execFileSync(process.execPath, nodeArgs, {
      stdio: 'inherit',
      env,
    });
  } catch (error) {
    process.exit(error.status || 1);
  }
} else {
  // Already have desired flags; import module directly
  import('../dist/codex/ahaMcpStdioBridge.mjs');
}

import { existsSync } from 'fs';
import { join } from 'path';

export function detectBinaryName(execPath) {
  const normalizedExecPath = execPath || process.execPath;
  const segments = normalizedExecPath.split(/[\\/]/);
  const name = segments[segments.length - 1] || 'aha-v3';
  return name.replace('-mcp', '');
}

export function resolveChildEnv({
  currentEnv = process.env,
}) {
  return {
    ...currentEnv,
  };
}

export function detectEnvFile({
  binaryName,
  projectRoot,
  exists = existsSync,
}) {
  const candidate = join(projectRoot, `.env.${binaryName}`);
  return exists(candidate) ? candidate : null;
}

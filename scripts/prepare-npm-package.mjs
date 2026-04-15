#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { resolvePublishProtectionPolicy } from './lib/npmPublishProtection.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const policy = resolvePublishProtectionPolicy(process.env);

// ============================================================================
// Configurable package name support
// ============================================================================
const CLI_PACKAGE_NAME = process.env.CLI_PACKAGE_NAME?.trim() || 'aha-agi';
const CLI_BIN_NAME = process.env.CLI_BIN_NAME?.trim() || 'aha';
const CLI_BIN_MCP_NAME = process.env.CLI_BIN_MCP_NAME?.trim() || 'aha-mcp';

async function applyPackageNameOverrides() {
  const pkgJsonPath = path.join(repoRoot, 'package.json');
  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));

  let modified = false;

  if (pkgJson.name !== CLI_PACKAGE_NAME) {
    console.log(`[prepare-npm-package] Overriding package name: ${pkgJson.name} -> ${CLI_PACKAGE_NAME}`);
    pkgJson.name = CLI_PACKAGE_NAME;
    modified = true;
  }

  if (pkgJson.bin) {
    const oldBins = Object.keys(pkgJson.bin);
    const newBins = {
      [CLI_BIN_NAME]: pkgJson.bin[oldBins[0]] || 'bin/aha.js',
      [CLI_BIN_MCP_NAME]: pkgJson.bin[oldBins[1]] || 'bin/aha-mcp.js',
    };

    if (JSON.stringify(pkgJson.bin) !== JSON.stringify(newBins)) {
      console.log(`[prepare-npm-package] Overriding bin commands: ${JSON.stringify(Object.keys(pkgJson.bin))} -> ${JSON.stringify(Object.keys(newBins))}`);
      pkgJson.bin = newBins;
      modified = true;
    }
  }

  if (modified) {
    await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
    console.log(`[prepare-npm-package] Package name overrides applied: ${CLI_PACKAGE_NAME}`);
  }

  return { packageName: CLI_PACKAGE_NAME, binName: CLI_BIN_NAME, binMcpName: CLI_BIN_MCP_NAME };
}

// Apply package name overrides before publish protection
const nameConfig = await applyPackageNameOverrides();

// ============================================================================
// Publish protection
// ============================================================================
if (!policy.enabled) {
  console.log('[prepare-npm-package] Publish protection disabled via AHA_NPM_PUBLISH_ENCRYPTION');
  process.exit(0);
}

await import(path.join(repoRoot, 'scripts', 'obfuscate-dist.mjs'));
console.log(`[prepare-npm-package] Publish protection mode applied: ${policy.mode}`);
console.log(`[prepare-npm-package] Final package: ${nameConfig.packageName} (bin: ${nameConfig.binName}, ${nameConfig.binMcpName})`);

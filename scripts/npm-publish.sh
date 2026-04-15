#!/bin/bash
#
# Configurable npm package publish script for aha-agi
#
# Usage:
#   ./scripts/npm-publish.sh                    # Publish as aha-agi (default)
#   CLI_PACKAGE_NAME=mycli ./scripts/npm-publish.sh  # Publish as mycli
#   CLI_BIN_NAME=mycmd ./scripts/npm-publish.sh     # Publish with custom bin name
#
# Environment variables:
#   CLI_PACKAGE_NAME  - Package name (default: aha-agi)
#   CLI_BIN_NAME      - Main command name (default: aha)
#   CLI_BIN_MCP_NAME  - MCP command name (default: aha-mcp)
#   NPM_REGISTRY      - npm registry (default: https://registry.npmjs.org)
#   NPM_TAG           - Publish tag (default: latest)
#

set -e

# Default values
CLI_PACKAGE_NAME="${CLI_PACKAGE_NAME:-aha-agi}"
CLI_BIN_NAME="${CLI_BIN_NAME:-aha}"
CLI_BIN_MCP_NAME="${CLI_BIN_MCP_NAME:-aha-mcp}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
NPM_TAG="${NPM_TAG:-latest}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "=========================================="
echo "Publishing npm package"
echo "=========================================="
echo "Package name:    $CLI_PACKAGE_NAME"
echo "Bin command:     $CLI_BIN_NAME"
echo "MCP command:     $CLI_BIN_MCP_NAME"
echo "Registry:        $NPM_REGISTRY"
echo "Tag:             $NPM_TAG"
echo "=========================================="

# Verify npm auth
if ! npm whoami --registry "$NPM_REGISTRY" >/dev/null 2>&1; then
  echo "Error: Not authenticated to npm registry $NPM_REGISTRY"
  echo "Run: npm login --registry $NPM_REGISTRY"
  exit 1
fi

# Check if package name is already taken
if npm view "$CLI_PACKAGE_NAME" --registry "$NPM_REGISTRY" >/dev/null 2>&1; then
  echo "Warning: Package '$CLI_PACKAGE_NAME' already exists on npm"
  read -p "Continue with publish? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted"
    exit 1
  fi
fi

# Export env vars for prepack script
export CLI_PACKAGE_NAME
export CLI_BIN_NAME
export CLI_BIN_MCP_NAME

# Build
echo "Building package..."
npm run build

# Pack (dry run)
echo "Packing package (dry run)..."
npm pack --dry-run --json | jq '.[0].files | length' | xargs echo "Files included:"

# Confirm publish
echo ""
read -p "Publish $CLI_PACKAGE_NAME to $NPM_REGISTRY? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted"
  exit 1
fi

# Publish
echo "Publishing..."
npm publish \
  --registry "$NPM_REGISTRY" \
  --tag "$NPM_TAG" \
  --access public

echo ""
echo "✓ Published $CLI_PACKAGE_NAME@$NPM_TAG"
echo ""
echo "Install with:"
echo "  npm install -g $CLI_PACKAGE_NAME"
echo ""
echo "Or use with npx:"
echo "  npx $CLI_PACKAGE_NAME"

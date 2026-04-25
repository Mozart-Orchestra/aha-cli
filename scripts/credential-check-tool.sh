#!/usr/bin/env bash
# credential-check-tool.sh — Claude Code PreToolUse hook
# SO-PDCA-001: Intercepts send_team_message / Write / Edit to block plaintext credentials.
#
# Claude Code hook protocol:
#   - stdin: JSON { "tool_name": "...", "tool_input": { ... } }
#   - exit 0 = allow tool call
#   - exit 2 = deny tool call (stderr shown to user)
#
# Install in .claude/settings.json:
#   "hooks": {
#     "preToolUse": [{
#       "matcher": "send_team_message|Write|Edit",
#       "command": "scripts/credential-check-tool.sh",
#       "description": "Block plaintext credentials in tool calls"
#     }]
#   }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read tool call from stdin
INPUT="$(cat)"

# Extract the tool name
TOOL_NAME="$(echo "$INPUT" | grep -oE '"tool_name"\s*:\s*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')"

# Only check tools that can contain credentials
case "$TOOL_NAME" in
    send_team_message)
        # Check the 'content' field
        PAYLOAD="$(echo "$INPUT" | grep -oE '"content"\s*:\s*"[^"]*"' | sed 's/.*:.*"\([^"]*\)".*/\1/')"
        ;;
    Write)
        # Check the 'content' field
        PAYLOAD="$(echo "$INPUT" | grep -oE '"content"\s*:\s*"[^"]*"' | sed 's/.*:.*"\([^"]*\)".*/\1/')"
        ;;
    Edit)
        # Check 'old_string' and 'new_string' fields
        PAYLOAD="$(echo "$INPUT" | grep -oE '"(old_string|new_string)"\s*:\s*"[^"]*"' | sed 's/.*:.*"\([^"]*\)".*/\1/')"
        ;;
    *)
        # Unknown tool — allow
        exit 0
        ;;
esac

# If no payload extracted, allow (malformed input is not our concern)
if [[ -z "$PAYLOAD" ]]; then
    exit 0
fi

# Scan for credentials
MATCHES="$(echo "$PAYLOAD" | bash "$SCRIPT_DIR/credential-scan.sh" 2>/dev/null || true)"

if [[ -n "$MATCHES" ]]; then
    echo "BLOCKED: Plaintext credential detected in $TOOL_NAME call." >&2
    echo "Credential types found:" >&2
    echo "$MATCHES" | while IFS=: read -r _ name _; do
        echo "  - $name" >&2
    done
    echo "" >&2
    echo "Action required: Store credentials in settings.json or environment variables." >&2
    echo "Never send credentials via team chat or write them to source files." >&2
    exit 2
fi

exit 0

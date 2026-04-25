#!/usr/bin/env bash
# credential-scan.sh — Shared credential pattern scanner
# SO-PDCA-001: Detects plaintext credentials in text input.
#
# Usage:
#   source credential-scan.sh
#   echo "$text" | scan_credentials
#
# Exit codes:
#   0 = clean (no credentials found)
#   1 = credentials detected (details on stdout)

set -euo pipefail

# ── Credential patterns ─────────────────────────────────────────────────────────
# Each pattern: name<tab>regex
CREDENTIAL_PATTERNS=(
    "ssh-private-key|-----BEGIN OPENSSH PRIVATE KEY-----"
    "ssh-public-key|ssh-(rsa|ed25519|ecdsa) [A-Za-z0-9+/=]+"
    "anthropic-api-key|sk-(proj-)?[A-Za-z0-9_-]{30,}"
    "aws-access-key|AKIA[0-9A-Z]{16}"
    "github-token|ghp_[A-Za-z0-9]{36}"
    "supabase-jwt|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\."
    "password-assignment|(password|passwd|pwd)\s*[:=]\s*[\"']?[^[:space:]\"']{8,}"
    "supabase-anon-key|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJ[A-Za-z0-9_-]+"
)

# ── Scanner function ────────────────────────────────────────────────────────────
# Reads from stdin, returns 0 if clean, 1 if credentials found.
# On match, prints: "MATCH:<pattern-name>:<matched-line>" to stdout.
scan_credentials() {
    local input
    input="$(cat)"
    local found=0

    for entry in "${CREDENTIAL_PATTERNS[@]}"; do
        local name="${entry%%|*}"
        local pattern="${entry#*|}"

        if echo "$input" | grep -qE -e "$pattern" 2>/dev/null; then
            local match_line
            match_line="$(echo "$input" | grep -E -e "$pattern" | head -1 | cut -c1-80)"
            echo "MATCH:${name}:${match_line}"
            found=1
        fi
    done

    return $found
}

# ── Direct execution mode ───────────────────────────────────────────────────────
# If run directly (not sourced), scan stdin or file arguments.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ $# -gt 0 ]]; then
        cat "$@"
    else
        cat
    fi | scan_credentials
    exit $?
fi

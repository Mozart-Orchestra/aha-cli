#!/usr/bin/env bash
# test-credential-scan.sh — Unit tests for credential-scan.sh
# SO-PDCA-001: Verifies all 4+ credential pattern types are detected.
#
# Run: bash scripts/test-credential-scan.sh
# Exit: 0 = all pass, 1 = any fail

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_SCRIPT="$SCRIPT_DIR/credential-scan.sh"

PASS=0
FAIL=0

assert_match() {
    local label="$1"
    local input="$2"
    local result
    result="$(echo "$input" | bash "$SCAN_SCRIPT" 2>/dev/null)" || true

    if [[ -n "$result" ]]; then
        echo "  PASS: $label"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $label — expected match but got none"
        FAIL=$((FAIL + 1))
    fi
}

assert_no_match() {
    local label="$1"
    local input="$2"
    local result
    result="$(echo "$input" | bash "$SCAN_SCRIPT" 2>/dev/null)" || true

    if [[ -z "$result" ]]; then
        echo "  PASS: $label"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $label — expected no match but got: $result"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== SO-PDCA-001 Credential Pattern Tests ==="
echo ""

echo "--- SSH Private Key ---"
assert_match "OpenSSH private key" "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAA"
assert_no_match "Normal text with BEGIN" "-----BEGIN CERTIFICATE-----"

echo ""
echo "--- SSH Public Key ---"
assert_match "ssh-rsa public key" "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7 user@host"
assert_match "ssh-ed25519 public key" "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIxyz user@host"
assert_no_match "ssh in prose" "I use ssh to connect to servers"

echo ""
echo "--- API Tokens ---"
assert_match "Anthropic API key (project)" "sk-proj-abc123def456ghi789jkl012mno345pqr678stu"
assert_match "Anthropic API key (simple)" "sk-ant-api03-abcdefghijklmnopqrstuvwx"
assert_match "AWS access key" "AKIAIOSFODNN7EXAMPLE"
assert_match "GitHub token" "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
assert_no_match "Short API prefix" "sk-abc"
assert_no_match "Normal text with sk" "skill level is high"

echo ""
echo "--- Supabase JWT ---"
assert_match "Supabase anon key (JWT)" "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlZ3BkY2ZzcWNmb3dnd2twYW5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODM3MDcsImV4cCI6MjA5MDQ1OTcwN30.4Y2QD5oTjze_QxEAeTBPUYTbOhhCeCr-LRVyJoiIK64"
assert_no_match "Normal base64" "eyJzb21lIG5vcm1hbCBkYXRh"

echo ""
echo "--- Password Assignment ---"
assert_match "password with equals" "password=SuperSecret123"
assert_match "passwd with colon" "passwd: \"MySecretPwd\""
assert_match "pwd with equals" "pwd = 'longpassword'"
assert_no_match "Short password" "pwd=abc"
assert_no_match "Password in prose" "please enter your password to continue"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
exit 0

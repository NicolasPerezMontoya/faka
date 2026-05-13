#!/usr/bin/env bash
# Cross-service smoke test for the faka stack.
#
# Usage:
#   bash scripts/smoke.sh <dashboard-url> <orchestrator-url>
#
# Example:
#   bash scripts/smoke.sh \
#     https://dashboard-preview.vercel.app \
#     https://orchestrator-staging.up.railway.app
#
# Exits 0 if both /health endpoints + /connectors return expected JSON.
# Exits 1 on any HTTP error or shape mismatch.

set -euo pipefail

DASHBOARD_URL="${1:-}"
ORCHESTRATOR_URL="${2:-}"

if [ -z "$DASHBOARD_URL" ] || [ -z "$ORCHESTRATOR_URL" ]; then
  echo "Usage: bash scripts/smoke.sh <dashboard-url> <orchestrator-url>"
  exit 1
fi

# Strip trailing slashes for consistency.
DASHBOARD_URL="${DASHBOARD_URL%/}"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL%/}"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() {
  echo -e "  ${RED}✗${NC} $1"
  exit 1
}

echo "→ Dashboard health: $DASHBOARD_URL/api/health"
DASHBOARD_BODY=$(curl -fsSL --max-time 10 "$DASHBOARD_URL/api/health") || fail "dashboard /api/health unreachable"
echo "$DASHBOARD_BODY" | grep -q '"ok":true' || fail "dashboard /api/health did not return ok:true"
echo "$DASHBOARD_BODY" | grep -q '"service":"faka-dashboard"' || fail "dashboard /api/health service mismatch"
pass "dashboard /api/health returned ok:true"

echo "→ Orchestrator health: $ORCHESTRATOR_URL/health"
ORCH_BODY=$(curl -fsSL --max-time 10 "$ORCHESTRATOR_URL/health") || fail "orchestrator /health unreachable"
echo "$ORCH_BODY" | grep -q '"ok":true' || fail "orchestrator /health did not return ok:true"
echo "$ORCH_BODY" | grep -q '"service":"faka-orchestrator"' || fail "orchestrator /health service mismatch"
pass "orchestrator /health returned ok:true"

echo "→ Orchestrator connectors: $ORCHESTRATOR_URL/connectors"
CONN_BODY=$(curl -fsSL --max-time 10 "$ORCHESTRATOR_URL/connectors") || fail "orchestrator /connectors unreachable"
echo "$CONN_BODY" | grep -q '"connectors"' || fail "orchestrator /connectors missing 'connectors' key"
# CSV connector should be ok:true; everything else should be ok:false in F1.
echo "$CONN_BODY" | grep -q '"canal":"csv-upload"' || fail "csv-upload missing from registry"
pass "orchestrator /connectors lists registry"

echo
echo "Smoke test passed."
exit 0

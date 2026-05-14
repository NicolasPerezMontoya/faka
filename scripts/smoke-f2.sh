#!/usr/bin/env bash
# F2-specific smoke test for the faka stack — Plan 2.5.4.
#
# Extends scripts/smoke.sh (F1) with WordPress-channel + Hoy-view + matching
# queue checks. Designed to pass in BOTH (a) fully-configured staging and
# (b) degraded-mode staging where WORDPRESS_* env vars are still unset.
#
# Usage:
#   bash scripts/smoke-f2.sh <dashboard-url> <orchestrator-url>
#
# Example:
#   bash scripts/smoke-f2.sh \
#     https://dashboard-staging.vercel.app \
#     https://orchestrator-staging.up.railway.app
#
# Exit codes:
#   0  — All F1 + F2 smoke checks passed
#   1  — Hard failure (unexpected HTTP / shape mismatch)
#
# Degraded-mode behaviour (WordPress env unset on the orchestrator):
#   - /connectors lists `wordpress` with `ok:false, last_error:"not configured"`
#   - POST /webhooks/wordpress returns 503 `{error:"not_configured"}`
# Configured-mode behaviour (WordPress env set):
#   - /connectors lists `wordpress` with `ok:true`
#   - POST /webhooks/wordpress (no signature) returns 401 `invalid_signature`
# BOTH are PASS signals for this smoke (we are testing wiring, not creds).

set -euo pipefail

DASHBOARD_URL="${1:-}"
ORCHESTRATOR_URL="${2:-}"

if [ -z "$DASHBOARD_URL" ] || [ -z "$ORCHESTRATOR_URL" ]; then
  echo "Usage: bash scripts/smoke-f2.sh <dashboard-url> <orchestrator-url>"
  exit 1
fi

# Strip trailing slashes for consistency.
DASHBOARD_URL="${DASHBOARD_URL%/}"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL%/}"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() {
  echo -e "  ${RED}✗${NC} $1"
  exit 1
}

# ─── Step 0: Run the F1 baseline smoke first ──────────────────────────────────
# Anti-duplication invariant: smoke-f2.sh REUSES scripts/smoke.sh; it does NOT
# fork its own health-check logic.
echo "→ Re-running F1 baseline smoke (scripts/smoke.sh)"
SMOKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SMOKE_DIR/smoke.sh" "$DASHBOARD_URL" "$ORCHESTRATOR_URL"
echo

# ─── Step 1: WordPress connector visible in registry ──────────────────────────
echo "→ WordPress connector registry entry: $ORCHESTRATOR_URL/connectors"
CONN_BODY=$(curl -fsSL --max-time 10 "$ORCHESTRATOR_URL/connectors") || fail "/connectors unreachable"
echo "$CONN_BODY" | grep -q '"canal":"wordpress"' \
  || fail "wordpress missing from /connectors"
pass "wordpress connector present"

# Either ok:true (creds set) or ok:false + last_error matching not_configured / not configured.
if echo "$CONN_BODY" | grep -Eq '"canal":"wordpress"[^}]*"ok":true'; then
  pass "wordpress connector is HEALTHY (creds configured)"
  WP_MODE="configured"
else
  echo "$CONN_BODY" | grep -Eq '"canal":"wordpress"[^}]*"ok":false' \
    || fail "wordpress connector has unexpected shape (neither ok:true nor ok:false)"
  warn "wordpress connector is DEGRADED — env vars unset on orchestrator"
  WP_MODE="degraded"
fi

# ─── Step 2: WordPress webhook endpoint responds correctly ────────────────────
echo "→ WordPress webhook ACK path: POST $ORCHESTRATOR_URL/webhooks/wordpress (empty body, no signature)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H 'content-type: application/json' \
  --max-time 10 \
  "$ORCHESTRATOR_URL/webhooks/wordpress" \
  --data '{}' || echo "000")

if [ "$WP_MODE" = "degraded" ]; then
  [ "$HTTP_CODE" = "503" ] || fail "expected 503 not_configured in degraded mode, got $HTTP_CODE"
  pass "webhook returns 503 not_configured (degraded mode wired correctly)"
else
  # Configured: missing signature → 401 invalid_signature (per webhook route step 6)
  case "$HTTP_CODE" in
    401|400) pass "webhook returns $HTTP_CODE on unsigned probe (verify path active)" ;;
    *)       fail "expected 401/400 on unsigned probe in configured mode, got $HTTP_CODE" ;;
  esac
fi

# ─── Step 3: Dashboard /hoy renders the 4-panel shell ─────────────────────────
# We don't have a session cookie in CI; assert the route is reachable (200 or
# 307 to /login). A 5xx here means SSR is broken — block.
echo "→ Dashboard /hoy reachability: $DASHBOARD_URL/hoy"
HOY_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -L --max-time 10 --max-redirs 0 \
  "$DASHBOARD_URL/hoy" || echo "000")
case "$HOY_CODE" in
  200) pass "/hoy renders directly (200) — admin session in browser cookies probably" ;;
  302|303|307|308) pass "/hoy redirects to login ($HOY_CODE) — auth gate intact" ;;
  *) fail "/hoy returned unexpected code $HOY_CODE" ;;
esac

# ─── Step 4: Dashboard /matching renders ──────────────────────────────────────
echo "→ Dashboard /matching reachability: $DASHBOARD_URL/matching"
MATCH_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -L --max-time 10 --max-redirs 0 \
  "$DASHBOARD_URL/matching" || echo "000")
case "$MATCH_CODE" in
  200) pass "/matching renders directly (200)" ;;
  302|303|307|308) pass "/matching redirects to login ($MATCH_CODE) — auth gate intact" ;;
  *) fail "/matching returned unexpected code $MATCH_CODE" ;;
esac

# ─── Step 5: CC-12 lint — every CREATE VIEW in F2 declares security_invoker ──
echo "→ CC-12 (every F2 view declares security_invoker=true)"
REPO_ROOT="$(cd "$SMOKE_DIR/.." && pwd)"
MIG_DIR="$REPO_ROOT/packages/db/supabase/migrations"
if [ -d "$MIG_DIR" ]; then
  CREATE_VIEW_COUNT=$(grep -ci 'create view' "$MIG_DIR"/2026*.sql 2>/dev/null \
    | awk -F: '{s+=$2} END {print s+0}')
  SEC_INV_COUNT=$(grep -ci 'security_invoker' "$MIG_DIR"/2026*.sql 2>/dev/null \
    | awk -F: '{s+=$2} END {print s+0}')
  if [ "$CREATE_VIEW_COUNT" -gt 0 ] && [ "$CREATE_VIEW_COUNT" -le "$SEC_INV_COUNT" ]; then
    pass "CC-12 lint: $CREATE_VIEW_COUNT create-view → $SEC_INV_COUNT security_invoker declarations"
  else
    fail "CC-12 lint: create-view=$CREATE_VIEW_COUNT vs security_invoker=$SEC_INV_COUNT (mismatch)"
  fi
else
  warn "skipping CC-12 lint (migrations dir not present at $MIG_DIR — running outside repo?)"
fi

# ─── Step 6: CC-14 lint — messaging_log MUST stay empty until F4 ──────────────
# We can only verify this via SQL when DATABASE_URL is exported; otherwise skip.
echo "→ CC-14 (messaging_log row count == 0 — only valid with DATABASE_URL)"
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  ROW_COUNT=$(psql "$DATABASE_URL" -At -c "select count(*) from messaging_log" 2>/dev/null || echo "ERR")
  if [ "$ROW_COUNT" = "0" ]; then
    pass "CC-14 lint: messaging_log is empty (F2 invariant holds)"
  elif [ "$ROW_COUNT" = "ERR" ]; then
    warn "skipping CC-14 lint (psql failed against DATABASE_URL)"
  else
    fail "CC-14 violation: messaging_log has $ROW_COUNT rows — only F4 may populate it"
  fi
else
  warn "skipping CC-14 lint (DATABASE_URL unset or psql missing)"
fi

echo
echo -e "${GREEN}F2 smoke test passed.${NC}  WordPress mode: $WP_MODE"
exit 0

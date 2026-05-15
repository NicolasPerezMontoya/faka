#!/usr/bin/env bash
# F2.1-specific smoke test for the faka stack — Plan 2.1.4.4.
#
# Extends scripts/smoke-f2.sh (F2 baseline + WordPress channel) with the
# Mercado Libre channel + connect-page reachability checks. Designed to pass
# in BOTH (a) fully-configured staging and (b) degraded-mode staging where
# ML_* env vars are still unset on the orchestrator.
#
# Usage:
#   bash scripts/smoke-f2.1.sh <dashboard-url> <orchestrator-url>
#
# Example:
#   bash scripts/smoke-f2.1.sh \
#     https://dashboard-staging.vercel.app \
#     https://orchestrator-staging.up.railway.app
#
# Exit codes:
#   0  — All F1 + F2 + F2.1 smoke checks passed
#   1  — Hard failure (unexpected HTTP / shape mismatch)
#
# Degraded-mode behaviour (ML_* env unset on the orchestrator):
#   - /connectors lists `mercadolibre` with `ok:false, last_error:"not configured"`
#   - POST /webhooks/mercadolibre returns 503 `{error:"not_configured"}`
# Configured-mode behaviour (ML_* env set):
#   - /connectors lists `mercadolibre` with `ok:true`
#   - POST /webhooks/mercadolibre (no signature) returns 401 `invalid_signature`
# BOTH are PASS signals for this smoke (we are testing wiring, not creds).

set -euo pipefail

DASHBOARD_URL="${1:-}"
ORCHESTRATOR_URL="${2:-}"

if [ -z "$DASHBOARD_URL" ] || [ -z "$ORCHESTRATOR_URL" ]; then
  echo "Usage: bash scripts/smoke-f2.1.sh <dashboard-url> <orchestrator-url>"
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

# ─── Step 0: Run the F2 smoke first (which itself runs the F1 baseline) ──────
# Anti-duplication invariant: smoke-f2.1.sh REUSES scripts/smoke-f2.sh; it
# does NOT fork health-check or WordPress channel logic.
echo "→ Re-running F2 smoke (scripts/smoke-f2.sh)"
SMOKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SMOKE_DIR/smoke-f2.sh" "$DASHBOARD_URL" "$ORCHESTRATOR_URL"
echo

# ─── Step 1: Mercado Libre connector visible in registry ─────────────────────
echo "→ Mercado Libre connector registry entry: $ORCHESTRATOR_URL/connectors"
CONN_BODY=$(curl -fsSL --max-time 10 "$ORCHESTRATOR_URL/connectors") || fail "/connectors unreachable"
echo "$CONN_BODY" | grep -q '"canal":"mercadolibre"' \
  || fail "mercadolibre missing from /connectors"
pass "mercadolibre connector present"

# Either ok:true (creds set) or ok:false + degraded-mode shape.
if echo "$CONN_BODY" | grep -Eq '"canal":"mercadolibre"[^}]*"ok":true'; then
  pass "mercadolibre connector is HEALTHY (creds configured)"
  ML_MODE="configured"
else
  echo "$CONN_BODY" | grep -Eq '"canal":"mercadolibre"[^}]*"ok":false' \
    || fail "mercadolibre connector has unexpected shape (neither ok:true nor ok:false)"
  warn "mercadolibre connector is DEGRADED — env vars unset on orchestrator"
  ML_MODE="degraded"
fi

# ─── Step 2: Mercado Libre webhook endpoint responds correctly ───────────────
echo "→ ML webhook ACK path: POST $ORCHESTRATOR_URL/webhooks/mercadolibre (empty body, no signature)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H 'content-type: application/json' \
  --max-time 10 \
  "$ORCHESTRATOR_URL/webhooks/mercadolibre" \
  --data '{}' || echo "000")

if [ "$ML_MODE" = "degraded" ]; then
  [ "$HTTP_CODE" = "503" ] || fail "expected 503 not_configured in degraded mode, got $HTTP_CODE"
  pass "webhook returns 503 not_configured (degraded mode wired correctly)"
else
  # Configured: missing signature → 401 invalid_signature, or 400
  # missing_topic since the body lacks topic too.
  case "$HTTP_CODE" in
    400|401) pass "webhook returns $HTTP_CODE on unsigned probe (verify path active)" ;;
    *)       fail "expected 400/401 on unsigned probe in configured mode, got $HTTP_CODE" ;;
  esac
fi

# ─── Step 3: Dashboard /operacion/conectar-mercadolibre reachability ─────────
# The F2.1 single new dashboard route (CC-12 invariant — no `v_ml_*` views,
# only the connect page). We don't have a session cookie in CI; assert the
# route is reachable (200 or 3xx to /login). A 5xx means SSR is broken.
ML_CONN_PATH="/operacion/conectar-mercadolibre"
echo "→ Dashboard $ML_CONN_PATH reachability: $DASHBOARD_URL$ML_CONN_PATH"
ML_CONN_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -L --max-time 10 --max-redirs 0 \
  "$DASHBOARD_URL$ML_CONN_PATH" || echo "000")
case "$ML_CONN_CODE" in
  200) pass "$ML_CONN_PATH renders directly (200) — admin session in cookies" ;;
  302|303|307|308) pass "$ML_CONN_PATH redirects to login ($ML_CONN_CODE) — auth gate intact" ;;
  404) warn "$ML_CONN_PATH returned 404 — F2.1 Plan 2.1.3.4 may not be deployed yet" ;;
  *) fail "$ML_CONN_PATH returned unexpected code $ML_CONN_CODE" ;;
esac

# ─── Step 4: OAuth callback route reachability ───────────────────────────────
# The orchestrator hosts `/oauth/mercadolibre/callback`. A GET without query
# params should hit the route (400/302 to the dashboard with an error param,
# never a 5xx). A 404 means the route didn't mount — block.
echo "→ Orchestrator OAuth callback reachability: $ORCHESTRATOR_URL/oauth/mercadolibre/callback"
CB_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 \
  "$ORCHESTRATOR_URL/oauth/mercadolibre/callback" || echo "000")
case "$CB_CODE" in
  200|302|303|307|308|400|401) pass "OAuth callback route mounted (HTTP $CB_CODE on bare GET)" ;;
  404) fail "OAuth callback route NOT mounted (404) — Plan 2.1.3.4 missing on orchestrator" ;;
  503) warn "OAuth callback returned 503 — orchestrator may be in ML degraded mode" ;;
  *) fail "OAuth callback returned unexpected code $CB_CODE" ;;
esac

# ─── Step 5: CC-14 lint — messaging_log STILL empty for F2.1 ─────────────────
# Same gate as smoke-f2.sh but re-asserted because Plan 2.1.3.1's webhook
# route explicitly drops `topic=messages` notifications. A non-zero row count
# means SOMEONE wired ML messaging despite CC-14 (PATTERNS §"CC-14 CARRIED
# FORWARD"). Only valid with DATABASE_URL exported + psql installed.
echo "→ CC-14 (messaging_log row count == 0 after F2.1 — only valid with DATABASE_URL)"
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  ROW_COUNT=$(psql "$DATABASE_URL" -At -c "select count(*) from messaging_log" 2>/dev/null || echo "ERR")
  if [ "$ROW_COUNT" = "0" ]; then
    pass "CC-14 lint: messaging_log is empty (F2.1 still respects the F2 invariant)"
  elif [ "$ROW_COUNT" = "ERR" ]; then
    warn "skipping CC-14 lint (psql failed against DATABASE_URL)"
  else
    fail "CC-14 violation: messaging_log has $ROW_COUNT rows — F2.1 webhook route dropped a messages topic into the DB"
  fi
else
  warn "skipping CC-14 lint (DATABASE_URL unset or psql missing)"
fi

# ─── Step 6: Latency smoke pointer ───────────────────────────────────────────
# This smoke covers wiring (HTTP-level). The end-to-end 15-min latency budget
# is exercised by scripts/ml-latency-smoke.ts (also Plan 2.1.4.4), which
# needs DATABASE_URL + ML_WEBHOOK_SECRET to run live. It exits 78 in
# degraded mode (POSIX EX_CONFIG) — CI treats 78 as a soft pass.
echo "→ Latency budget probe pointer: scripts/ml-latency-smoke.ts"
if [ -f "$SMOKE_DIR/ml-latency-smoke.ts" ]; then
  pass "scripts/ml-latency-smoke.ts present (run separately for the 15-min budget probe)"
else
  fail "scripts/ml-latency-smoke.ts missing — Plan 2.1.4.4 incomplete"
fi

echo
echo -e "${GREEN}F2.1 smoke test passed.${NC}  Mercado Libre mode: $ML_MODE"
exit 0

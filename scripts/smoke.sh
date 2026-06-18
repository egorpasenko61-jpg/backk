#!/usr/bin/env bash
# Smoke-test the poker backend after deploy. Pass the base URL as $1.
# Example: ./scripts/smoke.sh https://poker-backend-xxxx.onrender.com

set -euo pipefail

BASE="${1:-http://localhost:10000}"
echo "→ Smoke-testing $BASE"

curl_fail() { echo "✗ FAIL: $*" >&2; exit 1; }
curl_ok()   { echo "✓ $*"; }

echo "[1/6] /healthz"
RES=$(curl -fsS --max-time 5 "$BASE/healthz") || curl_fail "/healthz unreachable"
echo "$RES" | grep -q '"ok":true' || curl_fail "/healthz unexpected body"
curl_ok "/healthz OK"

echo "[2/6] /tables"
RES=$(curl -fsS --max-time 5 "$BASE/tables") || curl_fail "/tables unreachable"
echo "$RES" | grep -q '"table_1"' || curl_fail "/tables missing table_1"
echo "$RES" | grep -q '"table_2"' || curl_fail "/tables missing table_2"
echo "$RES" | grep -q '"table_3"' || curl_fail "/tables missing table_3"
curl_ok "/tables returns 3 tables"

echo "[3/6] PUT /tables/table_1"
RES=$(curl -fsS --max-time 5 -X PUT "$BASE/tables/table_1" \
  -H 'Content-Type: application/json' \
  -d '{"bigBlind":10,"smallBlind":5,"handNumber":42}')
echo "$RES" | grep -q '"handNumber":42' || curl_fail "PUT didn't apply"
curl_ok "PUT /tables/table_1 round-trips"

echo "[4/6] GET /tables/table_1 (after write)"
RES=$(curl -fsS --max-time 5 "$BASE/tables/table_1")
echo "$RES" | grep -q '"handNumber":42' || curl_fail "GET after PUT lost the value"
curl_ok "Persistence across requests"

echo "[5/6] POST /leaderboard/submit"
RES=$(curl -fsS --max-time 5 -X POST "$BASE/leaderboard/submit" \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"smoke-test","name":"Smoker","score":1234,"won":true}')
echo "$RES" | grep -q '"ok":true' || curl_fail "leaderboard submit failed"
curl_ok "leaderboard accept"

echo "[6/6] GET /leaderboard/top"
RES=$(curl -fsS --max-time 5 "$BASE/leaderboard/top?n=5")
echo "$RES" | grep -q 'smoke-test' || curl_fail "leaderboard top missing smoke-test"
curl_ok "leaderboard top reads back"

echo ""
echo "✅ All 6 checks passed."